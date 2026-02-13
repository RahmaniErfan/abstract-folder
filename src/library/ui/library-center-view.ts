import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { RegistryItem } from "../types";

export const VIEW_TYPE_LIBRARY_CENTER = "abstract-library-center";

/**
 * LibraryCenterView is a dedicated Workspace Leaf for discovering and managing libraries.
 */
export class LibraryCenterView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_LIBRARY_CENTER;
    }

    getDisplayText(): string {
        return "Library Center";
    }

    getIcon(): string {
        return "library";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("abstract-library-center");

        container.createEl("h2", { text: "Abstract Library Center" });

        const searchContainer = container.createDiv({ cls: "library-search-container" });
        const searchInput = searchContainer.createEl("input", {
            attr: { type: "text", placeholder: "Search libraries..." }
        });

        const registryList = container.createDiv({ cls: "library-registry-list" });
        this.renderRegistry(registryList);
    }

    private renderRegistry(container: HTMLElement) {
        // Mock data for initial UI
        const items: RegistryItem[] = [
            {
                id: "core-concepts",
                name: "Core Philosophy",
                description: "The fundamental building blocks of the Abstract system.",
                repositoryUrl: "https://github.com/example/core-philosophy",
                author: "Abstract Team",
                category: "Philosophy",
                tags: ["essential", "theory"]
            }
        ];

        items.forEach(item => {
            const card = container.createDiv({ cls: "library-card" });
            card.createEl("h3", { text: item.name });
            card.createEl("p", { text: item.description });
            
            const footer = card.createDiv({ cls: "library-card-footer" });
            const installBtn = footer.createEl("button", { text: "Install" });
            installBtn.addEventListener("click", () => {
                // Logic to trigger LibraryManager.cloneLibrary
            });
        });
    }

    async onClose() {
        // Cleanup logic
    }
}
