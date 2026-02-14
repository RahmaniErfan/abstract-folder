import { BaseFacet } from "./base-facet";
import { setIcon, App } from "obsidian";
import { Logger } from "../../utils/logger";
import { ContextEngine } from "../../core/context-engine";
import { TreeCoordinator } from "../../core/tree-coordinator";

/**
 * ToolbarFacet provides the top-level actions for the Abstract Folder view.
 */
export class ToolbarFacet extends BaseFacet {
    constructor(
        treeCoordinator: TreeCoordinator,
        contextEngine: ContextEngine,
        containerEl: HTMLElement,
        private app: App
    ) {
        super(treeCoordinator, contextEngine, containerEl);
    }

    onMount(): void {
        this.containerEl.addClass("abstract-folder-toolbar-facet");
        this.render();
    }

    private render() {
        this.containerEl.empty();

        // 1. Expand All
        this.addAction("chevrons-up-down", "Expand all", () => {
            Logger.debug("ToolbarFacet: Expand all");
            // TODO: Implement expandAll in ContextEngine
        });

        // 2. Collapse All
        this.addAction("chevrons-down-up", "Collapse all", () => {
            Logger.debug("ToolbarFacet: Collapse all");
            this.contextEngine.collapseAll();
        });

        // 3. Focus Active File
        this.addAction("target", "Focus active file", () => {
            Logger.debug("ToolbarFacet: Focus active file");
            // TODO: Implement focus active file via ContextEngine/Coordinator
        });

        // 4. Create Note
        this.addAction("file-plus", "Create new root note", () => {
            Logger.debug("ToolbarFacet: Create note");
            // Potentially trigger a command or open a modal
        });
    }

    private addAction(icon: string, title: string, onclick: () => void) {
        const actionEl = this.containerEl.createDiv({
            cls: "abstract-folder-toolbar-action clickable-icon",
            attr: { "aria-label": title, "title": title }
        });
        setIcon(actionEl, icon);
        actionEl.addEventListener("click", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            onclick();
        });
    }
}
