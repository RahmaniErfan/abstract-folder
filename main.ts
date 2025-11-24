import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from './src/settings';
import { FolderIndexer } from './src/indexer';
import { AbstractFolderView, VIEW_TYPE_ABSTRACT_FOLDER } from './src/view';


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

		this.addRibbonIcon("folder", "Open Abstract Folders", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-abstract-folder-view",
			name: "Open Abstract Folder View",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new AbstractFolderSettingTab(this.app, this));
	}
onunload() {
	this.indexer.onunload();
	this.app.workspace.detachLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
}

async activateView() {
	this.app.workspace.detachLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);

	const leaf = this.app.workspace.getRightLeaf(false);
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
	}
}
