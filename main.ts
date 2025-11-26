import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from './src/settings';
import { FolderIndexer } from './src/indexer';
import { AbstractFolderView, VIEW_TYPE_ABSTRACT_FOLDER } from './src/view';
import { CreateChildModal, createChildNote, ParentPickerModal } from './src/commands';


export default class AbstractFolderPlugin extends Plugin {
	settings: AbstractFolderPluginSettings;
	indexer: FolderIndexer;

	async onload() {
		await this.loadSettings();

		this.indexer = new FolderIndexer(this.app, this.settings);
		await this.indexer.onload(); // Initialize the indexer and build the graph

		this.registerView(
			VIEW_TYPE_ABSTRACT_FOLDER,
			(leaf) => new AbstractFolderView(leaf, this.indexer, this.settings)
		);

		this.addRibbonIcon("folder-tree", "Open Abstract Folders", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-abstract-folder-view",
			name: "Open Abstract Folder View",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "create-abstract-child-note",
			name: "Create Abstract Child Note",
			callback: () => {
				new CreateChildModal(this.app, this.settings, (childName) => {
					new ParentPickerModal(this.app, (parentFile) => {
						createChildNote(this.app, this.settings, childName, parentFile);
					}).open();
				}).open();
			},
		});

		this.addSettingTab(new AbstractFolderSettingTab(this.app, this));

		if (this.settings.startupOpen) {
			this.app.workspace.onLayoutReady(() => {
				this.activateView();
			});
		}
	}
onunload() {
	this.indexer.onunload();
	this.app.workspace.detachLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
}

async activateView() {
	this.app.workspace.detachLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);

	const side = this.settings.openSide;
	const leaf = side === 'left' ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false);

	if (leaf) {
		await leaf.setViewState({
			type: VIEW_TYPE_ABSTRACT_FOLDER,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}
}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AbstractFolderSettingTab extends PluginSettingTab {
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
			.setDesc("The frontmatter property key used to define parent notes (e.g., 'parent' or 'folder').")
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
	}
}
