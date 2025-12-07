import { App, PluginSettingTab, Setting, AbstractInputSuggest, normalizePath } from 'obsidian';
import AbstractFolderPlugin from '../../main'; // Adjust path if necessary

// Helper for path suggestions
export class PathInputSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, private inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): string[] {
        const files = this.app.vault.getAllLoadedFiles();
        const paths: string[] = [];
        for (const file of files) {
            paths.push(file.path);
        }

        const lowerCaseInputStr = inputStr.toLowerCase();
        return paths.filter(path =>
            path.toLowerCase().includes(lowerCaseInputStr)
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

		new Setting(containerEl)
			.setName("Parent property name")
			.setDesc("The frontmatter property key used to define parent notes (e.g., 'parent' or 'folder'). This setting is case-sensitive, so ensure your frontmatter property name matches the casing exactly.")
			.addText((text) =>
				text
					.setPlaceholder("Example: parent")
					.setValue(this.plugin.settings.propertyName)
					.onChange(async (value) => {
						this.plugin.settings.propertyName = value;
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(this.plugin.settings); // Notify indexer of setting change
					})
			);

		new Setting(containerEl)
			.setName("Show aliases")
			.setDesc("Use the first alias as the display name in the abstract folders view if available.")
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
			.setName("Expand parent folders for active file")
			.setDesc("Automatically expand all parent folders in the tree view to reveal the active file's location. This ensures that even if a file has multiple parents, all ancestors will be expanded. The active file will always be highlighted.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoExpandParents)
					.onChange(async (value) => {
						this.plugin.settings.autoExpandParents = value;
						await this.plugin.saveSettings();
						// No indexer update needed, fileRevealManager uses settings directly
					})
			);

		new Setting(containerEl)
			.setName("Remember expanded folders")
			.setDesc("Keep folders expanded even when switching views or restarting Obsidian.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rememberExpanded)
					.onChange(async (value) => {
						this.plugin.settings.rememberExpanded = value;
						if (!value) {
							this.plugin.settings.expandedFolders = [];
						}
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Open on startup")
			.setDesc("Automatically open the abstract folders view when Obsidian starts.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.startupOpen)
					.onChange(async (value) => {
						this.plugin.settings.startupOpen = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Open position")
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
			.setName("Show ribbon icon")
			.setDesc("Toggle the visibility of the abstract folders icon in the left ribbon.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						await this.plugin.saveSettings();
						// The main plugin class's saveSettings will call updateRibbonIconVisibility
					})
			);

		new Setting(containerEl)
			.setName("Visual")
			.setHeading();

		new Setting(containerEl)
			.setName("Enable rainbow indents")
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
			.setName("Rainbow indent palette")
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

		new Setting(containerEl)
			.setName("Rainbow indent - varied item colors")
			.setDesc("If enabled, sibling items at the same indentation level will use different colors from the palette, making them easier to distinguish. If disabled, all items at the same depth will share the same color.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enablePerItemRainbowColors)
					.onChange(async (value) => {
						this.plugin.settings.enablePerItemRainbowColors = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(this.plugin.settings);
					})
			);
		new Setting(containerEl)
			.setName("Rainbow indent - varied item colors")
			.setDesc("If enabled, sibling items at the same indentation level will use different colors from the palette, making them easier to distinguish. If disabled, all items at the same depth will share the same color.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enablePerItemRainbowColors)
					.onChange(async (value) => {
						this.plugin.settings.enablePerItemRainbowColors = value;
						await this.plugin.saveSettings();
						// Trigger view refresh to apply new styling
						this.plugin.indexer.updateSettings(this.plugin.settings);
					})
			);
		}

	private renderExcludedPaths(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Excluded paths")
			.setDesc("Paths to exclude from the abstract folders view.")
			.setHeading();

		const excludedPathsContainer = containerEl.createDiv({ cls: "abstract-folder-excluded-paths-container" });
		this.plugin.settings.excludedPaths.forEach((path, index) => {
			new Setting(excludedPathsContainer)
				.addText(text => {
					text.setPlaceholder("Path to exclude");
					text.setValue(path);
					new PathInputSuggest(this.app, text.inputEl);
					text.onChange(async (value) => {
						this.plugin.settings.excludedPaths[index] = normalizePath(value);
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(this.plugin.settings);
					});
				})
				.addButton(button => button
					.setButtonText("Remove")
					.setIcon("trash")
					.onClick(async () => {
						this.plugin.settings.excludedPaths.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.indexer.updateSettings(this.plugin.settings);
						this.display(); // Re-render to update the list
					}));
		});

		new Setting(containerEl)
			.addButton(button => button
				.setButtonText("Add new excluded path")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.excludedPaths.push(normalizePath("")); // Add an empty path for the new input, normalized
					await this.plugin.saveSettings();
					this.display(); // Re-render to show the new input field
				}));
	}
}