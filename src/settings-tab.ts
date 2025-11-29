import { App, PluginSettingTab, Setting } from 'obsidian';
import AbstractFolderPlugin from '../main'; // Adjust path if necessary

export class AbstractFolderSettingTab extends PluginSettingTab {
	plugin: AbstractFolderPlugin;

	constructor(app: App, plugin: AbstractFolderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Abstract Folder Settings" });


		new Setting(containerEl)
			.setName("Parent Property Name")
			.setDesc("The frontmatter property key used to define parent notes (e.g., 'parent' or 'folder'). This setting is case-sensitive, so ensure your frontmatter property name matches the casing exactly.")
			.addText((text) =>
				text
					.setPlaceholder("parent")
					.setValue(this.plugin.settings.propertyName)
					.onChange(async (value) => {
						this.plugin.settings.propertyName = value;
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(this.plugin.settings); // Notify indexer of setting change
					})
			);

		new Setting(containerEl)
			.setName("Show Aliases")
			.setDesc("Use the first alias as the display name in the Abstract Folder view if available.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAliases)
					.onChange(async (value) => {
						this.plugin.settings.showAliases = value;
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName("Auto Reveal Active File")
			.setDesc("Automatically expand the folder tree to show the currently active file.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoReveal)
					.onChange(async (value) => {
						this.plugin.settings.autoReveal = value;
						await this.plugin.saveSettings();
						// Auto reveal is handled in the view, which reads settings directly or via updates
						this.plugin.indexer.updateSettings(this.plugin.settings); // Trigger view refresh just in case
					})
			);

		new Setting(containerEl)
			.setName("Open on Startup")
			.setDesc("Automatically open the Abstract Folder view when Obsidian starts.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.startupOpen)
					.onChange(async (value) => {
						this.plugin.settings.startupOpen = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Open Position")
			.setDesc("Which side sidebar to open the view in.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("left", "Left")
					.addOption("right", "Right")
					.setValue(this.plugin.settings.openSide)
					.onChange(async (value: 'left' | 'right') => {
						this.plugin.settings.openSide = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show Ribbon Icon")
			.setDesc("Toggle the visibility of the Abstract Folders icon in the left ribbon panel.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						await this.plugin.saveSettings();
						// The main plugin class's saveSettings will call updateRibbonIconVisibility
					})
			);

		containerEl.createEl("h3", { text: "Visual Settings" });

		new Setting(containerEl)
			.setName("Enable Rainbow Indents")
			.setDesc("Color the indentation lines to visually distinguish tree depth.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableRainbowIndents)
					.onChange(async (value) => {
						this.plugin.settings.enableRainbowIndents = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(this.plugin.settings);
					})
			);

		new Setting(containerEl)
			.setName("Rainbow Indent Palette")
			.setDesc("Choose the color palette for rainbow indentation guides.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("classic", "Classic")
					.addOption("pastel", "Pastel")
					.addOption("neon", "Neon")
					.setValue(this.plugin.settings.rainbowPalette)
					.onChange(async (value: 'classic' | 'pastel' | 'neon') => {
						this.plugin.settings.rainbowPalette = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(this.plugin.settings);
					})
			);
	}
}