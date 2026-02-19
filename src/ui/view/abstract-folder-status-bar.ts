import { App, setIcon, Notice } from "obsidian";
import type AbstractFolderPlugin from "main";
import { Logger } from "../../utils/logger";
import { AbstractFolderPluginSettings } from "../../settings";
import { AbstractDashboardModal } from "../modals/abstract-dashboard-modal";

export class AbstractFolderStatusBar {
    private containerEl: HTMLElement;
    private identityArea: HTMLElement;
    private syncArea: HTMLElement;
    private pushArea: HTMLElement;
    private syncBadge: HTMLElement;
    private pushBadge: HTMLElement;
    private syncIconContainer: HTMLElement;
    private unsubscribe: (() => void) | null = null;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private parentEl: HTMLElement
    ) {
        this.render();
        
        // Register and subscribe to root scope (Personal Vault)
        const vaultRoot = ""; 
        const absPath = (this.plugin.libraryManager as any).getAbsolutePath(vaultRoot);
        this.plugin.libraryManager.scopeManager.registerScope(vaultRoot, absPath);
        
        this.unsubscribe = this.plugin.libraryManager.scopeManager.subscribe(vaultRoot, (state) => {
            this.updateBadges(state);
        });
    }

    public onDestroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    private render() {
        this.containerEl = this.parentEl.createDiv({ cls: "af-status-bar" });
        
        // Left: Identity Area
        this.identityArea = this.containerEl.createDiv({ cls: "af-status-identity" });
        this.updateIdentity();

        // Right: Controls Area
        const controlsArea = this.containerEl.createDiv({ cls: "af-status-controls" });

        // Cloud Button: Open Dashboard
        const dashboardBtn = controlsArea.createDiv({ 
            cls: "af-status-control clickable-icon",
            attr: { "aria-label": "Backup & Sync Center (Dashboard)" }
        });
        setIcon(dashboardBtn, "cloud");
        dashboardBtn.addEventListener("click", () => {
            const vaultName = (this.app.vault.adapter as any).getName?.() || "My Vault";
            new AbstractDashboardModal(
                this.app, 
                this.plugin, 
                "", 
                vaultName,
                true
            ).open();
        });

        // Push Button
        this.pushArea = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon",
            attr: { "aria-label": "Push changes to remote" }
        });
        const pushIconContainer = this.pushArea.createDiv({ cls: "af-status-sync-icon" });
        setIcon(pushIconContainer, "upload-cloud");
        
        this.pushBadge = pushIconContainer.createDiv({ cls: "af-status-sync-badge is-hidden" });
        this.pushBadge.style.backgroundColor = "var(--color-blue)"; 

        this.pushArea.addEventListener("click", async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            
            this.pushArea.addClass("is-syncing");
            try {
                await this.plugin.libraryManager.syncBackup("", "Manual push from Status Bar", undefined, true);
                new Notice("Push complete");
            } catch (e) {
                new Notice(`Push failed: ${e.message}`);
            } finally {
                this.pushArea.removeClass("is-syncing");
                this.refreshStatus();
            }
        });

        // Pull Button
        this.syncArea = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon",
            attr: { "aria-label": "Pull updates from remote" }
        });
        
        this.syncIconContainer = this.syncArea.createDiv({ cls: "af-status-sync-icon" });
        setIcon(this.syncIconContainer, "refresh-cw");
        
        this.syncBadge = this.syncIconContainer.createDiv({ cls: "af-status-sync-badge is-hidden" });

        this.syncArea.addEventListener("click", async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            
            this.syncArea.addClass("is-syncing");
            try {
                await this.plugin.libraryManager.updateLibrary("");
                new Notice("Updates pulled");
            } catch (e) {
                new Notice(`Pull failed: ${e.message}`);
            } finally {
                this.syncArea.removeClass("is-syncing");
                this.refreshStatus();
            }
        });

        // Initial refresh - deferred to View.refreshTree or manual trigger
        // this.refreshStatus();
    }

    private isRefreshingIdentity = false;
    public async updateIdentity() {
        this.identityArea.empty();
        if (!this.settings.librarySettings.githubToken) {
            this.identityArea.addClass("is-hidden");
            return;
        }
        this.identityArea.removeClass("is-hidden");

        const username = this.settings.librarySettings.githubUsername || "GitHub";
        
        if (this.settings.librarySettings.githubAvatar) {
            const avatarContainer = this.identityArea.createDiv({ cls: "af-status-avatar" });
            avatarContainer.createEl("img", {
                attr: { 
                    src: this.settings.librarySettings.githubAvatar,
                    width: "18",
                    height: "18"
                }
            });
        } else {
            setIcon(this.identityArea.createDiv({ cls: "af-status-avatar-placeholder" }), "user");
        }

        this.identityArea.createSpan({ text: `@${username}`, cls: "af-status-username" });

        // Auto-refresh if missing (with guard)
        if (!this.settings.librarySettings.githubUsername && !this.isRefreshingIdentity) {
            this.isRefreshingIdentity = true;
            try {
                Logger.debug("[Abstract Folder] StatusBar: Refreshing identity...");
                await this.plugin.libraryManager.refreshIdentity();
                // After refresh, update the UI once more
                const newUsername = this.settings.librarySettings.githubUsername || "GitHub";
                const usernameSpan = this.identityArea.querySelector(".af-status-username");
                if (usernameSpan) usernameSpan.textContent = `@${newUsername}`;
                
                if (this.settings.librarySettings.githubAvatar) {
                    this.updateIdentity(); // One-time re-render if avatar appearing
                }
            } finally {
                this.isRefreshingIdentity = false;
            }
        }
    }

    public async refreshStatus() {
        // Trigger a manual refresh in the manager, which will emit the event
        await this.plugin.libraryManager.scopeManager.refreshScope("");
    }

    private updateBadges(state: any) {
        if (!this.settings.librarySettings.githubToken) {
             this.syncArea.addClass("is-hidden");
             this.pushArea.addClass("is-hidden");
             return;
        }
        this.syncArea.removeClass("is-hidden");
        this.pushArea.removeClass("is-hidden");

        // Local changes -> Push Badge
        if (state.localChanges > 0 || state.ahead > 0) {
            const count = state.localChanges + state.ahead;
            this.pushBadge.textContent = count > 9 ? "9+" : String(count);
            this.pushBadge.removeClass("is-hidden");
        } else {
            this.pushBadge.addClass("is-hidden");
        }

        // Remote changes -> Pull Badge (Sync)
        // Note: 'dirty' in old getSyncStatus was local changes. 
        // Here we want Pull Badge to show downstream changes if we know them.
        if (state.remoteChanges > 0) {
            this.syncBadge.textContent = state.remoteChanges > 9 ? "9+" : String(state.remoteChanges);
            this.syncBadge.removeClass("is-hidden");
        } else {
             this.syncBadge.addClass("is-hidden");
        }
    }
}
