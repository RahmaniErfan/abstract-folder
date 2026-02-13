import { Setting, AbstractInputSuggest } from "obsidian";
import type AbstractFolderPlugin from "main";

export class PathInputSuggest extends AbstractInputSuggest<string> {
	constructor(private plugin: AbstractFolderPlugin, textInputEl: HTMLInputElement) {
		super(plugin.app, textInputEl);
	}

	getSuggestions(inputStr: string): string[] {
		const abstractFiles = this.plugin.app.vault.getAllLoadedFiles();
		const folders: string[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((file) => {
			if (
				file instanceof (window as any).TFolder &&
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
		(this as any).textInputEl.value = value;
		(this as any).textInputEl.trigger("input");
		this.close();
	}
}

export function renderGeneralSettings(containerEl: HTMLElement, plugin: AbstractFolderPlugin) {
	new Setting(containerEl).setName("General").setHeading();

	new Setting(containerEl)
		.setName("Parent property name")
		.setDesc("The frontmatter property key used to define parent notes (child-defined parent).")
		.addText((text) =>
			text
				.setPlaceholder("parent")
				.setValue(plugin.settings.propertyName)
				.onChange(async (value) => {
					plugin.settings.propertyName = value;
					if (!plugin.settings.parentPropertyNames.includes(value)) {
						plugin.settings.parentPropertyNames.push(value);
					}
					await plugin.saveSettings();
					plugin.indexer.updateSettings(plugin.settings);
				}),
		);

	new Setting(containerEl)
		.setName("Children property name")
		.setDesc("The frontmatter property key used by a parent to define its children (parent-defined children).")
		.addText((text) =>
			text
				.setPlaceholder("children")
				.setValue(plugin.settings.childrenPropertyName)
				.onChange(async (value) => {
					plugin.settings.childrenPropertyName = value;
					if (!plugin.settings.childrenPropertyNames.includes(value)) {
						plugin.settings.childrenPropertyNames.push(value);
					}
					await plugin.saveSettings();
					plugin.indexer.updateSettings(plugin.settings);
				}),
		);

	new Setting(containerEl)
		.setName("Show aliases")
		.setDesc("Show aliases instead of file names in the view.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showAliases).onChange(async (value) => {
				plugin.settings.showAliases = value;
				await plugin.saveSettings();
				plugin.app.workspace.trigger("abstract-folder:graph-updated");
			}),
		);

	new Setting(containerEl)
		.setName("Show ribbon icon")
		.setDesc("Display the ribbon icon to open the abstract folder view.")
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.showRibbonIcon).onChange(async (value) => {
				plugin.settings.showRibbonIcon = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName("Default new note path")
		.setDesc("Default path for newly created notes.")
		.addText((text) => {
			text.setPlaceholder("Folder/Path")
				.setValue(plugin.settings.defaultNewNotePath)
				.onChange(async (value) => {
					plugin.settings.defaultNewNotePath = value;
					await plugin.saveSettings();
				});
			new PathInputSuggest(plugin, text.inputEl);
		});

	renderExcludedPaths(containerEl, plugin);
}

function renderExcludedPaths(containerEl: HTMLElement, plugin: AbstractFolderPlugin): void {
	const excludedPathsContainer = containerEl.createDiv();
	new Setting(excludedPathsContainer)
		.setName("Excluded paths")
		.setDesc("Paths to exclude from the abstract folder view (e.g., export folders).")
		.setHeading();

	plugin.settings.excludedPaths.forEach((path, index) => {
		new Setting(excludedPathsContainer)
			.addText((text) => {
				text.setPlaceholder("Folder/Path")
					.setValue(path)
					.onChange(async (value) => {
						plugin.settings.excludedPaths[index] = value;
						await plugin.saveSettings();
						plugin.indexer.updateSettings(plugin.settings);
					});
				new PathInputSuggest(plugin, text.inputEl);
			})
			.addButton((button) =>
				button
					.setIcon("trash")
					.setTooltip("Remove path")
					.onClick(async () => {
						plugin.settings.excludedPaths.splice(index, 1);
						await plugin.saveSettings();
						plugin.indexer.updateSettings(plugin.settings);
						renderExcludedPaths(containerEl, plugin);
					}),
			);
	});

	new Setting(excludedPathsContainer).addExtraButton((button) =>
		button
			.setIcon("plus")
			.setTooltip("Add excluded path")
			.onClick(async () => {
				plugin.settings.excludedPaths.push("");
				await plugin.saveSettings();
				renderExcludedPaths(containerEl, plugin);
			}),
	);
}
