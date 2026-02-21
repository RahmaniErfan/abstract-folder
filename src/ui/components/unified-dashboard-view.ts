import { App, Setting, Notice, setIcon, ButtonComponent, TFile, TFolder, moment } from "obsidian";
import AbstractFolderPlugin from "main";
import { CollaboratorView } from "./collaborator-view";

export class UnifiedDashboardView {
    private collaboratorView: CollaboratorView;
    private hasGit: boolean = false;
    private isScanning: boolean = false;
    private largeFiles: string[] = [];
    private repoInfo: { private: boolean; html_url: string; full_name: string } | null = null;
    private githubUrl: string | null = null;
    private isLoading: boolean = true;
    private history: any[] = [];
    private activeTab: 'summary' | 'config' = 'summary';

    // DOM References for in-place updates
    private summaryHeaderContainer: HTMLElement;
    private activitySectionContainer: HTMLElement;

    constructor(
        private containerEl: HTMLElement,
        private app: App,
        private plugin: AbstractFolderPlugin,
        private vaultPath: string,
        private isOwner: boolean,
        private name: string,
        private onClose: () => void
    ) {
        this.init();
    }

    private async init() {
        this.hasGit = await this.plugin.libraryManager.detectExistingGit(this.vaultPath);
        this.isLoading = true;
        this.render(); // Initial shell render with skeletons (default to summary)

        if (this.hasGit) {
            const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.vaultPath);
            if (remoteUrl) {
                // Improved regex to better handle SSH, HTTPS, and trailing slashes/extensions
                const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git|\/)?$/);
                if (match) {
                    const owner = match[1];
                    const repo = match[2];
                    this.githubUrl = `https://github.com/${owner}/${repo}`;
                    
                    const token = await this.plugin.libraryManager.getToken();
                    if (token) {
                        try {
                            const { AuthService } = await import("../../library/services/auth-service");
                            this.repoInfo = await AuthService.getRepository(token, owner, repo);
                            if (this.repoInfo) {
                                this.githubUrl = this.repoInfo.html_url;
                            }
                        } catch (e) {
                            console.error("[UnifiedDashboard] Failed to fetch repo info", e);
                        }
                    }
                }
            }
            this.history = await this.plugin.libraryManager.getHistory(this.vaultPath, 5);
        }
        
        this.isLoading = false;
        
        // In-place UI updates to avoid resetting CollaboratorView
        if (this.summaryHeaderContainer) {
            this.renderSummaryHeader(this.summaryHeaderContainer);
        }
        if (this.activitySectionContainer && this.hasGit) {
            this.renderActivitySection(this.activitySectionContainer);
        }
    }

    private render() {
        this.containerEl.empty();
        const container = this.containerEl.createDiv({ cls: "af-dashboard-container" });

        this.renderTabs(container);

        if (this.activeTab === 'summary') {
            this.renderSummaryTab(container);
        } else {
            this.renderConfigTab(container);
        }
    }

    private renderTabs(container: HTMLElement) {
        const tabs = container.createDiv({ cls: "af-dashboard-tabs" });
        
        const summaryTab = tabs.createDiv({ 
            cls: `af-dashboard-tab ${this.activeTab === 'summary' ? 'is-active' : ''}` 
        });
        setIcon(summaryTab, "layout-dashboard");
        summaryTab.createSpan({ text: "Summary" });
        summaryTab.onClickEvent(() => {
            if (this.activeTab === 'summary') return;
            this.activeTab = 'summary';
            this.render();
        });

        const configTab = tabs.createDiv({ 
            cls: `af-dashboard-tab ${this.activeTab === 'config' ? 'is-active' : ''}` 
        });
        setIcon(configTab, "settings");
        configTab.createSpan({ text: "Config" });
        configTab.onClickEvent(() => {
            if (this.activeTab === 'config') return;
            this.activeTab = 'config';
            this.render();
        });
    }

    private renderSummaryTab(container: HTMLElement) {
        this.summaryHeaderContainer = container.createDiv(); // Wrapper for summary
        this.renderSummaryHeader(this.summaryHeaderContainer);

        if (!this.hasGit) {
            this.renderSetupGuide(container);
            this.renderGovernanceSection(container);
            return;
        }

        // Collaboration Section
        const collabContainer = container.createDiv({ cls: "af-dashboard-section-wrapper" });
        this.collaboratorView = new CollaboratorView(
            collabContainer,
            this.app,
            this.plugin,
            this.vaultPath,
            this.isOwner
        );

        // Sync Section
        this.renderSyncSection(container);
        
        // Activity Section
        this.activitySectionContainer = container.createDiv(); // Wrapper for activity
        this.renderActivitySection(this.activitySectionContainer);
        
        // Governance/Security
        this.renderGovernanceSection(container);
    }

    private async renderConfigTab(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section af-config-editor-section" });
        section.createEl("h3", { text: "Library Configuration (library.json)" });
        section.createEl("p", { 
            text: "Directly edit the manifest file for this library. Changes here affect relationship property names and sync rules.",
            cls: "af-config-desc"
        });

        const configFile = this.app.vault.getAbstractFileByPath(`${this.vaultPath}/library.json`);
        
        if (!configFile || !(configFile instanceof TFile)) {
            const emptyState = section.createDiv({ cls: "af-config-empty" });
            emptyState.createEl("p", { text: "No library.json found in this folder." });
            new ButtonComponent(emptyState)
                .setButtonText("Initialize library.json")
                .setCta()
                .onClick(async () => {
                    const template = {
                        id: this.name.toLowerCase().replace(/\s+/g, '-'),
                        name: this.name,
                        author: "Unknown",
                        version: "1.0.0",
                        parentProperty: "parent",
                        childrenProperty: "children",
                        forceStandardProperties: false
                    };
                    await this.app.vault.create(`${this.vaultPath}/library.json`, JSON.stringify(template, null, 2));
                    new Notice("Created library.json");
                    this.render();
                });
            return;
        }

        try {
            const content = await this.app.vault.read(configFile);
            const editor = section.createEl("textarea", { 
                cls: "af-config-textarea",
                text: content 
            });
            editor.rows = 15;

            const actions = section.createDiv({ cls: "af-config-actions" });
            const saveBtn = new ButtonComponent(actions)
                .setButtonText("Save Changes")
                .setCta()
                .onClick(async () => {
                    const newContent = editor.value;
                    try {
                        const parsed = JSON.parse(newContent);
                        // Basic validation
                        if (!parsed.id) throw new Error("Manifest must have an 'id'");
                        
                        await this.app.vault.modify(configFile, JSON.stringify(parsed, null, 2));
                        new Notice("Configuration saved successfully");
                        
                        // Invalidate local cache
                        const bridge = (this.plugin as any).abstractBridge;
                        if (bridge && bridge.configResolver) {
                            bridge.configResolver.clearCache();
                            bridge.invalidateCache();
                        }
                    } catch (e) {
                        new Notice(`Invalid JSON: ${e.message}`);
                    }
                });

            new ButtonComponent(actions)
                .setButtonText("Reset")
                .onClick(() => {
                    editor.value = content;
                });

        } catch (e) {
            section.createEl("p", { text: `Error reading config: ${e.message}`, cls: "error-text" });
        }
    }

    private renderSummaryHeader(container: HTMLElement) {
        container.empty();
        const header = container.createDiv({ cls: "af-dashboard-summary-header" });
        
        const left = header.createDiv({ cls: "af-summary-left" });
        
        if (this.isLoading) {
            left.createDiv({ cls: "af-skeleton af-status-dot", attr: { style: "box-shadow: none;" } });
            left.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 120px; height: 14px; margin-bottom: 0;" } });
            const right = header.createDiv({ cls: "af-summary-right" });
            right.createDiv({ cls: "af-skeleton af-status-badge", attr: { style: "width: 70px; height: 26px; border: none; cursor: default;" } });
            return;
        }

        const statusDot = left.createDiv({ cls: `af-status-dot ${this.hasGit ? 'is-active' : ''}` });
        left.createSpan({ 
            text: this.hasGit ? "GitHub Initialized" : "GitHub Not Initialized",
            cls: "af-summary-status-text"
        });

        if (this.hasGit) {
            const right = header.createDiv({ cls: "af-summary-right" });
            
            // GitHub Actions Group (Resilient to missing repoInfo)
            const actionsContainer = right.createDiv({ cls: "af-github-actions" });
            this.renderGitHubActions(actionsContainer);

            if (this.repoInfo) {
                const badge = right.createDiv({ 
                    cls: `af-status-badge ${this.repoInfo.private ? 'is-private' : 'is-public'}` 
                });
                setIcon(badge, this.repoInfo.private ? "lock" : "globe");
                badge.createSpan({ text: this.repoInfo.private ? "Private" : "Public" });
                
                badge.onClickEvent(() => {
                    window.open(this.repoInfo!.html_url, "_blank");
                });
            } else if (this.githubUrl) {
                // Show a simple badge if we couldn't fetch detailed info
                const badge = right.createDiv({ cls: `af-status-badge is-private` });
                setIcon(badge, "github");
                badge.createSpan({ text: "GitHub" });
                badge.onClickEvent(() => window.open(this.githubUrl!, "_blank"));
            }
        }
    }

    private renderGitHubActions(container: HTMLElement) {
        if (!this.githubUrl) return;

        const githubUrl = this.githubUrl;

        this.createGitHubBtn(container, "github", "View on GitHub", () => window.open(githubUrl, "_blank"));
        this.createGitHubBtn(container, "star", "Star library (Coming soon)", () => {});
        this.createGitHubBtn(container, "git-fork", "Fork library (Coming soon)", () => {});
        this.createGitHubBtn(container, "git-pull-request", "Create PR (Coming soon)", () => {});
        this.createGitHubBtn(container, "alert-circle", "Open Issue (Coming soon)", () => {});
    }

    private createGitHubBtn(container: HTMLElement, icon: string, title: string, onClick: () => void) {
        const btn = container.createDiv({ 
            cls: "af-github-action-btn clickable-icon", 
            attr: { "aria-label": title } 
        });
        setIcon(btn, icon);
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
    }

    private renderSetupGuide(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Setup Repository" });
        section.createEl("p", { text: "This folder isn't connected to a GitHub repository yet. Connect it to enable cloud sync and collaboration." });

        let repoName = this.name.toLowerCase().replace(/\s+/g, '-');
        let isPrivate = true;

        new Setting(section)
            .setName("Repository name")
            .addText(text => text
                .setValue(repoName)
                .onChange(val => repoName = val));

        new Setting(section)
            .setName("Private repository")
            .addToggle(toggle => toggle
                .setValue(isPrivate)
                .onChange(val => isPrivate = val));

        new Setting(section)
            .addButton(btn => btn
                .setButtonText("Initialize Backup")
                .setCta()
                .onClick(async () => {
                    const token = await this.plugin.libraryManager.getToken();
                    if (!token) {
                        new Notice("GitHub PAT not found. Please configure it in settings.");
                        return;
                    }
                    btn.setDisabled(true);
                    btn.setButtonText("Creating...");
                    
                    const { AuthService } = await import("../../library/services/auth-service");
                    const repoData = await AuthService.createRepository(token, repoName, isPrivate);
                    if (repoData) {
                        await this.plugin.libraryManager.initializePersonalBackup(this.vaultPath, repoData.url, token);
                        new Notice("Repository initialized!");
                        this.init(); // Refresh
                    } else {
                        new Notice("Failed to create repository.");
                        btn.setDisabled(false);
                        btn.setButtonText("Initialize Backup");
                    }
                }));
    }

    private getConfig() {
        if (!this.plugin.settings.librarySettings.spaceConfigs) {
            this.plugin.settings.librarySettings.spaceConfigs = {};
        }
        if (!this.plugin.settings.librarySettings.spaceConfigs[this.vaultPath]) {
            this.plugin.settings.librarySettings.spaceConfigs[this.vaultPath] = {
                path: this.vaultPath,
                enableScheduledSync: false,
                syncIntervalValue: 1,
                syncIntervalUnit: 'hours'
            };
        }
        return this.plugin.settings.librarySettings.spaceConfigs[this.vaultPath];
    }

    private renderSyncSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Sync Settings" });

        const config = this.getConfig();

        new Setting(section)
            .setName("Sync Changes Now")
            .setDesc("Push and pull updates manually.")
            .addButton(btn => btn
                .setButtonText("Sync Now")
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText("Syncing...");
                    try {
                        await this.plugin.libraryManager.syncBackup(this.vaultPath);
                        new Notice("Sync complete");
                        this.onClose();
                    } catch (e) {
                        new Notice(`Sync failed: ${e.message}`);
                        btn.setDisabled(false);
                        btn.setButtonText("Sync Now");
                    }
                }));

        new Setting(section)
            .setName("Enable scheduled sync")
            .addToggle((toggle) =>
                toggle
                    .setValue(config.enableScheduledSync)
                    .onChange(async (value) => {
                        config.enableScheduledSync = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );

        new Setting(section)
            .setName("Sync interval")
            .addText((text) =>
                text
                    .setPlaceholder("1")
                    .setValue(String(config.syncIntervalValue))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            config.syncIntervalValue = num;
                            await this.plugin.saveSettings();
                            this.plugin.setupSyncScheduler();
                        }
                    }),
            )
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("minutes", "Minutes")
                    .addOption("hours", "Hours")
                    .addOption("days", "Days")
                    .setValue(config.syncIntervalUnit)
                    .onChange(async (value: any) => {
                        config.syncIntervalUnit = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );
    }

    private renderActivitySection(container: HTMLElement) {
        container.empty();
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Recent Activity" });

        if (this.isLoading) {
            const list = section.createDiv({ cls: "af-activity-list" });
            for (let i = 0; i < 3; i++) {
                const item = list.createDiv({ cls: "af-activity-item" });
                item.createDiv({ cls: "af-skeleton af-activity-dot", attr: { style: "border: none; box-shadow: none;" } });
                
                const content = item.createDiv({ cls: "af-activity-content" });
                
                const header = content.createDiv({ cls: "af-activity-header", attr: { style: "align-items: center; margin-bottom: 8px;" } });
                header.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 30%; height: 12px; margin-bottom: 0;" } });
                header.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 20%; height: 10px; margin-bottom: 0;" } });
                
                content.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 85%; height: 12px; margin-bottom: 6px;" } });
                content.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 40%; height: 12px; margin-bottom: 0;" } });
            }
            return;
        }

        if (this.history.length === 0) {
            section.createEl("p", { text: "No sync activity yet.", cls: "af-empty-state" });
            return;
        }

        const list = section.createDiv({ cls: "af-activity-list" });
        this.history.forEach(commit => {
            const item = list.createDiv({ cls: "af-activity-item" });
            item.createDiv({ cls: "af-activity-dot" });
            const content = item.createDiv({ cls: "af-activity-content" });
            const header = content.createDiv({ cls: "af-activity-header" });
            header.createSpan({ cls: "af-activity-author", text: commit.author });
            header.createSpan({ cls: "af-activity-date", text: moment(commit.timestamp).fromNow() });
            content.createDiv({ cls: "af-activity-msg", text: commit.message });
        });
    }

    private renderGovernanceSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Exclusions & Health" });

        const exclusions = this.plugin.settings.librarySettings.securityExclusions || [];
        section.createEl("p", { 
            text: `Automatically ignored: ${exclusions.join(", ") || "none"}`,
            cls: "af-dashboard-exclusions-text" 
        });

        if (this.hasGit) {
            new Setting(section)
                .setName("Scan Large Files")
                .addButton(btn => btn
                    .setButtonText(this.isScanning ? "Scanning..." : "Scan Now")
                    .onClick(async () => {
                        this.isScanning = true;
                        this.render();
                        this.largeFiles = await this.plugin.libraryManager.checkForLargeFiles(this.vaultPath);
                        this.isScanning = false;
                        this.render();
                        if (this.largeFiles.length > 0) {
                            new Notice(`Found ${this.largeFiles.length} large files.`);
                        } else {
                            new Notice("No large files found.");
                        }
                    }));

            if (this.largeFiles.length > 0) {
                const list = section.createDiv({ cls: "af-warning-list" });
                this.largeFiles.slice(0, 3).forEach(f => list.createDiv({ text: `⚠️ ${f}`, cls: "af-warning-file" }));
            }
        }
    }
}
