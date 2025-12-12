/**
 * @file main.ts
 * @description Plugin entry point for Abstract Folder.
 * @author Erfan Rahmani
 * @license GPL-3.0
 * @copyright 2025 Erfan Rahmani
 */

import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from './src/settings';
import { FolderIndexer } from './src/indexer';
import { AbstractFolderView, VIEW_TYPE_ABSTRACT_FOLDER } from './src/view';
import { CreateAbstractChildModal, ParentPickerModal, ChildFileType, FolderSelectionModal, ConversionOptionsModal, DestinationPickerModal, NewFolderNameModal, SimulationModal, ScopeSelectionModal } from './src/ui/modals';
import { ManageGroupsModal } from './src/ui/modals/manage-groups-modal';
import { AbstractFolderSettingTab } from './src/ui/settings-tab';
import { createAbstractChildFile } from './src/utils/file-operations';
import { convertFoldersToPluginFormat, generateFolderStructurePlan, executeFolderGeneration } from './src/utils/conversion';
import { TFolder, TFile } from 'obsidian';
import { Group } from './src/types';

export default class AbstractFolderPlugin extends Plugin {
	settings: AbstractFolderPluginSettings;
	indexer: FolderIndexer;
	ribbonIconEl: HTMLElement | null = null; // To store the ribbon icon element

	async onload() {
		await this.loadSettings();

		this.indexer = new FolderIndexer(this.app, this.settings, this);
		await this.indexer.initializeIndexer(); // Initialize the indexer (registers events)

		this.registerView(
			VIEW_TYPE_ABSTRACT_FOLDER,
			(leaf) => new AbstractFolderView(leaf, this.indexer, this.settings, this) // Pass the plugin instance
		);

		// Initialize ribbon icon visibility based on settings
		this.updateRibbonIconVisibility();

		this.addCommand({
			id: "open-view",
			name: "Open view",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "create-child",
			name: "Create abstract child",
			callback: () => {
				new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
					new ParentPickerModal(this.app, (parentFile) => {
						createAbstractChildFile(this.app, this.settings, childName, parentFile, childType);
					}).open();
				}).open();
			},
		});

this.addCommand({
	id: "manage-groups",
	name: "Manage groups",
	callback: () => {
		new ManageGroupsModal(this.app, this.settings, async (updatedGroups: Group[], activeGroupId: string | null) => {
			this.settings.groups = updatedGroups;
			this.settings.activeGroupId = activeGroupId;
			await this.saveSettings();
			// Trigger a view update after groups are managed
			this.app.workspace.trigger('abstract-folder:group-changed');
		}).open();
	},
});

this.addCommand({
	id: "clear-active-group",
	name: "Clear active group",
	callback: async () => {
		if (this.settings.activeGroupId) {
			this.settings.activeGroupId = null;
			await this.saveSettings();
			new Notice("Active group cleared.");
			this.app.workspace.trigger('abstract-folder:group-changed');
		} else {
			new Notice("No active group to clear.");
		}
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
						new NewFolderNameModal(this.app, parentFolder, (destinationPath: string, placeIndexFileInside: boolean) => {
							// Automatically add the export folder to excluded paths if not already present
							if (!this.settings.excludedPaths.includes(destinationPath)) {
								this.settings.excludedPaths.push(destinationPath);
								this.saveSettings().then(() => {
									this.indexer.updateSettings(this.settings);
								});
							}

							const rootScope = (scope instanceof TFile) ? scope : undefined;
							generateFolderStructurePlan(this.app, this.settings, this.indexer, destinationPath, placeIndexFileInside, rootScope).then(plan => {
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

		      this.addCommand({
		          id: "debug-log-graph",
		          name: "Debug: log folder graph",
		          callback: () => {
		              const graph = this.indexer.getGraph();
		              console.log("--- Abstract Folder Graph Debug ---");
		              console.log("Parent -> Children Map:", graph.parentToChildren);
		              console.log("Child -> Parents Map:", graph.childToParents);
		              console.log("All Files:", graph.allFiles);
		              
		              // Detailed file check
		              console.log("--- Detailed File Frontmatter Check ---");
		              this.app.vault.getMarkdownFiles().forEach(file => {
		                  const cache = this.app.metadataCache.getFileCache(file);
		                  if (cache?.frontmatter) {
		                      console.log(`File: ${file.path}`);
		                      console.log(`  Parents (${this.settings.propertyName}):`, cache.frontmatter[this.settings.propertyName]);
		                      console.log(`  Children (${this.settings.childrenPropertyName}):`, cache.frontmatter[this.settings.childrenPropertyName]);
		                  }
		              });
		              console.log("-----------------------------------");
		          }
		      });

		// Defer initial graph building until the workspace layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.indexer.rebuildGraphAndTriggerUpdate(); // Build graph and notify view
			if (this.settings.startupOpen) {
				this.activateView();
			}
		});
	}

	onunload() {
		this.indexer.onunload();
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
				this.ribbonIconEl = this.addRibbonIcon("folder-tree", "Open abstract folders", () => {
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
