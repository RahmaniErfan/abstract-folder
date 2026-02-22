/**
 * @file main.ts
 * @description Plugin entry point for Abstract Folder.
 * @author Erfan Rahmani
 * @license GPL-3.0
 * @copyright 2025 Erfan Rahmani
 */

import { Plugin, WorkspaceLeaf, Notice, TFolder, TFile } from 'obsidian';
import { Logger } from './src/utils/logger';
import { AbstractFolderPluginSettings, DEFAULT_SETTINGS } from './src/settings';
import { MetricsManager } from './src/metrics-manager';
import { AbstractFolderView, VIEW_TYPE_ABSTRACT_FOLDER } from './src/ui/view/abstract-folder-view';
import { GraphEngine } from './src/core/graph-engine';
import { CreateAbstractChildModal, ParentPickerModal, ChildFileType, FolderSelectionModal, ConversionOptionsModal, DestinationPickerModal, NewFolderNameModal, SimulationModal, ScopeSelectionModal } from './src/ui/modals';
import { CreateEditGroupModal } from './src/ui/modals/create-edit-group-modal';
import { ManageGroupsModal } from './src/ui/modals/manage-groups-modal';
import { ModularSettingsTab as AbstractFolderSettingTab } from './src/ui/settings/index';
import { createAbstractChildFile } from './src/utils/file-operations';
import { convertFoldersToPluginFormat, generateFolderStructurePlan, executeFolderGeneration } from './src/utils/conversion';
import { Group } from './src/types';
import { LibraryManager } from './src/library/git/library-manager';
import { AbstractBridge } from './src/library/bridge/abstract-bridge';
import { ContributionEngine } from './src/library/services/contribution-engine';
import { CatalogModal } from './src/ui/modals/catalog-modal';
import { LibraryExplorerView, VIEW_TYPE_LIBRARY_EXPLORER } from './src/library/ui/library-explorer-view';
import { LibraryCenterView, VIEW_TYPE_LIBRARY_CENTER } from './src/library/ui/library-center-view';
import { AbstractSpacesExplorerView, ABSTRACT_SPACES_VIEW_TYPE } from './src/ui/view/abstract-spaces-explorer';
import './src/styles/index.css';
import './src/styles/library-explorer.css';
import './src/styles/merge-view.css';
import { TreeBuilder } from './src/core/tree-builder';
import { ContextEngine } from './src/core/context-engine';
import { ScopeProjector } from './src/core/scope-projector';
import { TransactionManager } from './src/core/transaction-manager';
import { SecurityManager } from './src/core/security-manager';

import { ContextMenuHandler } from './src/ui/context-menu';

export default class AbstractFolderPlugin extends Plugin {
	settings: AbstractFolderPluginSettings;
	libraryManager: LibraryManager;
	abstractBridge: AbstractBridge;
	contributionEngine: ContributionEngine;
	metricsManager: MetricsManager;
	securityManager: SecurityManager;
	contextMenuHandler: ContextMenuHandler;
	abstractRibbonIconEl: HTMLElement | null = null;
	libraryRibbonIconEl: HTMLElement | null = null;
	spacesRibbonIconEl: HTMLElement | null = null;

	// SOVM Singletons
	graphEngine: GraphEngine;
	treeBuilder: TreeBuilder;
	contextEngine: ContextEngine;
	scopeProjector: ScopeProjector;
	transactionManager: TransactionManager;

