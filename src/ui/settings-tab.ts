import {
	App,
	PluginSettingTab,
	Setting,
	AbstractInputSuggest,
	normalizePath,
	TFolder,
} from "obsidian";
import AbstractFolderPlugin from "../../main"; // Adjust path if necessary

// Helper for path suggestions
export class PathInputSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
	}

	getSuggestions(inputStr: string): string[] {
		const files = this.app.vault.getAllLoadedFiles();
		const paths: string[] = [];
		for (const file of files) {
			if (file instanceof TFolder) {
				paths.push(file.path);
			}
		}

		const lowerCaseInputStr = inputStr.toLowerCase();
		return paths.filter((path) =>
			path.toLowerCase().includes(lowerCaseInputStr),
		);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
		this.inputEl.value = value;
		this.inputEl.trigger("input");
		this.close();
	}
}

export class AbstractFolderSettingTab extends PluginSettingTab {
	plugin: AbstractFolderPlugin;

	constructor(app: App, plugin: AbstractFolderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		this.renderExcludedPaths(containerEl);

		new Setting(containerEl).setName("Properties").setHeading();

		new Setting(containerEl)
			.setName("Parent property name")
			.setDesc(
				"The frontmatter property key used to define parent notes (e.g., 'parent' or 'folder'). This setting is case-sensitive, so ensure your frontmatter property name matches the casing exactly.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Example: parent")
					.setValue(this.plugin.settings.propertyName)
					.onChange(async (value) => {
						this.plugin.settings.propertyName = value;
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						); // Notify indexer of setting change
					}),
			);

		new Setting(containerEl)
			.setName("Children property name")
			.setDesc(
				"The frontmatter property key used by a parent to define its children (e.g., 'children' or 'sub_notes'). This setting is case-sensitive, so ensure your frontmatter property name matches the casing exactly.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Example: children")
					.setValue(this.plugin.settings.childrenPropertyName)
					.onChange(async (value) => {
						this.plugin.settings.childrenPropertyName = value;
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						); // Notify indexer of setting change
					}),
			);

		new Setting(containerEl)
			.setName("Created date field names")
			.setDesc(
				"Set the field name in frontmatter to use for the created date (support multiple field names, separated by commas).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Example: created, ctime")
					.setValue(this.plugin.settings.customCreatedDateProperties)
					.onChange(async (value) => {
						this.plugin.settings.customCreatedDateProperties =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Modified date field names")
			.setDesc(
				"Set the field name in frontmatter to use for the modified date (support multiple field names, separated by commas).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Example: modified, updated, mtime")
					.setValue(this.plugin.settings.customModifiedDateProperties)
					.onChange(async (value) => {
						this.plugin.settings.customModifiedDateProperties =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Display name").setHeading();

		new Setting(containerEl)
			.setName("Show aliases")
			.setDesc(
				"Use the first alias from the 'aliases' frontmatter property as the display name. This is now managed by the priority setting below.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAliases)
					.onChange(async (value) => {
						this.plugin.settings.showAliases = value;
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Display name priority")
			.setDesc(
				"Determine the priority for displaying names. Use frontmatter property names (e.g., 'title'), or use the special keyword 'aliases' for the first alias and 'basename' for the original filename. Separate entries with commas.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Example: title, aliases, basename")
					.setValue(this.plugin.settings.displayNameOrder.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.displayNameOrder = value
							.split(",")
							.map((v) => v.trim())
							.filter((v) => v.length > 0);
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						);
					}),
			);

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Expand parent folders for active file")
			.setDesc(
				"Automatically expand all parent folders in the tree view to reveal the active file's location. This ensures that even if a file has multiple parents, all ancestors will be expanded. The active file will always be highlighted.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoExpandParents)
					.onChange(async (value) => {
						this.plugin.settings.autoExpandParents = value;
						await this.plugin.saveSettings();
						// No indexer update needed, fileRevealManager uses settings directly
					}),
			);

		new Setting(containerEl)
			.setName("Scroll to active file")
			.setDesc(
				"When opening a file, scroll the tree view to ensure the file is visible.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoScrollToActiveFile)
					.onChange(async (value) => {
						this.plugin.settings.autoScrollToActiveFile = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Expand children when opening a file")
			.setDesc(
				"If enabled, when you open a file, its direct children folders will be expanded in the tree view.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoExpandChildren)
					.onChange(async (value) => {
						this.plugin.settings.autoExpandChildren = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Expand target folder on drag & drop")
			.setDesc(
				"If enabled, the target folder will automatically expand when an item is dropped into it.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.expandTargetFolderOnDrop)
					.onChange(async (value) => {
						this.plugin.settings.expandTargetFolderOnDrop = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Remember expanded folders")
			.setDesc(
				"Keep folders expanded even when switching views or restarting Obsidian.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rememberExpanded)
					.onChange(async (value) => {
						this.plugin.settings.rememberExpanded = value;
						if (!value) {
							this.plugin.settings.expandedFolders = [];
						}
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Startup & layout").setHeading();

		new Setting(containerEl)
			.setName("Default new note path")
			.setDesc(
				"The default directory where new root-level notes will be created. If left empty, notes will be created in the vault root.",
			)
			.addText((text) => {
				text.setPlaceholder("Example: notes/new")
					.setValue(this.plugin.settings.defaultNewNotePath)
					.onChange(async (value) => {
						this.plugin.settings.defaultNewNotePath =
							normalizePath(value);
						await this.plugin.saveSettings();
					});
				new PathInputSuggest(this.app, text.inputEl);
			});

		new Setting(containerEl)
			.setName("Open on startup")
			.setDesc(
				"Automatically open the abstract folders view when Obsidian starts.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.startupOpen)
					.onChange(async (value) => {
						this.plugin.settings.startupOpen = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open position")
			.setDesc("Which side sidebar to open the view in.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("left", "Left")
					.addOption("right", "Right")
					.setValue(this.plugin.settings.openSide)
					.onChange(async (value: "left" | "right") => {
						this.plugin.settings.openSide = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show ribbon icon")
			.setDesc(
				"Toggle the visibility of the abstract folders icon in the left ribbon.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						await this.plugin.saveSettings();
						// The main plugin class's saveSettings will call updateRibbonIconVisibility
					}),
			);

		new Setting(containerEl).setName("Visual").setHeading();

		new Setting(containerEl)
			.setName("Enable rainbow indents")
			.setDesc(
				"Color the indentation lines to visually distinguish tree depth.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableRainbowIndents)
					.onChange(async (value) => {
						this.plugin.settings.enableRainbowIndents = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Rainbow indent palette")
			.setDesc("Choose the color palette for rainbow indentation guides.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("classic", "Classic")
					.addOption("pastel", "Pastel")
					.addOption("neon", "Neon")
					.setValue(this.plugin.settings.rainbowPalette)
					.onChange(async (value: "classic" | "pastel" | "neon") => {
						this.plugin.settings.rainbowPalette = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Rainbow indent - varied item colors")
			.setDesc(
				"If enabled, sibling items at the same indentation level will use different colors from the palette, making them easier to distinguish. If disabled, all items at the same depth will share the same color.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enablePerItemRainbowColors)
					.onChange(async (value) => {
						this.plugin.settings.enablePerItemRainbowColors = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						);
					}),
			);

		new Setting(containerEl).setName("Toolbar & search").setHeading();

		new Setting(containerEl)
			.setName("Show search bar")
			.setDesc(
				"Toggle the visibility of the search bar at the top of the tree view.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSearchHeader)
					.onChange(async (value) => {
						this.plugin.settings.showSearchHeader = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show view style toggle")
			.setDesc(
				"Toggle the visibility of the tree/column view switch button.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showViewStyleToggle)
					.onChange(async (value) => {
						this.plugin.settings.showViewStyleToggle = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show focus active file button")
			.setDesc(
				"Toggle the visibility of the button that focuses the active file.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showFocusActiveFileButton)
					.onChange(async (value) => {
						this.plugin.settings.showFocusActiveFileButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show search button")
			.setDesc(
				"Toggle the visibility of the search button in the toolbar.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSearchButton)
					.onChange(async (value) => {
						this.plugin.settings.showSearchButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show conversion button")
			.setDesc("Toggle the visibility of the folder conversion button.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showConversionButton)
					.onChange(async (value) => {
						this.plugin.settings.showConversionButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show collapse all button")
			.setDesc(
				"Toggle the visibility of the collapse all folders button.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showCollapseAllButton)
					.onChange(async (value) => {
						this.plugin.settings.showCollapseAllButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show expand all button")
			.setDesc("Toggle the visibility of the expand all folders button.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showExpandAllButton)
					.onChange(async (value) => {
						this.plugin.settings.showExpandAllButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show sort button")
			.setDesc("Toggle the visibility of the sorting options button.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSortButton)
					.onChange(async (value) => {
						this.plugin.settings.showSortButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show filter button")
			.setDesc("Toggle the visibility of the filtering options button.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showFilterButton)
					.onChange(async (value) => {
						this.plugin.settings.showFilterButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show group button")
			.setDesc("Toggle the visibility of the group selection button.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showGroupButton)
					.onChange(async (value) => {
						this.plugin.settings.showGroupButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Show create note button")
			.setDesc(
				"Toggle the visibility of the create new root note button.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showCreateNoteButton)
					.onChange(async (value) => {
						this.plugin.settings.showCreateNoteButton = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger(
							"abstract-folder:graph-updated",
						);
					}),
			);

		new Setting(containerEl)
			.setName("Max menu name length")
			.setDesc(
				"The maximum number of characters shown for file names in right-click menus and dropdowns. Longer names will be truncated.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(10, 100, 5)
					.setValue(this.plugin.settings.maxMenuNameLength)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxMenuNameLength = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Naming conflicts").setHeading();

		new Setting(containerEl)
			.setName("Conflict resolution strategy")
			.setDesc(
				"Determine how to resolve naming conflicts in the flat folder structure. Use the immediate parent name or the highest root ancestor name.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("none", "None (standard counter)")
					.addOption("parent", "Use parent name")
					.addOption("ancestor", "Use highest ancestor name")
					.setValue(this.plugin.settings.namingConflictStrategy)
					.onChange(async (value: "parent" | "ancestor" | "none") => {
						this.plugin.settings.namingConflictStrategy = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Conflict separator")
			.setDesc(
				"The separator or format used when prefixing or suffixing names to resolve conflicts.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("-", "Dash (e.g., parent - name)")
					.addOption("brackets", "Brackets (e.g., name [parent])")
					.setValue(this.plugin.settings.namingConflictSeparator)
					.onChange(async (value: "-" | "brackets") => {
						this.plugin.settings.namingConflictSeparator = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Conflict naming order")
			.setDesc(
				"Determine whether to place the parent or ancestor name before or after the note name.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"parent-first",
						"Parent first (e.g., parent - name)",
					)
					.addOption("name-first", "Name first (e.g., name - parent)")
					.setValue(this.plugin.settings.namingConflictOrder)
					.onChange(async (value: "parent-first" | "name-first") => {
						this.plugin.settings.namingConflictOrder = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderExcludedPaths(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Excluded paths")
			.setDesc("The plugin will ignore these folders and their contents.")
			.setHeading();

		const excludedPathsContainer = containerEl.createDiv({
			cls: "abstract-folder-excluded-paths-container",
		});
		this.plugin.settings.excludedPaths.forEach((path, index) => {
			new Setting(excludedPathsContainer)
				.addText((text) => {
					text.setPlaceholder("Path to exclude");
					text.setValue(path);
					new PathInputSuggest(this.app, text.inputEl);
					text.onChange(async (value) => {
						this.plugin.settings.excludedPaths[index] =
							normalizePath(value);
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(
							this.plugin.settings,
						);
					});
				})
				.addButton((button) =>
					button
						.setButtonText("Remove")
						.setIcon("trash")
						.onClick(async () => {
							this.plugin.settings.excludedPaths.splice(index, 1);
							await this.plugin.saveSettings();
							this.plugin.indexer.updateSettings(
								this.plugin.settings,
							);
							this.display(); // Re-render to update the list
						}),
				);
		});

		new Setting(containerEl).addExtraButton((button) =>
			button
				.setIcon("plus")
				.setTooltip("Add new excluded path")
				.onClick(async () => {
					this.plugin.settings.excludedPaths.push(normalizePath("")); // Add an empty path for the new input, normalized
					await this.plugin.saveSettings();
					this.display(); // Re-render to show the new input field
				}),
		);
	}
}
