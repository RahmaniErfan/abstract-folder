import { App, setIcon, Notice } from "obsidian";
import type AbstractFolderPlugin from "main";
import { Logger } from "../../utils/logger";
import { AbstractFolderPluginSettings } from "../../settings";
import { PersonalBackupModal } from "../modals";

export class AbstractFolderStatusBar {
    private containerEl: HTMLElement;
    private identityArea: HTMLElement;
    private syncArea: HTMLElement;
    private syncBadge: HTMLElement;
    private syncIconContainer: HTMLElement;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private plugin: AbstractFolderPlugin,
        private parentEl: HTMLElement
    ) {
        this.render();
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
            attr: { "aria-label": "Backup & Sync Center" }
        });
        setIcon(dashboardBtn, "cloud");
        dashboardBtn.addEventListener("click", () => {
            new PersonalBackupModal(this.app, this.plugin, this.app.vault.getRoot()).open();
        });

        // Sync Button: Quick Sync
        this.syncArea = controlsArea.createDiv({ 
            cls: "af-status-control af-status-sync-btn clickable-icon",
            attr: { "aria-label": "Sync Backup Now" }
        });
        
        this.syncIconContainer = this.syncArea.createDiv({ cls: "af-status-sync-icon" });
        setIcon(this.syncIconContainer, "refresh-cw");
        
        this.syncBadge = this.syncIconContainer.createDiv({ cls: "af-status-sync-badge is-hidden" });

        this.syncArea.addEventListener("click", async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            
            this.syncArea.addClass("is-syncing");
            try {
                await this.plugin.libraryManager.syncBackup("");
                new Notice("Sync complete");
            } catch (e) {
                new Notice(`Sync failed: ${e.message}`);
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
        if (!this.settings.librarySettings.githubToken) {
            this.syncArea.addClass("is-hidden");
            return;
        }
        this.syncArea.removeClass("is-hidden");

        Logger.debug("[Abstract Folder] StatusBar: refreshStatus started (calling getSyncStatus)");
        const status = await this.plugin.libraryManager.getSyncStatus("");
        Logger.debug(`[Abstract Folder] StatusBar: refreshStatus complete, dirty: ${status.dirty}`);
        
        if (status.dirty > 0) {
            this.syncBadge.textContent = status.dirty > 9 ? "9+" : String(status.dirty);
            this.syncBadge.removeClass("is-hidden");
        } else {
            this.syncBadge.addClass("is-hidden");
        }
    }
}
