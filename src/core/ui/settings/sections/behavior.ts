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

	new Setting(containerEl)
		.setName("Hide non-markdown orphans")
		.setDesc("Hide files (images, PDFs, etc.) that are not linked as children of any note. They will still be visible if they are explicitly linked.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.hideNonMarkdownOrphans).onChange(async (value) => {
				plugin.settings.hideNonMarkdownOrphans = value;
				await plugin.saveSettings();
				// Trigger a full re-build of the tree
				// @ts-ignore: Custom event
				plugin.app.workspace.trigger('abstract-folder:graph-updated');
			}),
		);

	new Setting(containerEl).setName("Naming conflict resolution").setHeading();

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
