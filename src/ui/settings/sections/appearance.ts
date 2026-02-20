import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderAppearanceSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Appearance").setHeading();

	new Setting(containerEl)
		.setName("Enable rainbow indents")
		.setDesc("Enable rainbow indentation guides.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.enableRainbowIndents).onChange(async (value) => {
				plugin.settings.enableRainbowIndents = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Rainbow palette")
		.setDesc("The color palette for rainbow indents.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("classic", "Classic")
				.addOption("pastel", "Pastel")
				.addOption("neon", "Neon")
				.setValue(plugin.settings.rainbowPalette)
				.onChange(async (value: "classic" | "pastel" | "neon") => {
					plugin.settings.rainbowPalette = value;
					await plugin.saveSettings();
					plugin.app.workspace.trigger("abstract-folder:graph-updated");
				}),
		);

	new Setting(containerEl)
		.setName("Enable per-item rainbow colors")
		.setDesc("Use varied colors for indentation guides of sibling items.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.enablePerItemRainbowColors).onChange(async (value) => {
				plugin.settings.enablePerItemRainbowColors = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Max menu name length")
		.setDesc("Maximum length of file names shown in menus and dropdowns.")
		.addSlider((slider) =>
			slider
				.setLimits(5, 50, 1)
				.setValue(plugin.settings.maxMenuNameLength)
				.setDynamicTooltip()
				.onChange(async (value) => {
					plugin.settings.maxMenuNameLength = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl).setName("Visibility").setHeading();

	new Setting(containerEl)
		.setName("Show focus active file button")
		.setDesc("Show the button to focus the active file in the abstract tree.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showFocusActiveFileButton).onChange(async (value) => {
				plugin.settings.showFocusActiveFileButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show search bar header")
		.setDesc("Show the search bar and filter/sort buttons.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showSearchHeader).onChange(async (value) => {
				plugin.settings.showSearchHeader = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show group button")
		.setDesc("Show the button to manage groups.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showGroupButton).onChange(async (value) => {
				plugin.settings.showGroupButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show create note button")
		.setDesc("Show the button to create a new abstract note.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showCreateNoteButton).onChange(async (value) => {
				plugin.settings.showCreateNoteButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show conversion button")
		.setDesc("Show the button to convert folders to plugin format.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showConversionButton).onChange(async (value) => {
				plugin.settings.showConversionButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show collapse all button")
		.setDesc("Show the button to collapse all folders.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showCollapseAllButton).onChange(async (value) => {
				plugin.settings.showCollapseAllButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show expand all button")
		.setDesc("Show the button to expand all folders.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showExpandAllButton).onChange(async (value) => {
				plugin.settings.showExpandAllButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show sort button")
		.setDesc("Show the button to change sorting.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showSortButton).onChange(async (value) => {
				plugin.settings.showSortButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show filter button")
		.setDesc("Show the button to filter files.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showFilterButton).onChange(async (value) => {
				plugin.settings.showFilterButton = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);
}
