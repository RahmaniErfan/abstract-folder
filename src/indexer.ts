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

    // The individual removeFileChildRelationships and removeFileParentRelationships calls
    // are no longer needed here as a full graph rebuild is now triggered
    // on updateFileInGraph and deleteFileFromGraph for consistency.
    // The buildGraph() method itself clears and re-establishes all relationships for all files.

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
    cleaned = cleaned.trim();

    // 5. Remove internal quotes that might have been inside the brackets (e.g. [["Work"]])
    cleaned = cleaned.replace(/^["']+|["']+$/g, '');

    if (!cleaned) return null;

    // Resolve the link relative to the containing file
    const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(cleaned, containingFilePath);
    
    // If Obsidian couldn't resolve it (e.g., if it's not a markdown file that Obsidian indexes for links),
    // we should check if the path directly corresponds to an existing file of any type.
    if (!resolvedFile) {
        const abstractFile = this.app.vault.getAbstractFileByPath(cleaned);
        if (abstractFile instanceof TFile) { // Ensure it's an actual file, not a folder
            return abstractFile.path;
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


  /**
   * Completely removes a file from the graph, including its identity as a parent.
   * This is used when a file is deleted.
   */
  private deleteFileFromGraph(file: TAbstractFile) {
    // When a file is deleted, all its associated relationships (both as child and parent)
    // need to be cleared. A full graph rebuild ensures that any remaining references
    // from other files that defined the deleted file as a child/parent are also cleaned up.
    this.buildGraph();
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }
  private renameFileInGraph(file: TFile, oldPath: string) {
    // Create a temporary TAbstractFile for the old path for deletion
    const oldFileStub = { path: oldPath } as TAbstractFile;
    this.deleteFileFromGraph(oldFileStub);

    // Re-process the file with its new path to establish all its relationships
    this.processFile(file);

    // After renaming, a full graph rebuild is the most robust way to ensure
    // all existing references (especially from children whose `parent` property
    // or parent's `children` property might point to the old file name/path) are correctly re-resolved.
    // This is because other files might link to the `oldPath`, and we need to re-evaluate them.
    this.buildGraph();
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }
}