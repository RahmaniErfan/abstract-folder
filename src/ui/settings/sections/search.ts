import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderSearchSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Search and navigation").setHeading();

	new Setting(containerEl)
		.setName("Show children in search")
		.setDesc("Include children files in search results.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.searchShowDescendants).onChange(async (value) => {
				plugin.settings.searchShowDescendants = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Show parents in search")
		.setDesc("Include parent files in search results.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.searchShowAncestors).onChange(async (value) => {
				plugin.settings.searchShowAncestors = value;
				await plugin.saveSettings();
			}),
		);
}
