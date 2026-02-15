import { Setting, AbstractInputSuggest, normalizePath, TFolder } from "obsidian";
import type AbstractFolderPlugin from "main";

export class PathInputSuggest extends AbstractInputSuggest<string> {
	constructor(private plugin: AbstractFolderPlugin, private inputEl: HTMLInputElement) {
		super(plugin.app, inputEl);
	}

	getSuggestions(inputStr: string): string[] {
		const abstractFiles = this.plugin.app.vault.getAllLoadedFiles();
		const folders: string[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((file) => {
			if (
				file instanceof TFolder &&
				file.path.toLowerCase().contains(lowerCaseInputStr)
			) {
				folders.push(file.path);
			}
		});

		return folders;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.inputEl.value = value;
		this.inputEl.trigger("input");
		this.close();
	}
}

export function renderGeneralSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Properties").setHeading();

	new Setting(containerEl)
		.setName("Parent property names")
		.setDesc(
			"The frontmatter property key(s) used to define parent notes (e.g., 'parent' or 'folder'). Support multiple names, separated by commas. These are case-sensitive.",
		)
		.addText((text) =>
			text
				.setPlaceholder("Example: parent, up")
				.setValue(plugin.settings.parentPropertyNames.join(", "))
				.onChange(async (value) => {
					const propertyNames = value
						.split(",")
						.map((v) => v.trim())
						.filter((v) => v.length > 0);
					plugin.settings.parentPropertyNames = propertyNames;
					if (propertyNames.length > 0) {
						plugin.settings.propertyName = propertyNames[0];
					}
					await plugin.saveSettings();
					plugin.indexer.updateSettings(plugin.settings);
				}),
		);

	new Setting(containerEl)
		.setName("Children property names")
		.setDesc(
			"The frontmatter property key(s) used by a parent to define its children (e.g., 'children' or 'sub_notes'). Support multiple names, separated by commas. These are case-sensitive.",
		)
		.addText((text) =>
			text
				.setPlaceholder("Example: children, members")
				.setValue(plugin.settings.childrenPropertyNames.join(", "))
				.onChange(async (value) => {
					const propertyNames = value
						.split(",")
						.map((v) => v.trim())
						.filter((v) => v.length > 0);
					plugin.settings.childrenPropertyNames = propertyNames;
					if (propertyNames.length > 0) {
						plugin.settings.childrenPropertyName = propertyNames[0];
					}
					await plugin.saveSettings();
					plugin.indexer.updateSettings(plugin.settings);
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
				.setValue(plugin.settings.customCreatedDateProperties)
				.onChange(async (value) => {
					plugin.settings.customCreatedDateProperties = value;
					await plugin.saveSettings();
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
				.setValue(plugin.settings.customModifiedDateProperties)
				.onChange(async (value) => {
					plugin.settings.customModifiedDateProperties = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl).setName("Display name").setHeading();

	new Setting(containerEl)
		.setName("Show aliases")
		.setDesc("Use the first alias from the 'aliases' frontmatter property as the display name.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showAliases).onChange(async (value) => {
				plugin.settings.showAliases = value;
				await plugin.saveSettings();
				plugin.indexer.updateSettings(plugin.settings);
			}),
		);

	new Setting(containerEl)
		.setName("Display name priority")
		.setDesc(
			"Determine the priority for displaying names. Use frontmatter property names (e.g., 'title'), 'aliases' for the first alias, or 'basename' for the filename. Separate with commas.",
		)
		.addText((text) =>
			text
				.setPlaceholder("Example: title, aliases, basename")
				.setValue(plugin.settings.displayNameOrder.join(", "))
				.onChange(async (value) => {
					plugin.settings.displayNameOrder = value
						.split(",")
						.map((v) => v.trim())
						.filter((v) => v.length > 0);
					await plugin.saveSettings();
					plugin.indexer.updateSettings(plugin.settings);
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
				.setValue(plugin.settings.defaultNewNotePath)
				.onChange(async (value) => {
					plugin.settings.defaultNewNotePath = normalizePath(value);
					await plugin.saveSettings();
				});
			new PathInputSuggest(plugin, text.inputEl);
		});

	new Setting(containerEl)
		.setName("Open on startup")
		.setDesc("Automatically open the abstract folders view when Obsidian starts.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.startupOpen).onChange(async (value) => {
				plugin.settings.startupOpen = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Open position")
		.setDesc("Which side sidebar to open the view in.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("left", "Left")
				.addOption("right", "Right")
				.setValue(plugin.settings.openSide)
				.onChange(async (value: "left" | "right") => {
					plugin.settings.openSide = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Show ribbon icon")
		.setDesc("Toggle the visibility of the abstract folders icon in the left ribbon.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showRibbonIcon).onChange(async (value) => {
				plugin.settings.showRibbonIcon = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl).setName("Advanced (v2 engine)").setHeading();

	new Setting(containerEl)
		.setName("Use v2 engine (beta)")
		.setDesc("Enable the new high-performance graph engine and virtual viewport. This is experimental and may have bugs.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.useV2Engine).onChange(async (value) => {
				plugin.settings.useV2Engine = value;
				await plugin.saveSettings();
				new Notice("Please reload Obsidian or the plugin for the engine change to take effect.");
			}),
		);

	renderExcludedPaths(containerEl, plugin);
}

function renderExcludedPaths(containerEl: HTMLElement, plugin: AbstractFolderPlugin): void {
	new Setting(containerEl)
		.setName("Excluded paths")
		.setDesc("The plugin will ignore these folders and their contents.")
		.setHeading();

	const excludedPathsContainer = containerEl.createDiv({
		cls: "abstract-folder-excluded-paths-container",
	});

	const renderList = () => {
		excludedPathsContainer.empty();
		plugin.settings.excludedPaths.forEach((path, index) => {
			new Setting(excludedPathsContainer)
				.addText((text) => {
					text.setPlaceholder("Path to exclude");
					text.setValue(path);
					new PathInputSuggest(plugin, text.inputEl);
					text.onChange(async (value) => {
						plugin.settings.excludedPaths[index] = normalizePath(value);
						await plugin.saveSettings();
						plugin.indexer.updateSettings(plugin.settings);
					});
				})
				.addButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove path")
						.onClick(async () => {
							plugin.settings.excludedPaths.splice(index, 1);
							await plugin.saveSettings();
							plugin.indexer.updateSettings(plugin.settings);
							renderList();
						}),
				);
		});
	};

	renderList();

	new Setting(containerEl).addExtraButton((button) =>
		button
			.setIcon("plus")
			.setTooltip("Add new excluded path")
			.onClick(async () => {
				plugin.settings.excludedPaths.push(normalizePath(""));
				await plugin.saveSettings();
				renderList();
			}),
	);
}
