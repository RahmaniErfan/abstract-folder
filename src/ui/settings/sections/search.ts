import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderSearchSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Search and navigation").setHeading();

	new Setting(containerEl)
		.setName("Show search header")
		.setDesc("Display the search bar header in the view.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showSearchHeader).onChange(async (value) => {
				plugin.settings.showSearchHeader = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show children in search")
		.setDesc("Include children files in search results.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.searchShowChildren).onChange(async (value) => {
				plugin.settings.searchShowChildren = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Show parents in search")
		.setDesc("Include parent files in search results.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.searchShowParents).onChange(async (value) => {
				plugin.settings.searchShowParents = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Naming conflict strategy")
		.setDesc("How to resolve name conflicts in flat structure.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("parent", "Parent")
				.addOption("ancestor", "Ancestor")
				.addOption("none", "None")
				.setValue(plugin.settings.namingConflictStrategy)
				.onChange(async (value: "parent" | "ancestor" | "none") => {
					plugin.settings.namingConflictStrategy = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Naming conflict separator")
		.setDesc("Separator to use for naming conflicts.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("-", "Dash (-)")
				.addOption("brackets", "Brackets ()")
				.setValue(plugin.settings.namingConflictSeparator)
				.onChange(async (value: "-" | "brackets") => {
					plugin.settings.namingConflictSeparator = value;
					await plugin.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName("Naming conflict order")
		.setDesc("Order of parent and name in conflicts.")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("parent-first", "Parent first")
				.addOption("name-first", "Name first")
				.setValue(plugin.settings.namingConflictOrder)
				.onChange(async (value: "parent-first" | "name-first") => {
					plugin.settings.namingConflictOrder = value;
					await plugin.saveSettings();
				}),
		);
}
