import { App, setIcon, Notice, requestUrl, MarkdownRenderer } from "obsidian";
import type AbstractFolderPlugin from "../../../../../main";
import { CatalogItem } from "../../types";
import { CatalogService } from "../../services/catalog-service";
import { TopicSubscriptionModal } from "../modals/topic-subscription-modal";

export interface LibraryDiscoveryDetailOptions {
    containerEl: HTMLElement;
    selectedCatalogItem: CatalogItem;
    onBack: () => void;
    onInstallSuccess: (destPath: string) => void;
}

export class LibraryDiscoveryDetail {
    constructor(
        private app: App,
        private plugin: AbstractFolderPlugin,
        private catalogService: CatalogService,
        private options: LibraryDiscoveryDetailOptions
    ) {}

    async render() {
        const { containerEl, selectedCatalogItem: item } = this.options;
        if (!item) return;

        const header = containerEl.createDiv({ cls: "abstract-folder-header" });
        const titleRow = header.createDiv({ cls: "abstract-folder-header-title-container" });
        const backBtn = titleRow.createDiv({ 
            cls: "af-header-back-button abstract-folder-toolbar-action clickable-icon", 
            attr: { "aria-label": "Back to shelf" } 
        });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => {
            this.options.onBack();
        });

        titleRow.createEl("h3", { cls: "abstract-folder-header-title", text: item.name });
        
        const body = containerEl.createDiv({ cls: "library-discovery-body" });
        const hero = body.createDiv({ cls: "library-hero" });
        hero.createEl("p", { text: item.description, cls: "library-description" });
        
        const installBtn = hero.createEl("button", { text: "Install & Subscribe", cls: "mod-cta" });
        installBtn.addEventListener("click", async () => {
            installBtn.disabled = true;
            installBtn.setText("Checking topics...");
            const repoUrl = item.repo || (item as any).repositoryUrl;
            const remoteConfig = await this.catalogService.fetchRemoteLibraryConfig(repoUrl);
            const librariesPath = this.plugin.settings.library.librariesPath;
            const destPath = `${librariesPath}/${item.name}`;

            if (remoteConfig && remoteConfig.availableTopics && remoteConfig.availableTopics.length > 0) {
                new TopicSubscriptionModal(this.app, remoteConfig, destPath, this.plugin.libraryManager, async () => {
                    this.options.onInstallSuccess(destPath);
                }).open();
            } else {
                new Notice(`Installing ${item.name}...`);
                await this.plugin.libraryManager.cloneLibrary(repoUrl, destPath, item);
                new Notice("Installation complete");
                this.options.onInstallSuccess(destPath);
            }
        });

        const readmeArea = body.createDiv({ cls: "library-readme-preview markdown-rendered" });
        readmeArea.createEl("p", { text: "Loading details...", cls: "loading-text" });
        
        void (async () => {
            try {
                let readmeUrl = item.repo || (item as any).repositoryUrl;
                if (readmeUrl && readmeUrl.includes("github.com")) {
                    readmeUrl = readmeUrl.replace("github.com", "raw.githubusercontent.com") + "/main/README.md";
                    const response = await requestUrl({ url: readmeUrl });
                    if (response.status === 200) {
                        readmeArea.empty();
                        await MarkdownRenderer.render(this.app, response.text, readmeArea, "", this.plugin);
                    }
                }
            } catch (e) {
                readmeArea.empty();
                readmeArea.createEl("p", { text: "Press Install to view this library." });
            }
        })();
    }
}