	async onload() {
		Logger.debug("Starting onload...");
		await this.loadSettings();

		// Initialize Abstract Library services
		this.abstractBridge = new AbstractBridge(this.app, this.settings);
		this.contributionEngine = new ContributionEngine(this.app);
		this.securityManager = new SecurityManager(this.settings);
		this.libraryManager = new LibraryManager(this.app, this.settings, this.securityManager);

		// Initialize Graph Engine
		this.graphEngine = new GraphEngine(this.app, this.settings);
		this.graphEngine.initialize(); // Registers events, indexing deferred
		
		this.metricsManager = new MetricsManager(this.app, this.graphEngine, this);
		
		this.treeBuilder = new TreeBuilder(this.app, this.graphEngine, this.metricsManager);
		this.contextEngine = new ContextEngine(this, 'global');
		this.scopeProjector = new ScopeProjector();
		this.transactionManager = new TransactionManager(this.app, this.graphEngine, this.settings);

		this.contextMenuHandler = new ContextMenuHandler(
			this.app,
			this.settings,
			this,
			this.graphEngine,
			(path) => {
				const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
				if (leaves.length > 0) {
					const view = leaves[0].view;
					if (view instanceof AbstractFolderView) {
						view.focusFile(path);
					}
				}
			}
		);

		// Sync ScopeProjector with ContextEngineV2
		this.contextEngine.on('selection-changed', (selections: Set<string>) => {
			this.scopeProjector.update(selections);
		});

		this.registerView(
			VIEW_TYPE_ABSTRACT_FOLDER,
			(leaf) => new AbstractFolderView(leaf, this)
		);


		this.registerView(
			VIEW_TYPE_LIBRARY_EXPLORER,
			(leaf) => new LibraryExplorerView(leaf, this)
		);

        this.registerView(
            ABSTRACT_SPACES_VIEW_TYPE,
            (leaf) => new AbstractSpacesExplorerView(leaf, this)
        );

		this.registerView(
			VIEW_TYPE_LIBRARY_CENTER,
			(leaf) => new LibraryCenterView(leaf, this)
		);

		this.updateRibbonIconVisibility();

		this.addCommand({
			id: "open-library-center",
			name: "View catalogs",
			callback: () => {
				new CatalogModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: "open-library-explorer",
			name: "Open library catalog",
			callback: () => {
				this.activateLibraryExplorer().catch(console.error);
			},
		});

        this.addCommand({
            id: "open-abstract-spaces-explorer",
            name: "Open abstract spaces explorer",
            callback: () => {
                this.activateAbstractSpacesExplorer().catch(console.error);
            },
        });

		this.addCommand({
			id: "open-library-catalog-view",
			name: "Open marketplace catalog view",
			callback: () => {
				this.activateLibraryCatalogView().catch(console.error);
			},
		});

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
						const view = leaves[0].view;
						if (view instanceof AbstractFolderView) {
							void view.focusActiveFile();
						}
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
						const view = leaves[0].view;
						if (view instanceof AbstractFolderView) {
							view.focusSearch();
						}
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
						createAbstractChildFile(this.app, this.settings, childName, parentFile, childType, this.graphEngine, this.contextEngine)
							.catch(console.error);
					}).open();
				}).open();
			},
		});

this.addCommand({
	id: "manage-groups",
	name: "Manage groups",
	callback: () => {
		new ManageGroupsModal(this.app, this.contextEngine, this).open();
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
					scope: 'global',
					parentFolders: [activeFile.path],
				};

				new CreateEditGroupModal(this.app, this.settings, prefilledGroup, (updatedGroup: Group) => {
					this.settings.groups.push(updatedGroup);
					this.settings.activeGroupId = updatedGroup.id;
					this.saveSettings().then(() => {
						this.app.workspace.trigger('abstract-folder:group-changed');
						this.activateView().catch(console.error);
					}).catch(console.error);
				}, this).open();
			}
		});

