/**
 * @file main.ts
 * @description Plugin entry point for Abstract Folder.
 * @author Erfan Rahmani
 * @license GPL-3.0
 * @copyright 2025 Erfan Rahmani
 */

import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { Logger } from './src/utils/logger';
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from './src/settings';
import { FolderIndexer } from './src/indexer';
import { MetricsManager } from './src/metrics-manager';
import { AbstractFolderView, VIEW_TYPE_ABSTRACT_FOLDER } from './src/view';
import { CreateAbstractChildModal, ParentPickerModal, ChildFileType, FolderSelectionModal, ConversionOptionsModal, DestinationPickerModal, NewFolderNameModal, SimulationModal, ScopeSelectionModal, CreateEditGroupModal } from './src/ui/modals';
import { ManageGroupsModal } from './src/ui/modals/manage-groups-modal';
import { AbstractFolderSettingTab } from './src/ui/settings-tab';
import { createAbstractChildFile } from './src/utils/file-operations';
import { convertFoldersToPluginFormat, generateFolderStructurePlan, executeFolderGeneration } from './src/utils/conversion';
import { TFolder, TFile } from 'obsidian';
import { Group } from './src/types';
import './src/styles/index.css';

export default class AbstractFolderPlugin extends Plugin {
	settings: AbstractFolderPluginSettings;
	indexer: FolderIndexer;
	metricsManager: MetricsManager;
	ribbonIconEl: HTMLElement | null = null;

	async onload() {
		Logger.debug("Starting onload...");
		await this.loadSettings();

		this.indexer = new FolderIndexer(this.app, this.settings, this);
		this.metricsManager = new MetricsManager(this.app, this.indexer, this);
		Logger.debug("Initializing indexer...");
		this.indexer.initializeIndexer();

		this.registerView(
			VIEW_TYPE_ABSTRACT_FOLDER,
			(leaf) => new AbstractFolderView(leaf, this.indexer, this.settings, this, this.metricsManager)
		);

		this.updateRibbonIconVisibility();

		this.addCommand({
			id: "open-view",
			name: "Open view",
			callback: () => {
				this.activateView().catch(console.error);
			},
		});

		this.addCommand({
			id: "focus-active-file",
			name: "Toggle focus on active file in abstract tree",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice("No active file to focus.");
					return;
				}

				this.activateView().then(() => {
					const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
					if (leaves.length > 0) {
						const view = leaves[0].view as AbstractFolderView;
						view.focusFile(activeFile.path);
					}
				}).catch(console.error);
			}
		});

		this.addCommand({
			id: "focus-search",
			name: "Focus search bar",
			callback: () => {
				this.activateView().then(() => {
					const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
					if (leaves.length > 0) {
						const view = leaves[0].view as AbstractFolderView;
						view.focusSearch();
					}
				}).catch(console.error);
			}
		});

		this.addCommand({
			id: "create-child",
			name: "Create abstract child",
			callback: () => {
				new CreateAbstractChildModal(this.app, this.settings, (childName: string, childType: ChildFileType) => {
					new ParentPickerModal(this.app, (parentFile) => {
						createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.indexer)
							.catch(console.error);
					}).open();
				}).open();
			},
		});

this.addCommand({
	id: "manage-groups",
	name: "Manage groups",
	callback: () => {
		new ManageGroupsModal(this.app, this.settings, (updatedGroups: Group[], activeGroupId: string | null) => {
			this.settings.groups = updatedGroups;
			this.settings.activeGroupId = activeGroupId;
			this.saveSettings().then(() => {
				this.app.workspace.trigger('abstract-folder:group-changed');
			}).catch(console.error);
		}).open();
	},
});

		this.addCommand({
			id: "create-group-with-active-file",
			name: "Create group with active file",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice("No active file to create a group from.");
					return;
				}

				const prefilledGroup: Group = {
					id: Math.random().toString(36).substring(2, 15),
					name: activeFile.basename,
					parentFolders: [activeFile.path],
				};

				new CreateEditGroupModal(this.app, this.settings, prefilledGroup, (updatedGroup: Group) => {
					this.settings.groups.push(updatedGroup);
					this.settings.activeGroupId = updatedGroup.id;
					this.saveSettings().then(() => {
						this.app.workspace.trigger('abstract-folder:group-changed');
						this.activateView().catch(console.error);
					}).catch(console.error);
				}).open();
			}
		});

