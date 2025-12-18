import { App, TFile, CachedMetadata, TAbstractFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FileGraph, ParentChildMap, HIDDEN_FOLDER_ID, Cycle, AbstractFolderFrontmatter } from "./types";
import AbstractFolderPlugin from '../main';
import { debounce, Debouncer } from 'obsidian';

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
            const start = Date.now();
            await this.buildGraph();
            this.app.workspace.trigger('abstract-folder:graph-updated');
            console.warn(`[Abstract Folder Benchmark] Full Graph Rebuild took ${Date.now() - start}ms`);
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
        
        // Take the first parent found
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
    return pathSegments;
  }

  private registerEvents() {
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile, _data: string, cache: CachedMetadata) => {
        this.debouncedRebuildGraphAndTriggerUpdate();
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
          this.debouncedRebuildGraphAndTriggerUpdate();
        }
      })
    );
  }

  private async buildGraph() {
    const start = Date.now();
    this.parentToChildren = {};
    this.childToParents = new Map();
    this.allFiles = new Set();

    const allFiles = this.app.vault.getFiles();
    console.warn(`[Abstract Folder Benchmark] Processing ${allFiles.length} files`);
    
    const CHUNK_SIZE = 500;
    for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
        const chunk = allFiles.slice(i, i + CHUNK_SIZE);
        for (const file of chunk) {
            // Check if file is in an excluded path
            if (this.isExcluded(file.path)) {
                continue;
            }
            this.processFile(file);
        }
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 0));
    }

  this.graph = {
    parentToChildren: this.parentToChildren,
    childToParents: this.childToParents,
    allFiles: this.allFiles,
  };
  this.cycles = []; // Clear previous cycles
  this.detectCycles(); // Call after graph is built
  console.warn(`[Abstract Folder Benchmark] buildGraph took ${Date.now() - start}ms`);
  }

  private detectCycles() {
  const start = Date.now();
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
  console.debug(`[Abstract Folder Benchmark] detectCycles took ${Date.now() - start}ms`);
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

  private processFile(file: TAbstractFile) {
    if (!(file instanceof TFile)) {
      // If it's not a TFile (e.g., a folder), we don't process its frontmatter for relationships.
      // However, we still need to add it to allFiles if it's referenced as a parent or child.
      // For now, we only care about TFile for frontmatter.
      this.allFiles.add(file.path); // Ensure folder paths are tracked if they become parents
      return;
    }

    this.allFiles.add(file.path);
    const metadata = this.app.metadataCache.getFileCache(file);


    if (metadata?.frontmatter) {
      let isHidden = false;
      const potentialChildDefinedParents: Set<string> = new Set();
      const potentialParentDefinedChildren: Set<string> = new Set();

      // --- Process child-defined parents (using this file's 'parent' frontmatter) ---
      // First pass: Check for 'hidden' status across all possible parent properties
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
        // If explicitly hidden, link only to HIDDEN_FOLDER_ID
        this.addRelationship(HIDDEN_FOLDER_ID, file.path);
        this.allFiles.add(HIDDEN_FOLDER_ID);
      } else {
        // If not hidden, process all valid parent links from ALL configured properties
        for (const propName of this.PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS) {
          const parentProperty = metadata.frontmatter[propName] as unknown;
          if (parentProperty) {
            const parentLinks = Array.isArray(parentProperty) ? parentProperty as unknown[] : [parentProperty];
            for (const parentLink of parentLinks) {
              if (typeof parentLink === 'string' && parentLink.toLowerCase().trim() !== 'hidden') {
                const resolvedParentPath = this.resolveLinkToPath(parentLink, file.path);
                if (resolvedParentPath) {
                  potentialChildDefinedParents.add(resolvedParentPath);
                }
              }
            }
          }
        }

        for (const resolvedParentPath of potentialChildDefinedParents) {
          this.addRelationship(resolvedParentPath, file.path);
          this.allFiles.add(resolvedParentPath);
        }
      }

      // --- Process parent-defined children (using this file's 'children' frontmatter) ---
      for (const propName of this.CHILD_PROPERTIES_TO_CHECK_FOR_PARENT_DEFINED_CHILDREN) {
        const childrenProperty = metadata.frontmatter[propName] as unknown;
        if (childrenProperty) {
          const childLinks = Array.isArray(childrenProperty) ? childrenProperty as unknown[] : [childrenProperty];
          for (const childLink of childLinks) {
            if (typeof childLink === 'string') {
              const resolvedChildPath = this.resolveLinkToPath(childLink, file.path);
              if (resolvedChildPath && resolvedChildPath.toLowerCase().trim() !== 'hidden') {
                potentialParentDefinedChildren.add(resolvedChildPath);
              }
            }
          }
        }
      }

      for (const resolvedChildPath of potentialParentDefinedChildren) {
        // If a file lists itself as a child, ignore it to prevent circular references and self-linking
        if (resolvedChildPath !== file.path) {
          this.addRelationship(file.path, resolvedChildPath);
          this.allFiles.add(resolvedChildPath); // Ensure the child (even non-MD) is tracked
        }
      }
    }
    this.allFiles.add(file.path); // Ensure the file itself is always tracked
  }

  // Helper to add a relationship, consolidating logic
  private addRelationship(parentPath: string, childPath: string) {
    if (!this.parentToChildren[parentPath]) {
      this.parentToChildren[parentPath] = new Set();
    }
    this.parentToChildren[parentPath].add(childPath);

    if (!this.childToParents.has(childPath)) {
      this.childToParents.set(childPath, new Set());
    }
    this.childToParents.get(childPath)?.add(parentPath);
    this.allFiles.add(parentPath); // Ensure both parent and child are in allFiles
    this.allFiles.add(childPath);
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

  private updateFileInGraph(file: TFile, cache: CachedMetadata) {
    this.debouncedRebuildGraphAndTriggerUpdate();
  }


  private async deleteFileFromGraph(file: TAbstractFile) {
    await this.removeFileFromParentFrontmatters(file.path);
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
    const oldFileStub = { path: oldPath } as TAbstractFile;
    await this.deleteFileFromGraph(oldFileStub);
    this.processFile(file);
    this.debouncedRebuildGraphAndTriggerUpdate();
  }
}