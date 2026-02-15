import { BaseFacet } from "./base-facet";
import { setIcon, App, Menu } from "obsidian";
import AbstractFolderPlugin from "main";
import { Logger } from "../../utils/logger";
import { ContextEngine } from "../../core/context-engine";
import { TreeCoordinator } from "../../core/tree-coordinator";
import { AbstractFolderPluginSettings } from "../../settings";
import { ManageSortingModal } from "../modals/manage-sorting-modal";
import { ManageFilteringModal } from "../modals/manage-filtering-modal";
import { ManageGroupsModal } from "../modals/manage-groups-modal";
import { SortBy } from "../../types";
import { URIUtils } from "../../core/uri";

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
		private onSaveSettings: () => Promise<void>,
		private groupHeaderContainer?: HTMLElement,
	) {
		super(treeCoordinator, contextEngine, containerEl);
	}

	onMount(): void {
		this.containerEl.addClass("abstract-folder-toolbar-facet");
		this.subscribe(
			this.contextEngine.subscribe(() => {
				this.render();
			}),
		);
		this.render();
	}

	private render() {
		this.containerEl.empty();
		if (this.groupHeaderContainer) {
			this.groupHeaderContainer.empty();
		}

		this.containerEl.createDiv({ cls: "abstract-folder-toolbar-actions" });

		const activeGroupId = this.contextEngine.getState().activeGroup;
		if (activeGroupId) {
			const group = this.settings.groups.find(
				(g) => g.id === activeGroupId,
			);
			if (group) {
				const target = this.groupHeaderContainer || this.containerEl;
				const header = target.createDiv({
					cls: "abstract-folder-group-header",
				});
				header.setText(group.name);
			}
		}

		// 1. Expand All
		this.addAction("chevrons-up-down", "Expand all", () => {
			Logger.debug("ToolbarFacet: Expand all");
			this.contextEngine.expandAll(this.treeCoordinator).catch((err) => {
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
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				// We use local URI for vault files
				const uri = URIUtils.local(activeFile.path);
				this.contextEngine.select(uri);
				// The TreeFacet handles scrolling/expansion when selection changes
			}
		});

		// 4. Create Note
		this.addAction("file-plus", "Create new root note", () => {
			Logger.debug("ToolbarFacet: Create note");
			const app = this.app as any;
			if (app.commands && app.commands.executeCommandById) {
				app.commands.executeCommandById(
					"abstract-folder:create-abstract-child",
				);
			}
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

		menu.addItem((item) =>
			item
				.setTitle("Manage default sorting")
				.setIcon("gear")
				.onClick(() => {
					new ManageSortingModal(
						this.app,
						this.settings,
						(_updated) => {
							this.onSaveSettings()
								.then(() => {
									this.contextEngine.setSortConfig(
										this.settings.defaultSort,
									);
								})
								.catch((err) => {
									Logger.error(
										"ToolbarFacet: Error saving settings after sort update",
										err,
									);
								});
						},
					).open();
				}),
		);

		menu.addSeparator();

		const addSortItem = (
			title: string,
			sortBy: SortBy,
			sortOrder: "asc" | "desc",
		) => {
			const currentSort = this.contextEngine.getState().sortConfig;
			const isSelected =
				currentSort.sortBy === sortBy &&
				currentSort.sortOrder === sortOrder;

			menu.addItem((item) =>
				item
					.setTitle(title)
					.setChecked(isSelected)
					.onClick(() => {
						this.contextEngine.setSortConfig({ sortBy, sortOrder });
					}),
			);
		};

		addSortItem("Name (A to Z)", "name", "asc");
		addSortItem("Name (Z to A)", "name", "desc");
		addSortItem("Modified (New to Old)", "mtime", "desc");
		addSortItem("Modified (Old to New)", "mtime", "asc");
		addSortItem("Created (New to Old)", "ctime", "desc");
		addSortItem("Created (Old to New)", "ctime", "asc");

		menu.addSeparator();
		addSortItem("Gravity", "gravity", "desc");
		addSortItem("Thermal", "thermal", "desc");
		addSortItem("Stale Rot", "rot", "desc");

		menu.showAtMouseEvent(event);
	}

	private showFilterMenu(event: MouseEvent) {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Manage default filtering")
				.setIcon("gear")
				.onClick(() => {
					new ManageFilteringModal(
						this.app,
						this.settings,
						(_updated) => {
							this.onSaveSettings().catch((err) => {
								Logger.error(
									"ToolbarFacet: Error saving settings after filter update",
									err,
								);
							});
						},
					).open();
				}),
		);

		menu.addSeparator();
		menu.showAtMouseEvent(event);
	}

	private showGroupMenu(event: MouseEvent) {
		const menu = new Menu();

		// List groups from settings
		if (this.settings.groups && this.settings.groups.length > 0) {
			this.settings.groups.forEach((group) => {
				const isActive =
					this.contextEngine.getState().activeGroup === group.id;
				menu.addItem((item) =>
					item
						.setTitle(group.name)
						.setChecked(isActive)
						.onClick(() => {
							const newId = isActive ? null : group.id;
							this.contextEngine.setActiveGroup(newId);

							// If we activated a group, also apply its sort config if available
							if (newId && group.sort) {
								this.contextEngine.setSortConfig(group.sort);
							} else if (!newId) {
								this.contextEngine.setSortConfig(
									this.settings.defaultSort,
								);
							}
						}),
				);
			});
			menu.addSeparator();
		}

		menu.addItem((item) =>
			item
				.setTitle("Manage groups")
				.setIcon("gear")
				.onClick(() => {
					const app = this.app as any;
					const plugin = app.plugins?.plugins[
						"abstract-folder"
					] as AbstractFolderPlugin;
					new ManageGroupsModal(
						this.app,
						this.settings,
						(_groups, activeId) => {
							this.onSaveSettings()
								.then(() => {
									this.contextEngine.setActiveGroup(activeId);
								})
								.catch((err) => {
									Logger.error(
										"ToolbarFacet: Error saving settings after group update",
										err,
									);
								});
						},
						plugin,
					).open();
				}),
		);

		if (this.contextEngine.getState().activeGroup) {
			menu.addItem((item) =>
				item
					.setTitle("Clear active group")
					.setIcon("x")
					.onClick(() => {
						this.contextEngine.setActiveGroup(null);
						this.contextEngine.setSortConfig(
							this.settings.defaultSort,
						);
					}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	private addAction(
		icon: string,
		title: string,
		onclick: (evt: MouseEvent) => void,
	) {
		const actionsContainer =
			this.containerEl.querySelector(
				".abstract-folder-toolbar-actions",
			) || this.containerEl;
		const actionEl = actionsContainer.createDiv({
			cls: "abstract-folder-toolbar-action clickable-icon",
			attr: { "aria-label": title, title: title },
		});
		setIcon(actionEl, icon);
		actionEl.addEventListener("click", (evt: MouseEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			onclick(evt);
		});
	}
}
