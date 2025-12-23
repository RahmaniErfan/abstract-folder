import { App, TFile, CachedMetadata, TAbstractFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FileGraph, ParentChildMap, HIDDEN_FOLDER_ID, Cycle, AbstractFolderFrontmatter } from "./types";
import AbstractFolderPlugin from '../main';
import { debounce, Debouncer } from 'obsidian';
import { updateAbstractLinksOnRename, updateGroupsOnRename } from "./utils/file-operations";

interface FileDefinedRelationships {
    definedParents: Set<string>;
    definedChildren: Set<string>;
}

export class FolderIndexer {
  private app: App;
  private settings: AbstractFolderPluginSettings;
  private plugin: AbstractFolderPlugin;
  private PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS: string[] = [];
  private CHILD_PROPERTIES_TO_CHECK_FOR_PARENT_DEFINED_CHILDREN: string[] = [];

  private graph: FileGraph;
  private parentToChildren: ParentChildMap;
  private childToParents: Map<string, Set<string>>;
  private allFiles: Set<string>;
  
  // Store which relationships are defined by which file to allow incremental updates
  private fileRelationships: Map<string, FileDefinedRelationships> = new Map();

  private cycles: Cycle[] = []; // Store detected cycles
  private lastCycleSignature: string = '';
  private debouncedRebuildGraphAndTriggerUpdate: Debouncer<[], void>;
  private isBuilding = false;
  private pendingRebuild = false;

  constructor(app: App, settings: AbstractFolderPluginSettings, plugin: AbstractFolderPlugin) {
    this.app = app;
    this.settings = settings;
    this.plugin = plugin;
    this.parentToChildren = {};
    this.childToParents = new Map();
    this.allFiles = new Set();
    this.graph = {
      parentToChildren: this.parentToChildren,
      childToParents: this.childToParents,
      allFiles: this.allFiles,
      roots: new Set(),
    };
    this.debouncedRebuildGraphAndTriggerUpdate = debounce(() => this.rebuildGraphAndTriggerUpdateImpl(), 1000, true);
  }

  updateSettings(newSettings: AbstractFolderPluginSettings) {
    this.settings = newSettings;
    this.initializePropertyNames();
    this.debouncedRebuildGraphAndTriggerUpdate();
  }

  initializeIndexer() {
    this.initializePropertyNames();
    this.registerEvents();
    this.debouncedRebuildGraphAndTriggerUpdate(); // Initial graph build
  }

  rebuildGraphAndTriggerUpdate() {
    this.debouncedRebuildGraphAndTriggerUpdate();
  }

  private async rebuildGraphAndTriggerUpdateImpl() {
    if (this.isBuilding) {
        this.pendingRebuild = true;
        return;
    }
    this.isBuilding = true;

    try {
        do {
            this.pendingRebuild = false;
            this.app.workspace.trigger('abstract-folder:graph-build-start');
            await this.buildGraph();
            this.app.workspace.trigger('abstract-folder:graph-updated');
        } while (this.pendingRebuild);
    } finally {
        this.isBuilding = false;
    }
  }

  onunload() {
    // Obsidian's registerEvent automatically handles unregistering during unload
    if (this.debouncedRebuildGraphAndTriggerUpdate && typeof this.debouncedRebuildGraphAndTriggerUpdate.cancel === 'function') {
      this.debouncedRebuildGraphAndTriggerUpdate.cancel();
    }
  }

  getGraph(): FileGraph {
    return this.graph;
  }

  getCycles(): Cycle[] {
    return this.cycles;
  }

  getRelevantParentPropertyNames(): string[] {
    // Return a combined list of properties that can define a parent relationship, for settings display or other uses.
    // This currently combines child-defined parent properties.
    return [...this.PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS];
  }

