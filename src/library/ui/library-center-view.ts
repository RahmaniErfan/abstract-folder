import { ItemView, WorkspaceLeaf, Notice, FileSystemAdapter } from "obsidian";
import { RegistryItem } from "../types";
import { RegistryService } from "../services/registry-service";
import { LibraryManager } from "../git/library-manager";
import type AbstractFolderPlugin from "main";

export const VIEW_TYPE_LIBRARY_CENTER = "abstract-library-center";

/**
 * LibraryCenterView is a dedicated Workspace Leaf for discovering and managing libraries.
 */
export class LibraryCenterView extends ItemView {
    private registryService: RegistryService;
    private libraryManager: LibraryManager;

    constructor(leaf: WorkspaceLeaf, private plugin: AbstractFolderPlugin) {
        super(leaf);
        this.registryService = new RegistryService(this.plugin.settings.librarySettings);
        this.libraryManager = this.plugin.libraryManager;
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_CENTER;
    }

    getDisplayText(): string {
        return "Official Catalog";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("abstract-library-center");

        container.createEl("h2", { text: "Official Catalog" });

        const searchContainer = container.createDiv({ cls: "library-search-container" });
        
        // Standalone Installation Section
        const standaloneSection = container.createDiv({ cls: "library-standalone-install" });
        const standaloneInput = standaloneSection.createEl("input", {
            attr: { type: "text", placeholder: "Git repository URL (standalone)..." }
        });
        const standaloneBtn = standaloneSection.createEl("button", { text: "Add standalone" });
        
        const registryList = container.createDiv({ cls: "library-registry-list" });

        const searchInput = searchContainer.createEl("input", {
            attr: { type: "text", placeholder: "Search marketplace..." }
        });

        standaloneBtn.addEventListener("click", () => {
            void (async () => {
                const url = standaloneInput.value.trim();
                if (!url) return;
                
                standaloneBtn.disabled = true;
                standaloneBtn.setText("Resolving...");
                
                const item = await this.registryService.resolveStandalone(url);
                if (item) {
                    await this.installLibrary(item);
                    // Save to settings
                    if (!this.plugin.settings.librarySettings.standaloneLibraries.includes(url)) {
                        this.plugin.settings.librarySettings.standaloneLibraries.push(url);
                        await this.plugin.saveSettings();
                    }
                    standaloneInput.value = "";
                } else {
                    new Notice("Invalid or inaccessible repository URL");
                }
                
                standaloneBtn.disabled = false;
                standaloneBtn.setText("Add standalone");
            })();
        });

        // Initial render
        await this.refreshRegistry(registryList);

        searchInput.addEventListener("input", () => {
            void (async () => {
                const query = searchInput.value.toLowerCase();
                const allItems = await this.registryService.fetchAllItems();
                const filtered = allItems.filter(i =>
                    i.name.toLowerCase().includes(query) ||
                    i.description.toLowerCase().includes(query) ||
                    i.tags.some(t => t.toLowerCase().includes(query))
                );
                this.renderItems(registryList, filtered);
            })();
        });
    }

    private async refreshRegistry(container: HTMLElement) {
        container.empty();
        container.createEl("p", { text: "Fetching libraries from registries...", cls: "loading-text" });
        
        const items = await this.registryService.fetchAllItems();
        this.renderItems(container, items);
    }

    private renderItems(container: HTMLElement, items: RegistryItem[]) {
        container.empty();
        
        if (items.length === 0) {
            container.createEl("p", { text: "No libraries found.", cls: "empty-text" });
            return;
        }

        const librariesPath = this.plugin.settings.librarySettings.librariesPath;

        items.forEach(item => {
            const card = container.createDiv({ cls: "library-card" });
            card.createEl("h3", { text: item.name });
            card.createEl("p", { text: item.description });
            
            const meta = card.createDiv({ cls: "library-card-meta" });
            meta.createSpan({ text: `By ${item.author}`, cls: "author" });
            meta.createSpan({ text: item.category, cls: "category" });

            const footer = card.createDiv({ cls: "library-card-footer" });
            
            // Check if library is already installed
            const destPath = `${librariesPath}/${item.name}`;
            
            void (async () => {
                let isInstalled = false;
                try {
                    isInstalled = await this.app.vault.adapter.exists(destPath);
                } catch {
                    isInstalled = false;
                }

                if (isInstalled) {
                    const uninstallBtn = footer.createEl("button", { text: "Uninstall", cls: "mod-warning" });
                    uninstallBtn.addEventListener("click", () => {
                        void this.uninstallLibrary(item, uninstallBtn);
                    });
                } else {
                    const installBtn = footer.createEl("button", { text: "Install" });
                    installBtn.addEventListener("click", () => {
                        void this.installLibrary(item, installBtn);
                    });
                }
            })();
        });
    }

    private async installLibrary(item: RegistryItem, btn?: HTMLButtonElement) {
        if (btn) {
            btn.disabled = true;
            btn.setText("Installing...");
        }

        try {
            new Notice(`Installing ${item.name}...`);
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;
            
            // Log initial state
            console.debug(`[Library Center] Pre-install check for ${destPath}`);
            
            await this.libraryManager.cloneLibrary(item.repositoryUrl, destPath, item);
            
            // Post-install verification
            try {
                const adapter = this.app.vault.adapter;
                if (adapter instanceof FileSystemAdapter) {
                    const entries = await adapter.list(destPath);
                    console.debug(`[Library Center] Post-install verification for ${destPath}:`, entries);
                }
            } catch (e) {
                console.error(`[Library Center] Post-install verification FAILED for ${destPath}`, e);
            }

            new Notice(`Successfully installed ${item.name}`);
            if (btn) btn.setText("Installed");
            
            // Trigger graph rebuild to show new virtual files immediately
            this.plugin.app.workspace.trigger("abstract-folder:graph-updated");
            // Notify that library structure changed so Library Explorer can refresh its shelf
            this.plugin.app.workspace.trigger("abstract-folder:library-changed");
            
            new Notice("Virtual tree refreshed");

            // Refresh the registry view to swap button to "Uninstall"
            const container = this.containerEl.children[1] as HTMLElement;
            const registryList = container.querySelector(".library-registry-list") as HTMLElement;
            if (registryList) {
                await this.refreshRegistry(registryList);
            }
        } catch (error) {
            console.error(error);
            new Notice(`Failed to install ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
            if (btn) {
                btn.disabled = false;
                btn.setText("Install");
            }
        }
    }

    private async uninstallLibrary(item: RegistryItem, btn?: HTMLButtonElement) {
        if (btn) {
            btn.disabled = true;
            btn.setText("Uninstalling...");
        }

        try {
            const librariesPath = this.plugin.settings.librarySettings.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;
            
            await this.libraryManager.deleteLibrary(destPath);
            new Notice(`Successfully uninstalled ${item.name}`);
            
            // Trigger graph rebuild to update view
            this.plugin.app.workspace.trigger("abstract-folder:graph-updated");
            // Notify that library structure changed
            this.plugin.app.workspace.trigger("abstract-folder:library-changed");
            
            // Refresh the whole registry view to show "Install" button again
            const container = this.containerEl.children[1] as HTMLElement;
            const registryList = container.querySelector(".library-registry-list") as HTMLElement;
            if (registryList) {
                await this.refreshRegistry(registryList);
            }
        } catch (error) {
            console.error(error);
            new Notice(`Failed to uninstall ${item.name}`);
            if (btn) {
                btn.disabled = false;
                btn.setText("Uninstall");
            }
        }
    }

    async onClose() {
        // Cleanup logic
    }
}
