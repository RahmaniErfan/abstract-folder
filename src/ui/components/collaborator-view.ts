import { App, Setting, Notice, setIcon, ButtonComponent, moment } from "obsidian";
import AbstractFolderPlugin from "main";

export class CollaboratorView {
    private collabListContainer: HTMLElement;
    private pendingListContainer: HTMLElement;

    constructor(
        private containerEl: HTMLElement,
        private app: App,
        private plugin: AbstractFolderPlugin,
        private vaultPath: string,
        private isOwner: boolean
    ) {
        this.render();
    }

    private render() {
        this.containerEl.empty();
        
        // Collaborators Section
        const collabSection = this.containerEl.createDiv({ cls: "af-dashboard-section" });
        collabSection.createEl("h3", { text: "Collaborators" });
        this.collabListContainer = collabSection.createDiv({ cls: "af-collaborator-list" });
        this.renderSkeleton(this.collabListContainer, 2);

        if (this.isOwner) {
            this.renderInviteForm(collabSection);
            
            // Pending Section
            const pendingSection = this.containerEl.createDiv({ cls: "af-dashboard-section" });
            pendingSection.createEl("h3", { text: "Pending Invitations" });
            this.pendingListContainer = pendingSection.createDiv({ cls: "af-pending-list" });
            this.renderSkeleton(this.pendingListContainer, 1);
        }

        this.refreshLists();
    }

    async refreshLists() {
        const token = await (this.plugin.libraryManager as any).getToken();
        const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.vaultPath);
        
        if (!token || !remoteUrl) {
            this.collabListContainer.empty();
            this.collabListContainer.createEl("p", { 
                text: "Configure GitHub token and remote to see collaborators.", 
                cls: "af-empty-state" 
            });
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
                    this.renderCollaboratorItem(this.collabListContainer, collab, owner, repo, token);
                }
            }
        } catch (e) {
            console.error("Failed to refresh collaborators", e);
            this.collabListContainer.empty();
            if (e.status === 401) {
                this.collabListContainer.createEl("p", { text: "GitHub access denied (401). Check your token in settings.", cls: "af-empty-state af-error-text" });
            } else {
                this.collabListContainer.createEl("p", { text: "Failed to load collaborators.", cls: "af-empty-state" });
            }
        }

        // 2. Refresh Pending Invites
        if (this.isOwner && this.pendingListContainer) {
            try {
                const invitations = await AuthService.listInvitations(token, owner, repo);
                this.pendingListContainer.empty();

                if (!invitations || invitations.length === 0) {
                    this.pendingListContainer.createEl("p", { text: "No pending invitations.", cls: "af-empty-state" });
                } else {
                    for (const invite of invitations) {
                        this.renderPendingItem(this.pendingListContainer, invite, owner, repo, token);
                    }
                }
            } catch (e) {
                console.error("Failed to refresh invitations", e);
                this.pendingListContainer.empty();
                if (e.status === 401) {
                    this.pendingListContainer.createEl("p", { text: "GitHub access denied (401).", cls: "af-empty-state af-error-text" });
                } else {
                    this.pendingListContainer.createEl("p", { text: "Failed to load invitations.", cls: "af-empty-state" });
                }
            }
        }
    }

    private renderCollaboratorItem(container: HTMLElement, collab: any, owner: string, repo: string, token: string) {
        const item = container.createDiv({ cls: "af-collaborator-item" });
        
        const avatar = item.createDiv({ cls: "af-collab-avatar" });
        if (collab.avatar_url) {
             avatar.createEl("img", { attr: { src: collab.avatar_url } });
        } else {
            setIcon(avatar, "user");
        }
        
        const info = item.createDiv({ cls: "af-collab-info" });
        info.createDiv({ cls: "af-collab-name", text: collab.login });
        const subText = collab.permissions ? 
            (collab.permissions.admin ? 'Admin' : 
             collab.permissions.push ? 'Write' : 'Read') : 'Collaborator';
        info.createDiv({ cls: "af-collab-email", text: subText });

        if (this.isOwner) {
            const actions = item.createDiv({ cls: "af-collab-actions" });
            new ButtonComponent(actions)
                .setIcon("trash")
                .setTooltip("Remove Collaborator")
                .onClick(async () => {
                    if (!confirm(`Are you sure you want to remove ${collab.login}?`)) return;
                    const { AuthService } = await import("../../library/services/auth-service");
                    const success = await AuthService.removeCollaborator(token, owner, repo, collab.login);
                    if (success) {
                        new Notice(`Removed ${collab.login}`);
                        this.refreshLists();
                    }
                }).buttonEl.addClass("af-collab-remove-btn");
        }
    }

    private renderPendingItem(container: HTMLElement, invite: any, owner: string, repo: string, token: string) {
        const item = container.createDiv({ cls: "af-collaborator-item" });
        const info = item.createDiv({ cls: "af-collab-info" });
        info.createDiv({ cls: "af-collab-name", text: invite.invitee?.login || "Unknown" });
        info.createDiv({ cls: "af-collab-email", text: `Permission: ${invite.permissions}` });

        const actions = item.createDiv({ cls: "af-collab-actions" });
        new ButtonComponent(actions)
            .setButtonText("Revoke")
            .setWarning()
            .onClick(async () => {
                const { AuthService } = await import("../../library/services/auth-service");
                const success = await AuthService.deleteInvitation(token, owner, repo, invite.id);
                if (success) {
                    new Notice(`Revoked invitation`);
                    this.refreshLists();
                }
            });
    }

    private renderInviteForm(container: HTMLElement) {
        container.createEl("h4", { text: "Invite Collaborator", cls: "af-sub-heading" });
        let inviteName = "";
        let permission: any = 'push';

        new Setting(container)
            .setName("GitHub Username")
            .addText(text => text
                .setPlaceholder("username")
                .onChange(val => inviteName = val)
            )
            .addDropdown(dropdown => dropdown
                .addOption("pull", "Read")
                .addOption("push", "Write")
                .addOption("admin", "Admin")
                .setValue(permission)
                .onChange(val => permission = val)
            )
            .addButton(btn => btn
                .setButtonText("Invite")
                .setCta()
                .onClick(async () => {
                    if (!inviteName) return;
                    const token = (this.plugin.libraryManager as any).getToken();
                    const remoteUrl = await this.plugin.libraryManager.getRemoteUrl(this.vaultPath);
                    if (!token || !remoteUrl) return;

                    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
                    if (!match) return;

                    const { AuthService } = await import("../../library/services/auth-service");
                    const result = await AuthService.inviteCollaborator(token, match[1], match[2].replace(/\.git$/, ""), inviteName, permission);

                    if (result.success) {
                        new Notice("Invitation sent!");
                        this.refreshLists();
                    } else {
                        new Notice(result.error || "Invite failed");
                    }
                })
            );
    }

    private renderSkeleton(container: HTMLElement, count: number) {
        container.empty();
        for (let i = 0; i < count; i++) {
            const item = container.createDiv({ cls: "af-collaborator-item" });
            
            // Match avatar perfectly
            item.createDiv({ cls: "af-skeleton af-collab-avatar" });
            
            // Match info block perfectly
            const info = item.createDiv({ cls: "af-collab-info", attr: { style: "flex: 1;" } });
            info.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 60%; margin-bottom: 6px; height: 12px;" } });
            info.createDiv({ cls: "af-skeleton af-skeleton-text", attr: { style: "width: 40%; margin-bottom: 0; height: 10px;" } });
        }
    }
}
