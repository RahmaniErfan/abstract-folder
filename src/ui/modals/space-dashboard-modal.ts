import { App, Modal, Setting, Notice, setIcon, ButtonComponent, TFolder, moment } from "obsidian";
import AbstractFolderPlugin from "main";

export class SpaceDashboardModal extends Modal {
    private collabListContainer: HTMLElement;
    private pendingListContainer: HTMLElement;

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
            // Add a pipe separator visually if needed, but flex gap is often better. 
            // The user requested a pipe, let's stick to CSS for that or add a span.
            // Actually, "replace it with a pipe and a github icon" -> Title | <Icon>
            // I'll add the pipe in CSS or as an element.
        }
        
        new ButtonComponent(titleContainer)
            .setIcon("refresh-cw")
            .setTooltip("Refresh Data")
            .onClick(async () => {
                await this.refreshLists();
            })
            .buttonEl.addClass("af-dashboard-refresh-btn");

        const container = contentEl.createDiv({ cls: "af-dashboard-container" });

        // Dynamic Sections (Containers only)
        this.buildCollaboratorsSection(container);
        if (this.isOwner) {
            this.buildPendingSection(container);
        }

        // Sync Section
        this.renderSyncSection(container);
        
        // Activity Section
        await this.renderActivitySection(container);
        
        // Actions
        this.renderActionsSection(container);

        // Fetch Initial Data
        await this.refreshLists();
    }

    private buildCollaboratorsSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Collaborators" });
        
        // Container for the list items
        this.collabListContainer = section.createDiv({ cls: "af-collaborator-list" });
        this.collabListContainer.createEl("p", { text: "Loading...", cls: "af-empty-state" });

        if (this.isOwner) {
            this.renderInviteForm(section);
        }
    }

    private buildPendingSection(container: HTMLElement) {
        const section = container.createDiv({ cls: "af-dashboard-section" });
        section.createEl("h3", { text: "Pending Invitations" });
        
        // Container for the list items
        this.pendingListContainer = section.createDiv({ cls: "af-pending-list" });
        this.pendingListContainer.createEl("p", { text: "Loading...", cls: "af-empty-state" });
    }

    private async refreshLists() {
        // Parallel data fetch
        const token = this.plugin.settings.librarySettings.githubToken;
        const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.folder.path);
        
        if (!token || !remoteUrl) {
            this.collabListContainer.empty();
            this.collabListContainer.createEl("p", { text: "Configure GitHub token and remote to see collaborators.", cls: "af-empty-state" });
            return;
        }

        const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
        if (!match) return;

        const owner = match[1];
        const repo = match[2].replace(/\.git$/, "");

        const { AuthService } = await import("../../library/services/auth-service");

        // 1. Refresh Collaborators
        try {
            const collaborators = await AuthService.listCollaborators(token, owner, repo);
            this.collabListContainer.empty();
            
            if (!collaborators || collaborators.length === 0) {
                this.collabListContainer.createEl("p", { text: "No active collaborators found.", cls: "af-empty-state" });
            } else {
                for (const collab of collaborators) {
                    const item = this.collabListContainer.createDiv({ cls: "af-collaborator-item" });
                    
                    const avatar = item.createDiv({ cls: "af-collab-avatar" });
                    // Use GitHub avatar if available, else generic icon
                    if (collab.avatar_url) {
                         avatar.createEl("img", { attr: { src: collab.avatar_url } });
                    } else {
                        setIcon(avatar, "user");
                    }
                    
                    const info = item.createDiv({ cls: "af-collab-info" });
                    info.createDiv({ cls: "af-collab-name", text: collab.login });
                    // GitHub API doesn't always return email publicly, show permission or type instead
                    const subText = collab.permissions ? 
                        (collab.permissions.admin ? 'Admin' : 
                         collab.permissions.push ? 'Write' : 'Read') : 'Collaborator';
                    info.createDiv({ cls: "af-collab-email", text: subText });

                    if (this.isOwner) {
                        const actions = item.createDiv({ cls: "af-collab-actions" });
                        const btn = new ButtonComponent(actions)
                            .setIcon("trash")
                            .setTooltip("Remove Collaborator")
                            .onClick(async () => {
                                if (!confirm(`Are you sure you want to remove ${collab.login} from this space?`)) return;
                                
                                const success = await AuthService.removeCollaborator(token, owner, repo, collab.login);
                                if (success) {
                                    new Notice(`Removed collaborator ${collab.login}`);
                                    setTimeout(() => this.refreshLists(), 1000);
                                } else {
                                    new Notice("Failed to remove collaborator");
                                }
                            });
                        btn.buttonEl.addClass("af-collab-remove-btn");
                    }
                }
            }
        } catch (e) {
            console.error("Failed to refresh collaborators", e);
        }

        // 2. Refresh Pending Invites (if owner)
        if (this.isOwner && this.pendingListContainer) {
            try {
                const invitations = await AuthService.listInvitations(token, owner, repo);
                this.pendingListContainer.empty();

                if (!invitations || invitations.length === 0) {
                    this.pendingListContainer.createEl("p", { text: "No pending invitations.", cls: "af-empty-state" });
                } else {
                    for (const invite of invitations) {
                        const item = this.pendingListContainer.createDiv({ cls: "af-collaborator-item" });
                        
                        const info = item.createDiv({ cls: "af-collab-info" });
                        info.createDiv({ cls: "af-collab-name", text: invite.invitee?.login || "Unknown" });
                        info.createDiv({ cls: "af-collab-email", text: `Permission: ${invite.permissions}` });

                        const actions = item.createDiv({ cls: "af-collab-actions" });
                        new ButtonComponent(actions)
                            .setButtonText("Revoke")
                            .setWarning()
                            .onClick(async () => {
                                // Optimistic UI update could go here, but safer to re-fetch
                                const success = await AuthService.deleteInvitation(token, owner, repo, invite.id);
                                if (success) {
                                    new Notice(`Revoked invitation for ${invite.invitee?.login}`);
                                    // Slight delay for API propagation
                                    setTimeout(() => this.refreshLists(), 500);
                                } else {
                                    new Notice("Failed to revoke invitation");
                                }
                            });
                    }
                }
            } catch (e) {
                console.error("Failed to refresh invitations", e);
            }
        }
    }

    private renderInviteForm(container: HTMLElement) {
        container.createEl("h4", { text: "Invite Collaborator", cls: "af-sub-heading" });
        let inviteName = "";
        let permission: 'pull' | 'push' | 'admin' | 'maintain' | 'triage' = 'push';

        new Setting(container)
            .setName("GitHub Username")
            .setDesc("Enter the GitHub username of the person you want to invite.")
            .addText(text => text
                .setPlaceholder("username")
                .onChange(val => inviteName = val)
            )
            .addDropdown(dropdown => dropdown
                .addOption("pull", "Read (Pull)")
                .addOption("push", "Write (Push)")
                .addOption("maintain", "Maintain")
                .addOption("admin", "Admin")
                .addOption("triage", "Triage")
                .setValue(permission)
                .onChange(val => permission = val as any)
            )
            .addButton(btn => btn
                .setButtonText("Send Invitation")
                .setCta()
                .onClick(async () => {
                    if (!inviteName) {
                        new Notice("Please enter a username");
                        return;
                    }
                    const token = this.plugin.settings.librarySettings.githubToken;
                    if (!token) {
                        new Notice("GitHub token missing in settings");
                        return;
                    }

                    const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.folder.path);
                    if (!remoteUrl) return;

                    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
                    if (!match) return;

                    const owner = match[1];
                    const repo = match[2].replace(/\.git$/, "");

                    btn.setDisabled(true);
                    btn.setButtonText("Inviting...");
                    
                    const { AuthService } = await import("../../library/services/auth-service");
                    const result = await AuthService.inviteCollaborator(token, owner, repo, inviteName, permission);

                    if (result.success) {
                        new Notice(`Invitation sent to ${inviteName}!`);
                        setTimeout(() => this.refreshLists(), 1000);
                    } else {
                        new Notice(result.error || `Failed to invite ${inviteName}.`);
                    }
                    btn.setDisabled(false);
                    btn.setButtonText("Send Invitation");
                })
            );
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

        new ButtonComponent(actions)
            .setButtonText("Copy Invite Link")
            .onClick(async () => {
                const url = await this.plugin.libraryManager.getRemoteUrl(this.folder.path);
                if (url) {
                    await navigator.clipboard.writeText(url);
                    new Notice("Invite link (Repo URL) copied to clipboard");
                } else {
                    new Notice("Space is not linked to GitHub");
                }
            });

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
