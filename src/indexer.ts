import { App, TFile, CachedMetadata, TAbstractFile } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FileGraph, ParentChildMap, HIDDEN_FOLDER_ID } from "./types";
import AbstractFolderPlugin from '../main'; // Import the main plugin class

export class FolderIndexer {
  private app: App;
  private settings: AbstractFolderPluginSettings;
  private plugin: AbstractFolderPlugin; // Add this line
  private PARENT_PROPERTIES_TO_CHECK_FOR_CHILD_DEFINED_PARENTS: string[] = []; // Dynamically generated property names for child-defined parents
  private CHILD_PROPERTIES_TO_CHECK_FOR_PARENT_DEFINED_CHILDREN: string[] = []; // Dynamically generated property names for parent-defined children

  private graph: FileGraph;
  private parentToChildren: ParentChildMap;
  private childToParents: Map<string, Set<string>>;
  private allFiles: Set<string>; // All files encountered (parents or children, including non-MD)

  constructor(app: App, settings: AbstractFolderPluginSettings, plugin: AbstractFolderPlugin) {
    this.app = app;
    this.settings = settings;
    this.plugin = plugin; // Assign the plugin instance
    this.parentToChildren = {};
    this.childToParents = new Map();
    this.allFiles = new Set();
    this.graph = {
      parentToChildren: this.parentToChildren,
      childToParents: this.childToParents,
      allFiles: this.allFiles,
    };
  }

  updateSettings(newSettings: AbstractFolderPluginSettings) {
    this.settings = newSettings;
    this.initializePropertyNames(); // Re-initialize property names on settings change
    this.buildGraph(); // Rebuild graph with new setting
    this.app.workspace.trigger('abstract-folder:graph-updated');
  }

  async initializeIndexer() {
    this.initializePropertyNames(); // Initialize property names on load
    this.registerEvents();
  }

  rebuildGraphAndTriggerUpdate() {
    this.buildGraph();
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }

  onunload() {
    // Obsidian's registerEvent automatically handles unregistering during unload
  }

getGraph(): FileGraph {
    return this.graph;
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
        const nextParent = parents.values().next().value;
        
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
        this.updateFileInGraph(file, cache);
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.deleteFileFromGraph(file);
        }
      })
    );

    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.renameFileInGraph(file, oldPath);
        }
      })
    );

    // Register event for file creation
    this.plugin.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          // A new file has been created, rebuild the graph to include it
          this.rebuildGraphAndTriggerUpdate();
        }
      })
    );
  }

  private buildGraph() {
    // Clear existing graph data before rebuilding
    this.parentToChildren = {};
    this.childToParents = new Map();
    this.allFiles = new Set(); // Reset allFiles to include only currently existing and linked files

    const allFiles = this.app.vault.getFiles(); // Get ALL files, not just markdown
    for (const file of allFiles) {
      // Check if file is in an excluded path
      if (this.isExcluded(file.path)) {
          continue;
      }
      this.processFile(file);
    }

    this.graph = {
      parentToChildren: this.parentToChildren,
      childToParents: this.childToParents,
      allFiles: this.allFiles,
    };
  }

  private initializePropertyNames() {
    // Parent-defined children: property name defined in settings
    this.CHILD_PROPERTIES_TO_CHECK_FOR_PARENT_DEFINED_CHILDREN = [this.settings.childrenPropertyName];
    // Child-defined parents: property name defined in settings
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
        const parentProperty = metadata.frontmatter[propName];
        if (parentProperty) {
          const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
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
          const parentProperty = metadata.frontmatter[propName];
          if (parentProperty) {
            const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
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
        const childrenProperty = metadata.frontmatter[propName];
        if (childrenProperty) {
          const childLinks = Array.isArray(childrenProperty) ? childrenProperty : [childrenProperty];
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
    // A full rebuild is the most robust way to ensure consistency when
    // relationships can be defined from multiple sources (child's parent property, parent's children property).
    // This addresses potential issues where a change in one file's frontmatter
    // might affect relationships that were previously established by another file.
    this.buildGraph();
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }


private async deleteFileFromGraph(file: TAbstractFile) {
  // Before rebuilding the graph, clean up parent references in their frontmatter
  await this.removeFileFromParentFrontmatters(file.path);
  // When a file is deleted, all its associated relationships (both as child and parent)
  // need to be cleared. A full graph rebuild ensures that any remaining references
  // from other files that defined the deleted file as a child/parent are also cleaned up.
  this.buildGraph();
  this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
}

private async removeFileFromParentFrontmatters(deletedFilePath: string) {
  const allFiles = this.app.vault.getFiles();
  const childrenPropertyName = this.settings.childrenPropertyName;

  const lastSlashIndex = deletedFilePath.lastIndexOf('/');
  const fileNameWithExtension = lastSlashIndex === -1 ? deletedFilePath : deletedFilePath.substring(lastSlashIndex + 1);
  const fileNameWithoutExtension = fileNameWithExtension.split('.').slice(0, -1).join('.');

  for (const file of allFiles) {
    if (file.path === deletedFilePath) continue; // Don't process the deleted file itself

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const currentChildren = frontmatter[childrenPropertyName];

      if (!currentChildren) return;

      let childrenArray: string[] = [];
      if (typeof currentChildren === 'string') {
        childrenArray = [currentChildren];
      } else if (Array.isArray(currentChildren)) {
        childrenArray = currentChildren;
      } else {
        return; // Not a recognized format
      }

      const initialLength = childrenArray.length;
      const updatedChildren = childrenArray.filter(childLink => {
        let cleanedLink = childLink.replace(/^["']+|["']+$|^\s+|[\s]+$/g, ''); // Remove quotes/trim
        cleanedLink = cleanedLink.replace(/\[\[|\]\]/g, ''); // Remove wiki-link brackets
        cleanedLink = cleanedLink.split('|')[0]; // Handle pipe aliases
        cleanedLink = cleanedLink.trim();

        // Check if the cleaned link refers to the deleted file
        const refersToDeletedFile =
          cleanedLink === fileNameWithoutExtension || // e.g., [[My Note]]
          cleanedLink === fileNameWithExtension ||     // e.g., [[My Note.md]]
          cleanedLink === deletedFilePath;             // e.g., [[folder/subfolder/My Note.md]]

        return !refersToDeletedFile; // Keep if it does NOT refer to the deleted file
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

private renameFileInGraph(file: TFile, oldPath: string) {
  const oldFileStub = { path: oldPath } as TAbstractFile;
  this.deleteFileFromGraph(oldFileStub); // This will handle removing old references and rebuilding
  this.processFile(file); // Re-process the renamed file with its new path
  this.buildGraph();
  this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
}
}