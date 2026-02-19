import { App, Modal, Setting, Notice, setIcon, ButtonComponent, TFolder, moment } from "obsidian";
import AbstractFolderPlugin from "main";
import { CollaboratorView } from "../components/collaborator-view";

export class SpaceDashboardModal extends Modal {
    private collaboratorView: CollaboratorView;

    constructor(
        app: App, 
        private plugin: AbstractFolderPlugin,
        private folder: TFolder,
        private isOwner: boolean
    ) {
        super(app);
        this.modalEl.addClass("af-space-dashboard");
    }

    private getConfig() {
        if (!this.plugin.settings.librarySettings.spaceConfigs) {
            this.plugin.settings.librarySettings.spaceConfigs = {};
        }
        if (!this.plugin.settings.librarySettings.spaceConfigs[this.folder.path]) {
            this.plugin.settings.librarySettings.spaceConfigs[this.folder.path] = {
                path: this.folder.path,
                enableScheduledSync: false,
                syncIntervalValue: 1,
                syncIntervalUnit: 'hours'
            };
        }
        return this.plugin.settings.librarySettings.spaceConfigs[this.folder.path];
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const titleContainer = contentEl.createDiv({ cls: "af-dashboard-header" });
        
        const leftHeader = titleContainer.createDiv({ cls: "af-dashboard-header-left" });
        leftHeader.createEl("h2", { text: `Space: ${this.folder.name}`, cls: "af-dashboard-title" });

        const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.folder.path);
        if (remoteUrl) {
            const repoLink = leftHeader.createEl("a", { cls: "af-dashboard-repo-link", href: remoteUrl });
            repoLink.target = "_blank";
            setIcon(repoLink, "github");
        }
        
        const container = contentEl.createDiv({ cls: "af-dashboard-container" });

        // Collaboration Section (Powered by CollaboratorView)
        const collabContainer = container.createDiv({ cls: "af-dashboard-collaboration-wrapper" });
        this.collaboratorView = new CollaboratorView(
            collabContainer,
            this.app,
            this.plugin,
            this.folder.path,
            this.isOwner
        );

        // Sync Section
        this.renderSyncSection(container);
        
        // Activity Section
        await this.renderActivitySection(container);
        
        // Actions
        this.renderActionsSection(container);
    }


    // Repository Section Removed


    private renderSyncSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Sync Settings" });

        const config = this.getConfig();

        new Setting(section)
            .setName("Enable scheduled sync")
            .setDesc("Automatically sync this space at regular intervals.")
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
            .setDesc("How often to perform an automatic sync.")
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
                    .addOption("weeks", "Weeks")
                    .setValue(config.syncIntervalUnit)
                    .onChange(async (value: "minutes" | "hours" | "days" | "weeks") => {
                        config.syncIntervalUnit = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupSyncScheduler();
                    }),
            );
    }

    private async renderActivitySection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Recent Activity" });

        // Fetch 6 items to show 5 and blur the 6th
        const history = await this.plugin.libraryManager.getHistory(this.folder.path, 6);
        
        if (history.length === 0) {
            section.createEl("p", { text: "No recent activity recorded.", cls: "af-empty-state" });
            return;
        }

        const events = section.createDiv({ cls: "af-activity-list" });
        // Iterate through all fetched history items (up to 6)
        history.forEach((commit, index) => {
            const isBlurred = index === 5; // 6th item (0-indexed)
            
            const event = events.createDiv({ cls: "af-activity-item" });
            if (isBlurred) {
                event.addClass("af-activity-blurred");
            }
            
            event.createDiv({ cls: "af-activity-dot" });
            
            const content = event.createDiv({ cls: "af-activity-content" });
            const header = content.createDiv({ cls: "af-activity-header" });
            header.createSpan({ cls: "af-activity-author", text: commit.author });
            header.createSpan({ cls: "af-activity-date", text: moment(commit.timestamp).fromNow() });
            
            content.createDiv({ cls: "af-activity-msg", text: commit.message });
        });
    }

    private renderActionsSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Actions" });

        const actions = section.createDiv({ cls: "af-dashboard-actions" });

        if (this.isOwner) {
            new ButtonComponent(actions)
                .setButtonText("Archive Space")
                .setWarning()
                .onClick(() => {
                    new Notice("Archive functionality coming soon");
                });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