this.addCommand({
	id: "clear-active-group",
	name: "Clear active group",
	callback: () => {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
		if (leaves.length > 0) {
			const view = leaves[0].view as AbstractFolderView;
			view.clearActiveGroup();
		} else if (this.settings.activeGroupId) {
			this.settings.activeGroupId = null;
			this.saveSettings().then(() => {
				new Notice("Active group cleared.");
				this.app.workspace.trigger('abstract-folder:group-changed');
			}).catch(console.error);
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
				convertFoldersToPluginFormat(this.app, this.settings, folder, options)
					.catch(console.error);
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
							}).catch(console.error);
						}

						const rootScope = (scope instanceof TFile) ? scope : undefined;
						const plan = generateFolderStructurePlan(this.app, this.settings, this.indexer, destinationPath, placeIndexFileInside, rootScope);
						new SimulationModal(this.app, plan.conflicts, (resolvedConflicts) => {
							executeFolderGeneration(this.app, plan).catch((error) => console.error(error));
						}).open();
					}).open();
				}).open();
			}).open();
		}
	});
		this.addSettingTab(new AbstractFolderSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.metricsManager.applyDecay();
			this.indexer.rebuildGraphAndTriggerUpdate();
			if (this.settings.startupOpen) {
				this.activateView().catch(console.error);
			}
		});
	}

	onunload() {
		Logger.debug("Starting onunload...");
		this.indexer.onunload();
		Logger.debug("Saving metrics...");
		void this.metricsManager.saveMetrics();
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
			if (side === 'left') {
				leaf = this.app.workspace.getLeftLeaf(false);
				if (!leaf) {
					leaf = this.app.workspace.getLeftLeaf(true);
				}
			} else { // right
				leaf = this.app.workspace.getRightLeaf(false);
				if (!leaf) {
					leaf = this.app.workspace.getRightLeaf(true);
				}
			}
		}

		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_ABSTRACT_FOLDER,
				active: true,
			});
			if (leaf instanceof WorkspaceLeaf) {
				void this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as AbstractFolderPluginSettings);

		// Migration: Ensure multiple property name arrays are initialized from legacy settings
		if (this.settings.propertyName && (!this.settings.parentPropertyNames || this.settings.parentPropertyNames.length === 0)) {
			this.settings.parentPropertyNames = [this.settings.propertyName];
		}
		if (this.settings.childrenPropertyName && (!this.settings.childrenPropertyNames || this.settings.childrenPropertyNames.length === 0)) {
			this.settings.childrenPropertyNames = [this.settings.childrenPropertyName];
		}

		// Cleanup: Remove legacy "views" field if it exists in the data.json as it causes issues in newer versions
		// and is no longer part of the settings interface.
		const settingsRecord = this.settings as unknown as Record<string, unknown>;
		if (settingsRecord.views) {
			Logger.debug("Found legacy 'views' field in settings, removing it.");
			delete settingsRecord.views;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateRibbonIconVisibility();
	}

	updateRibbonIconVisibility() {
		if (this.settings.showRibbonIcon) {
			if (!this.ribbonIconEl) {
				this.ribbonIconEl = this.addRibbonIcon("folder-tree", "Open abstract folders", () => {
					this.activateView().catch(console.error);
				});
			}
		} else {
			if (this.ribbonIconEl) {
				this.ribbonIconEl.remove();
				this.ribbonIconEl = null;
			}
		}
	}
}
