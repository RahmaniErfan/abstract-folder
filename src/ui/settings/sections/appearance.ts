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
		.setName("View style")
		.setDesc("Choose between tree and column view.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("tree", "Tree")
				.addOption("column", "Column")
				.setValue(plugin.settings.viewStyle)
				.onChange(async (value: "tree" | "column") => {
					plugin.settings.viewStyle = value;
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
}
