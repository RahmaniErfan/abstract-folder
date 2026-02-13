import { Setting } from "obsidian";
import type AbstractFolderPlugin from "main";

export function renderBehaviorSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("Behavior").setHeading();

	new Setting(containerEl)
		.setName("Auto-expand parents")
		.setDesc("Automatically expand parent folders when revealing the active file.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.autoExpandParents).onChange(async (value) => {
				plugin.settings.autoExpandParents = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Auto-scroll to active file")
		.setDesc("Automatically scroll to the active file when opening it.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.autoScrollToActiveFile).onChange(async (value) => {
				plugin.settings.autoScrollToActiveFile = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Auto-expand children")
		.setDesc("Automatically expand all children folders when a file is opened.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.autoExpandChildren).onChange(async (value) => {
				plugin.settings.autoExpandChildren = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Open view on startup")
		.setDesc("Open the abstract folder view when the plugin loads.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.startupOpen).onChange(async (value) => {
				plugin.settings.startupOpen = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Open side")
		.setDesc("Which side panel to open the view in.")
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
		.setName("Remember expanded state")
		.setDesc("Remember the expanded and collapsed state of folders.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.rememberExpanded).onChange(async (value) => {
				plugin.settings.rememberExpanded = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Expand target folder on drop")
		.setDesc("Automatically expand the target folder after a drag-and-drop operation.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.expandTargetFolderOnDrop).onChange(async (value) => {
				plugin.settings.expandTargetFolderOnDrop = value;
				await plugin.saveSettings();
			}),
		);
}
