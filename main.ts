import { Plugin, WorkspaceLeaf } from 'obsidian';
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from './src/settings';
import { FolderIndexer } from './src/indexer';
import { AbstractFolderView, VIEW_TYPE_ABSTRACT_FOLDER } from './src/view';
import { CreateAbstractChildModal, ParentPickerModal, ChildFileType, FolderSelectionModal, ConversionOptionsModal, DestinationPickerModal, NewFolderNameModal, SimulationModal, ScopeSelectionModal } from './src/ui/modals';
import { AbstractFolderSettingTab } from './src/ui/settings-tab';
import { createAbstractChildFile } from './src/file-operations';
import { convertFoldersToPluginFormat, generateFolderStructurePlan, executeFolderGeneration } from './src/conversion';
import { TFolder, TFile } from 'obsidian';

export default class AbstractFolderPlugin extends Plugin {
	settings: AbstractFolderPluginSettings;
	indexer: FolderIndexer;
	ribbonIconEl: HTMLElement | null = null; // To store the ribbon icon element

	async onload() {
		await this.loadSettings();

		this.indexer = new FolderIndexer(this.app, this.settings);
		await this.indexer.onload(); // Initialize the indexer and build the graph

		this.registerView(
			VIEW_TYPE_ABSTRACT_FOLDER,
			(leaf) => new AbstractFolderView(leaf, this.indexer, this.settings, this) // Pass the plugin instance
		);

		// Initialize ribbon icon visibility based on settings
		this.updateRibbonIconVisibility();

		this.addCommand({
			id: "open-abstract-folder-view",
			name: "Open Abstract Folder View",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "create-abstract-child-note",
			name: "Create Abstract Child",
			callback: () => {
				new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
					new ParentPickerModal(this.app, (parentFile) => {
						createAbstractChildFile(this.app, this.settings, childName, parentFile, childType);
					}).open();
				}).open();
			},
		});

		this.addCommand({
			id: "convert-folder-to-plugin",
			name: "Convert folder structure to plugin format",
			callback: () => {
				new FolderSelectionModal(this.app, (folder: TFolder) => {
					new ConversionOptionsModal(this.app, folder, (options) => {
						convertFoldersToPluginFormat(this.app, this.settings, folder, options);
					}).open();
				}).open();
			}
		});

		this.addCommand({
			id: "create-folders-from-plugin",
			name: "Create folder structure from plugin format",
			callback: () => {
				new ScopeSelectionModal(this.app, (scope) => {
					new DestinationPickerModal(this.app, (parentFolder: TFolder) => {
						new NewFolderNameModal(this.app, parentFolder, (destinationPath: string) => {
							const rootScope = scope === 'vault' ? undefined : (scope as TFile);
							generateFolderStructurePlan(this.app, this.settings, this.indexer, destinationPath, rootScope).then(plan => {
								new SimulationModal(this.app, plan.conflicts, (resolvedConflicts) => {
									executeFolderGeneration(this.app, plan);
								}).open();
							});
						}).open();
					}).open();
				}).open();
			}
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
		// Ensure the ribbon icon is removed on unload
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	async activateView() {
		let leaf: WorkspaceLeaf | null = null;
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);

		if (leaves.length > 0) {
			// If a leaf of our view type already exists, use it
			leaf = leaves[0];
		} else {
			// No existing leaf found, create a new one
			const side = this.settings.openSide;
			// Attempt to get an existing leaf in the target sidebar without forcing creation
			// Then, if still null, create a new one.
			if (side === 'left') {
				leaf = this.app.workspace.getLeftLeaf(false); // Try to get existing left leaf
				if (!leaf) {
					leaf = this.app.workspace.getLeftLeaf(true); // If none, create a new one
				}
			} else { // right
				leaf = this.app.workspace.getRightLeaf(false); // Try to get existing right leaf
				if (!leaf) {
					leaf = this.app.workspace.getRightLeaf(true); // If none, create a new one
				}
			}
		}

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
		this.updateRibbonIconVisibility(); // Update ribbon icon visibility on settings change
	}

	updateRibbonIconVisibility() {
		if (this.settings.showRibbonIcon) {
			if (!this.ribbonIconEl) {
				// Add the ribbon icon if it doesn't exist and setting is true
				this.ribbonIconEl = this.addRibbonIcon("folder-tree", "Open Abstract Folders", () => {
					this.activateView();
				});
			}
		} else {
			// Remove the ribbon icon if it exists and setting is false
			if (this.ribbonIconEl) {
				this.ribbonIconEl.remove();
				this.ribbonIconEl = null;
			}
		}
	}
}
