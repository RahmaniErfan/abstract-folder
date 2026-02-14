import { BaseFacet } from "./base-facet";
import { setIcon, App, Menu } from "obsidian";
import { Logger } from "../../utils/logger";
import { ContextEngine } from "../../core/context-engine";
import { TreeCoordinator } from "../../core/tree-coordinator";
import { AbstractFolderPluginSettings } from "../../settings";
import { ManageSortingModal } from "../modals/manage-sorting-modal";

/**
 * ToolbarFacet provides the top-level actions for the Abstract Folder view.
 */
export class ToolbarFacet extends BaseFacet {
    constructor(
        treeCoordinator: TreeCoordinator,
        contextEngine: ContextEngine,
        containerEl: HTMLElement,
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private onSaveSettings: () => Promise<void>
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
            this.contextEngine.expandAll(this.treeCoordinator).catch(err => {
                Logger.error("ToolbarFacet: Error expanding all", err);
            });
        });

        // 2. Collapse All
        this.addAction("chevrons-down-up", "Collapse all", () => {
            Logger.debug("ToolbarFacet: Collapse all");
            this.contextEngine.collapseAll();
        });

        // 3. Focus Active File
        this.addAction("target", "Focus active file", () => {
            Logger.debug("ToolbarFacet: Focus active file");
            // To be implemented
        });

        // 4. Create Note
        this.addAction("file-plus", "Create new root note", () => {
            Logger.debug("ToolbarFacet: Create note");
            (this.app as any).commands.executeCommandById("abstract-folder:create-abstract-child");
        });

        // 5. Sort Menu
        this.addAction("sort-asc", "Sort options", (evt) => {
            this.showSortMenu(evt);
        });

        // 6. Filter Menu
        this.addAction("filter", "Filter options", (evt) => {
            this.showFilterMenu(evt);
        });

        // 7. Group Menu
        this.addAction("layers", "Groups", (evt) => {
            this.showGroupMenu(evt);
        });
    }

    private showSortMenu(event: MouseEvent) {
        const menu = new Menu();

        menu.addItem(item => item
            .setTitle("Manage default sorting")
            .setIcon("gear")
            .onClick(() => {
                new ManageSortingModal(this.app, this.settings, (updated) => {
                    this.onSaveSettings().catch(err => {
                        Logger.error("ToolbarFacet: Error saving settings after sort update", err);
                    });
                }).open();
            })
        );

        menu.addSeparator();

        menu.addItem(item => item.setTitle("Name (a to z)").onClick(() => { /* TODO */ }));
        menu.addItem(item => item.setTitle("Name (z to a)").onClick(() => { /* TODO */ }));
        menu.showAtMouseEvent(event);
    }

    private showFilterMenu(event: MouseEvent) {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Show image files").setChecked(true).onClick(() => { /* TODO */ }));
        menu.addItem(item => item.setTitle("Show canvas files").setChecked(true).onClick(() => { /* TODO */ }));
        menu.showAtMouseEvent(event);
    }

    private showGroupMenu(event: MouseEvent) {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Manage groups").setIcon("gear").onClick(() => {
            (this.app as any).commands.executeCommandById("abstract-folder:manage-groups");
        }));
        menu.showAtMouseEvent(event);
    }

    private addAction(icon: string, title: string, onclick: (evt: MouseEvent) => void) {
        const actionEl = this.containerEl.createDiv({
            cls: "abstract-folder-toolbar-action clickable-icon",
            attr: { "aria-label": title, "title": title }
        });
        setIcon(actionEl, icon);
        actionEl.addEventListener("click", (evt: MouseEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            onclick(evt);
        });
    }
}