  getPathToRoot(filePath: string): string[] {
    const graph = this.getGraph();
    let currentPath = filePath;
    const pathSegments: string[] = [];
    const visited = new Set<string>();

    while (currentPath) {
        pathSegments.unshift(currentPath);
        visited.add(currentPath);
        
        const parents = graph.childToParents.get(currentPath);
        if (!parents || parents.size === 0) {
            break;
        }
        
        const nextParent = parents.values().next().value as string;
        
        if (nextParent === HIDDEN_FOLDER_ID) {
             if (pathSegments[0] !== HIDDEN_FOLDER_ID) {
                pathSegments.unshift(HIDDEN_FOLDER_ID);
             }
             break;
        }

        if (visited.has(nextParent)) {
            break;
        }
        
        currentPath = nextParent;
    }
    // console.debug(`Indexer - getPathToRoot result for ${filePath}:`, pathSegments);
    return pathSegments;
  }

  private registerEvents() {
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile, _data: string, cache: CachedMetadata) => {
        // Optimized: Incremental update
        this.updateFileIncremental(file, cache);
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.deleteFileFromGraph(file).catch((error) => console.error(error));
        }
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.renameFileInGraph(file, oldPath).catch((error) => console.error(error));
        }
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          // New file needs to be added to graph
          this.updateFileIncremental(file, this.app.metadataCache.getFileCache(file) || {});
        }
      })
    );
  }

  private async buildGraph() {
    this.parentToChildren = {};
    this.childToParents = new Map();
    this.allFiles = new Set();
    this.fileRelationships = new Map();
    this.graph.roots = new Set(); // Clear roots

    const allFiles = this.app.vault.getFiles();
    
    const CHUNK_SIZE = 500;
    for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
        const chunk = allFiles.slice(i, i + CHUNK_SIZE);
        for (const file of chunk) {
            // Check if file is in an excluded path
            if (this.isExcluded(file.path)) {
                continue;
            }
            // Process file and store its definitions
            const relationships = this.getFileRelationships(file);
            this.fileRelationships.set(file.path, relationships);
            
            // Apply to graph
            this.applyRelationshipsToGraph(file.path, relationships);
            
            this.allFiles.add(file.path);
        }
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    this.recalculateAllRoots();

    this.graph = {
      parentToChildren: this.parentToChildren,
      childToParents: this.childToParents,
      allFiles: this.allFiles,
      roots: this.graph.roots,
    };
    
    this.cycles = []; // Clear previous cycles
    this.detectCycles(); // Call after graph is built
  }

  private recalculateAllRoots() {
      this.graph.roots = new Set();
      for (const file of this.allFiles) {
        if (!this.childToParents.has(file) || this.childToParents.get(file)!.size === 0) {
          this.graph.roots.add(file);
        }
      }
  }

  private updateRootStatus(path: string) {
      if (!this.childToParents.has(path) || this.childToParents.get(path)!.size === 0) {
          this.graph.roots.add(path);
      } else {
          this.graph.roots.delete(path);
      }
  }

  private detectCycles() {
  const cycles: Cycle[] = [];
  const visited: Set<string> = new Set();
  const recursionStack: Set<string> = new Set();

  const dfs = (node: string, path: string[]) => {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const children = this.parentToChildren[node];
    if (children) {
      for (const child of children) {
        if (!visited.has(child)) {
          dfs(child, path);
        } else if (recursionStack.has(child)) {
          // Cycle detected
          const cycleStartIndex = path.indexOf(child);
          cycles.push(path.slice(cycleStartIndex));
        }
      }
    }
    recursionStack.delete(node);
    path.pop();
  };

  for (const file of this.allFiles) {
    if (!visited.has(file)) {
      dfs(file, []);
    }
  }

  if (cycles.length > 0) {
    this.cycles = cycles; // Store cycles
    const currentSignature = JSON.stringify(cycles);
    if (currentSignature !== this.lastCycleSignature) {
      this.lastCycleSignature = currentSignature;
      this.displayCycleWarning(cycles);
    }
  } else {
    this.lastCycleSignature = ''; // Reset if no cycles
  }
  }

  private displayCycleWarning(cycles: Cycle[]) {
    if (cycles.length > 0) {
      const message = `Abstract Folder Plugin: ${cycles.length} circular relationship(s) detected. See console for details.`;
      new Notice(message, 5000); // Display a concise notice for 5 seconds
      console.warn("Abstract Folder Plugin: Circular relationships detected!", cycles);
    }
  }

  private initializePropertyNames() {
    this.CHILD_PROPERTIES_TO_CHECK_FOR_PARENT_DEFINED_CHILDREN = [this.settings.childrenPropertyName];
    this.PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS = [this.settings.propertyName];
  }

  private isExcluded(path: string): boolean {
      if (!this.settings.excludedPaths) return false;
      for (const excluded of this.settings.excludedPaths) {
          // Check if path starts with excluded folder path
          // Normalize both to handle potential trailing slashes
          const cleanPath = path.replace(/^\//, '');
          const cleanExcluded = excluded.replace(/^\//, '');
          
          if (cleanPath.startsWith(cleanExcluded)) {
              return true;
          }
      }
      return false;
  }

  private getFileRelationships(file: TFile): FileDefinedRelationships {
    const relationships: FileDefinedRelationships = {
        definedParents: new Set(),
        definedChildren: new Set()
    };

    const metadata = this.app.metadataCache.getFileCache(file);
    if (!metadata?.frontmatter) return relationships;

    let isHidden = false;

    // --- Process child-defined parents ---
    for (const propName of this.PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS) {
        const parentProperty = metadata.frontmatter[propName] as unknown;
        if (parentProperty) {
            const parentLinks = Array.isArray(parentProperty) ? parentProperty as unknown[] : [parentProperty];
            for (const parentLink of parentLinks) {
                if (typeof parentLink === 'string' && parentLink.toLowerCase().trim() === 'hidden') {
                    isHidden = true;
                    break;
                }
            }
        }
        if (isHidden) break;
    }

    if (isHidden) {
        relationships.definedParents.add(HIDDEN_FOLDER_ID);
    } else {
        const potentialParents = new Set<string>();
        for (const propName of this.PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS) {
            const parentProperty = metadata.frontmatter[propName] as unknown;
            if (parentProperty) {
                const parentLinks = Array.isArray(parentProperty) ? parentProperty as unknown[] : [parentProperty];
                for (const parentLink of parentLinks) {
                    if (typeof parentLink === 'string' && parentLink.toLowerCase().trim() !== 'hidden') {
                        const resolvedParentPath = this.resolveLinkToPath(parentLink, file.path);
                        if (resolvedParentPath) {
                            if (resolvedParentPath !== file.path) {
                                potentialParents.add(resolvedParentPath);
                            } else {
                                console.warn(`Indexer - ${file.path} attempted to define itself as its own parent. Skipping.`);
                            }
                        }
                    }
                }
            }
        }
        relationships.definedParents = potentialParents;
    }

    const potentialChildren = new Set<string>();
    for (const propName of this.CHILD_PROPERTIES_TO_CHECK_FOR_PARENT_DEFINED_CHILDREN) {
        const childrenProperty = metadata.frontmatter[propName] as unknown;
        if (childrenProperty) {
            const childLinks = Array.isArray(childrenProperty) ? childrenProperty as unknown[] : [childrenProperty];
            for (const childLink of childLinks) {
                if (typeof childLink === 'string') {
                    const resolvedChildPath = this.resolveLinkToPath(childLink, file.path);
                    if (resolvedChildPath && resolvedChildPath.toLowerCase().trim() !== 'hidden') {
                         if (resolvedChildPath !== file.path) {
                             potentialChildren.add(resolvedChildPath);
                         }
                    }
                }
            }
        }
    }
    relationships.definedChildren = potentialChildren;

    return relationships;
  }

  private applyRelationshipsToGraph(filePath: string, relationships: FileDefinedRelationships) {
      // Apply parents (filePath is child)
      for (const parent of relationships.definedParents) {
          this.addRelationshipToGraphStructure(parent, filePath);
      }
      
      // Apply children (filePath is parent)
      for (const child of relationships.definedChildren) {
          this.addRelationshipToGraphStructure(filePath, child);
      }
  }
  
  private addRelationshipToGraphStructure(parentPath: string, childPath: string) {
      if (!this.parentToChildren[parentPath]) {
          this.parentToChildren[parentPath] = new Set();
      }
      this.parentToChildren[parentPath].add(childPath);

      if (!this.childToParents.has(childPath)) {
          this.childToParents.set(childPath, new Set());
      }
      this.childToParents.get(childPath)?.add(parentPath);
      
      this.allFiles.add(parentPath);
      this.allFiles.add(childPath);
  }

  private removeRelationshipFromGraphStructure(parentPath: string, childPath: string) {
      // Only remove if NEITHER file defines it anymore
      const parentDefs = this.fileRelationships.get(parentPath);
      const childDefs = this.fileRelationships.get(childPath);
      
      const definedByParent = parentDefs?.definedChildren.has(childPath);
      const definedByChild = childDefs?.definedParents.has(parentPath);
      
      if (!definedByParent && !definedByChild) {
          // It's safe to remove
          if (this.parentToChildren[parentPath]) {
              this.parentToChildren[parentPath].delete(childPath);
              if (this.parentToChildren[parentPath].size === 0) {
                  delete this.parentToChildren[parentPath];
              }
          }
          
          if (this.childToParents.has(childPath)) {
              this.childToParents.get(childPath)?.delete(parentPath);
              // Do NOT delete the Set from childToParents if empty, 
              // as we rely on .has() or size check for roots. 
              // Or if we delete it, we must ensure roots logic checks for undefined.
              if (this.childToParents.get(childPath)!.size === 0) {
                  this.childToParents.delete(childPath);
              }
          }
      }
  }

  private updateFileIncremental(file: TFile, cache: CachedMetadata) {
      if (this.isExcluded(file.path)) return;
      
      const oldRelationships = this.fileRelationships.get(file.path) || { definedParents: new Set(), definedChildren: new Set() };
      const newRelationships = this.getFileRelationships(file);
      
      // 1. Update Map (Crucial: Update map BEFORE removing old relationships so checks against "current state" in removeRelationshipFromGraphStructure use the new state)
      this.fileRelationships.set(file.path, newRelationships);

      // 2. Remove Old
      for (const p of oldRelationships.definedParents) {
          this.removeRelationshipFromGraphStructure(p, file.path);
          this.updateRootStatus(file.path);
          this.updateRootStatus(p);
      }
      for (const c of oldRelationships.definedChildren) {
          this.removeRelationshipFromGraphStructure(file.path, c);
          this.updateRootStatus(c);
          this.updateRootStatus(file.path);
      }
      
      // 3. Add New
      for (const p of newRelationships.definedParents) {
          this.addRelationshipToGraphStructure(p, file.path);
          this.updateRootStatus(file.path);
          this.updateRootStatus(p);
      }
      for (const c of newRelationships.definedChildren) {
          this.addRelationshipToGraphStructure(file.path, c);
          this.updateRootStatus(c);
          this.updateRootStatus(file.path);
      }

      this.allFiles.add(file.path);
      this.updateRootStatus(file.path);

      this.app.workspace.trigger('abstract-folder:graph-updated');
  }

  private resolveLinkToPath(link: string, containingFilePath: string): string | null {
    // 1. Remove outer quotes (YAML string behavior)
    let cleaned = link.replace(/^["']+|["']+$|^\s+|[\s]+$/g, '');

    // 2. Remove wiki-link brackets
    cleaned = cleaned.replace(/\[\[|\]\]/g, '');

    // 3. Handle Pipe aliases [[Link|Alias]] -> Link
    cleaned = cleaned.split('|')[0];

    // 4. Trim again
    const cleanedTrimmed = cleaned.trim();

    // 5. Remove internal quotes that might have been inside the brackets (e.g. [["Work"]])
    const finalCleaned = cleanedTrimmed.replace(/^["']+|["']+$/g, '');
    const finalCleanedUntrimmed = cleaned.replace(/^["']+|["']+$/g, ''); // Keep original cleaned for untrimmed check

    if (!finalCleaned && !finalCleanedUntrimmed) return null;

    let resolvedFile: TFile | null = null;

    // First, try resolving with the trimmed and fully cleaned version (standard behavior)
    if (finalCleaned) {
        resolvedFile = this.app.metadataCache.getFirstLinkpathDest(finalCleaned, containingFilePath);
    }
    
    // If that fails, and there's a difference, try resolving with the untrimmed version
    if (!resolvedFile && finalCleanedUntrimmed && finalCleaned !== finalCleanedUntrimmed) {
        resolvedFile = this.app.metadataCache.getFirstLinkpathDest(finalCleanedUntrimmed, containingFilePath);
    }

    // If Obsidian couldn't resolve it via metadataCache,
    // we should check if the path directly corresponds to an existing file of any type.
    if (!resolvedFile) {
        // Try with trimmed version first for direct path check
        let abstractFile = this.app.vault.getAbstractFileByPath(finalCleaned);
        if (abstractFile instanceof TFile) {
            return abstractFile.path;
        }

        // If trimmed version doesn't work, try with untrimmed version for direct path check
        if (finalCleaned !== finalCleanedUntrimmed) {
            abstractFile = this.app.vault.getAbstractFileByPath(finalCleanedUntrimmed);
            if (abstractFile instanceof TFile) {
                return abstractFile.path;
            }
        }
    }
    
    return resolvedFile ? resolvedFile.path : null;
  }

  private async deleteFileFromGraph(file: TAbstractFile) {
    // removeFileFromParentFrontmatters triggers metadataCache.on('changed')
    // for all affected files, which updates the graph incrementally.
    await this.removeFileFromParentFrontmatters(file.path);
    
    this.fileRelationships.delete(file.path);
    this.allFiles.delete(file.path);
    this.debouncedRebuildGraphAndTriggerUpdate();
  }

  private async removeFileFromParentFrontmatters(deletedFilePath: string) {
    const allFiles = this.app.vault.getFiles();
    const childrenPropertyName = this.settings.childrenPropertyName;

    const lastSlashIndex = deletedFilePath.lastIndexOf('/');
    const fileNameWithExtension = lastSlashIndex === -1 ? deletedFilePath : deletedFilePath.substring(lastSlashIndex + 1);
    const fileNameWithoutExtension = fileNameWithExtension.split('.').slice(0, -1).join('.');

    for (const file of allFiles) {
      if (file.path === deletedFilePath) continue;

      await this.app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
        const rawChildren = frontmatter[childrenPropertyName];

        if (!rawChildren) return;

        let childrenArray: string[] = [];
        if (typeof rawChildren === 'string') {
          childrenArray = [rawChildren];
        } else if (Array.isArray(rawChildren)) {
          childrenArray = rawChildren as string[];
        } else {
          return;
        }

        const initialLength = childrenArray.length;
        const updatedChildren = childrenArray.filter(childLink => {
          let cleanedLink = childLink.replace(/^["']+|["']+$|^\s+|[\s]+$/g, '');
          cleanedLink = cleanedLink.replace(/\[\[|\]\]/g, '');
          cleanedLink = cleanedLink.split('|')[0];
          cleanedLink = cleanedLink.trim();

          const refersToDeletedFile =
            cleanedLink === fileNameWithoutExtension ||
            cleanedLink === fileNameWithExtension ||
            cleanedLink === deletedFilePath;

          return !refersToDeletedFile;
        });

        if (updatedChildren.length !== initialLength) {
          if (updatedChildren.length === 0) {
            delete frontmatter[childrenPropertyName];
          } else if (updatedChildren.length === 1) {
            frontmatter[childrenPropertyName] = updatedChildren[0];
          } else {
            frontmatter[childrenPropertyName] = updatedChildren;
          }
        }
      });
    }
  }

  private async renameFileInGraph(file: TFile, oldPath: string) {
    // Update relationships in other files' frontmatter
    await updateAbstractLinksOnRename(this.app, this.settings, this, file, oldPath);

    // Update group filters if they point to this file
    await updateGroupsOnRename(this.app, this.plugin, oldPath, file.path);

    // Clean up old path in our maps
    this.fileRelationships.delete(oldPath);
    this.allFiles.delete(oldPath);
    
    // Re-process file with new path
    this.updateFileIncremental(file, this.app.metadataCache.getFileCache(file) || {});
    
    // Wait for the next tick to satisfy "has no await expression" if the await calls above are somehow not counted by the specific linter version
    await Promise.resolve();
  }
}