this.addCommand({
	id: "clear-active-group",
	name: "Clear active group",
	callback: () => {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
		if (leaves.length > 0) {
			const view = leaves[0].view;
			if (view instanceof AbstractFolderView) {
				// TODO: Re-implement group clearing in SOVM
				// view.clearActiveGroup();
			}
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
								// No-op for now as graph engine handles settings updates reactively if needed
							}).catch(console.error);
						}

						const rootScope = (scope instanceof TFile) ? scope : undefined;
						const plan = generateFolderStructurePlan(this.app, this.settings, this.graphEngine, destinationPath, placeIndexFileInside, rootScope);
						new SimulationModal(this.app, plan.conflicts, (resolvedConflicts) => {
							executeFolderGeneration(this.app, plan).catch((error) => console.error(error));
						}).open();
					}).open();
				}).open();
			}).open();
		}
	});
		this.addSettingTab(new AbstractFolderSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(async () => {
			Logger.debug("[Abstract Folder] Workspace layout ready. Performing full re-index...");
			await this.graphEngine.forceReindex();
			
			this.metricsManager.applyDecay();
			
			if (this.settings.startupOpen) {
				this.activateView().catch(console.error);
			}

			// Ensure library sandbox directory exists
			const sandboxPath = this.settings.librarySettings.librariesPath;
			if (!(this.app.vault.getAbstractFileByPath(sandboxPath))) {
				try {
					await this.app.vault.createFolder(sandboxPath);
				} catch (e) {
					Logger.error("Failed to create library sandbox folder", e);
				}
			}
		});

		// ─── Engine 1: Start sync engines for registered personal backups ───
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.librarySettings.autoSyncEnabled) {
				const personalBackups = this.settings.librarySettings.personalBackups || [];
				for (const backupPath of personalBackups) {
					try {
						await this.libraryManager.startSyncEngine(backupPath);
					} catch (e) {
						Logger.error(`Failed to start sync engine for ${backupPath}`, e);
					}
				}
			}
		});

		// Auto-refresh identity if missing Git info
		const token = this.settings.librarySettings.githubToken;
		if (token && (!this.settings.librarySettings.gitName || !this.settings.librarySettings.gitEmail)) {
			void this.libraryManager.refreshIdentity().catch(e => Logger.error("Failed to auto-refresh identity", e));
		}
	}


	onunload() {
		Logger.debug("Starting onunload...");
		// Flush all pending auto-commits before process dies
		if (this.libraryManager) {
			void this.libraryManager.flushAll().catch(e => Logger.error('Failed to flush sync engines', e));
			this.libraryManager.cleanup();
		}
		Logger.debug("Saving metrics...");
		void this.metricsManager.saveMetrics();
		if (this.abstractRibbonIconEl) {
			this.abstractRibbonIconEl.remove();
			this.abstractRibbonIconEl = null;
		}
		if (this.libraryRibbonIconEl) {
			this.libraryRibbonIconEl.remove();
			this.libraryRibbonIconEl = null;
		}
		if (this.spacesRibbonIconEl) {
			this.spacesRibbonIconEl.remove();
			this.spacesRibbonIconEl = null;
		}
	}



	async activateLibraryExplorer() {
		Logger.debug("Activating Library Explorer...");
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_LIBRARY_EXPLORER);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			const side = this.settings.openSide;
			leaf = side === 'left' ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
			if (!leaf) {
				leaf = side === 'left' ? workspace.getLeftLeaf(true) : workspace.getRightLeaf(true);
			}
			
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_LIBRARY_EXPLORER,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

    async activateAbstractSpacesExplorer() {
        Logger.debug("Activating Abstract Spaces Explorer...");
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(ABSTRACT_SPACES_VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            const side = this.settings.openSide;
            leaf = side === 'left' ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
            if (!leaf) {
                leaf = side === 'left' ? workspace.getLeftLeaf(true) : workspace.getRightLeaf(true);
            }
            
            if (leaf) {
                await leaf.setViewState({
                    type: ABSTRACT_SPACES_VIEW_TYPE,
                    active: true,
                });
            }
        }

        if (leaf) {
            await workspace.revealLeaf(leaf);
        }
    }

	async activateLibraryCatalogView() {
		Logger.debug("Activating Library Catalog View...");
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_LIBRARY_CENTER);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_LIBRARY_CENTER,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
	}

	async activateView() {
		Logger.debug("Activating Abstract Folder View...");
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
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		// Ensure nested librarySettings have defaults
		if (this.settings.librarySettings) {
			this.settings.librarySettings = Object.assign({}, DEFAULT_SETTINGS.librarySettings, loadedData?.librarySettings);
		}

		// Migration: Move old global visibility settings to per-view settings
		if (loadedData && !loadedData.visibility) {
			const oldVisibility = {
				showFocusActiveFileButton: loadedData.showFocusActiveFileButton ?? DEFAULT_SETTINGS.showFocusActiveFileButton,
				showConversionButton: loadedData.showConversionButton ?? DEFAULT_SETTINGS.showConversionButton,
				showCollapseAllButton: loadedData.showCollapseAllButton ?? DEFAULT_SETTINGS.showCollapseAllButton,
				showExpandAllButton: loadedData.showExpandAllButton ?? DEFAULT_SETTINGS.showExpandAllButton,
				showSortButton: loadedData.showSortButton ?? DEFAULT_SETTINGS.showSortButton,
				showFilterButton: loadedData.showFilterButton ?? DEFAULT_SETTINGS.showFilterButton,
				showGroupButton: loadedData.showGroupButton ?? DEFAULT_SETTINGS.showGroupButton,
				showCreateNoteButton: loadedData.showCreateNoteButton ?? DEFAULT_SETTINGS.showCreateNoteButton,
				showSearchHeader: loadedData.showSearchHeader ?? DEFAULT_SETTINGS.showSearchHeader,
			};

			this.settings.visibility = {
				default: { ...oldVisibility },
				spaces: { ...DEFAULT_SETTINGS.visibility.spaces },
				libraries: { ...DEFAULT_SETTINGS.visibility.libraries },
			};
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateRibbonIconVisibility();
	}

	updateRibbonIconVisibility() {
		if (this.settings.showRibbonIcon) {
			if (!this.abstractRibbonIconEl) {
				this.abstractRibbonIconEl = this.addRibbonIcon("folder-tree", "Open abstract folders", () => {
					this.activateView().catch(console.error);
				});
			}
			if (!this.libraryRibbonIconEl) {
				this.libraryRibbonIconEl = this.addRibbonIcon("library", "Open library catalog", () => {
					this.activateLibraryExplorer().catch(console.error);
				});
			}
			if (!this.spacesRibbonIconEl) {
				this.spacesRibbonIconEl = this.addRibbonIcon("users", "Open abstract spaces explorer", () => {
					this.activateAbstractSpacesExplorer().catch(console.error);
				});
			}
		} else {
			if (this.abstractRibbonIconEl) {
				this.abstractRibbonIconEl.remove();
				this.abstractRibbonIconEl = null;
			}
			if (this.libraryRibbonIconEl) {
				this.libraryRibbonIconEl.remove();
				this.libraryRibbonIconEl = null;
			}
			if (this.spacesRibbonIconEl) {
				this.spacesRibbonIconEl.remove();
				this.spacesRibbonIconEl = null;
			}
		}
	}

}
