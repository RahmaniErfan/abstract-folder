import { App, TFile, CachedMetadata } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FileGraph, ParentChildMap, HIDDEN_FOLDER_ID } from "./types";

export class FolderIndexer {
  private app: App;
  private settings: AbstractFolderPluginSettings;
  private PARENT_PROPERTY_NAMES_TO_CHECK: string[] = []; // Dynamically generated property names
  private graph: FileGraph;
  private parentToChildren: ParentChildMap;
  private childToParents: Map<string, Set<string>>;
  private allFiles: Set<string>;

  constructor(app: App, settings: AbstractFolderPluginSettings) {
    this.app = app;
    this.settings = settings;
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
    this.initializeParentPropertyNames(); // Re-initialize parent property names on settings change
    this.buildGraph(); // Rebuild graph with new setting
    this.app.workspace.trigger('abstract-folder:graph-updated');
  }

  async onload() {
    this.initializeParentPropertyNames(); // Initialize parent property names on load
    this.buildGraph();
    this.registerEvents();
  }

  onunload() {
    // Obsidian's registerEvent automatically handles unregistering during unload
  }

getGraph(): FileGraph {
    return this.graph;
  }

  getRelevantParentPropertyNames(): string[] {
    return [...this.PARENT_PROPERTY_NAMES_TO_CHECK]; // Return a copy to prevent external modification
  }

  private registerEvents() {
    this.app.metadataCache.on("changed", (file: TFile, _data: string, cache: CachedMetadata) => {
      this.updateFileInGraph(file, cache);
    });

    this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        this.deleteFileFromGraph(file);
      }
    });

    this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) {
        this.renameFileInGraph(file, oldPath);
      }
    });
  }

  private buildGraph() {
    this.parentToChildren = {};
    this.childToParents = new Map();
    this.allFiles = new Set();

    const markdownFiles = this.app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      this.processFile(file);
    }

    this.graph = {
      parentToChildren: this.parentToChildren,
      childToParents: this.childToParents,
      allFiles: this.allFiles,
    };
  }

  private initializeParentPropertyNames() {
    // Only use the property name defined in settings to enforce case sensitivity
    this.PARENT_PROPERTY_NAMES_TO_CHECK = [this.settings.propertyName];
  }

  private processFile(file: TFile) {
    this.allFiles.add(file.path);
    const metadata = this.app.metadataCache.getFileCache(file);

    // Always remove existing relationships first to ensure clean state for re-processing
    this.removeFileChildRelationships(file);

    if (metadata?.frontmatter) {
      let isHidden = false;
      const potentialParents: Set<string> = new Set();

      // First pass: Check for 'hidden' status across all possible parent properties
      for (const propName of this.PARENT_PROPERTY_NAMES_TO_CHECK) {
        const parentProperty = metadata.frontmatter[propName];
        if (parentProperty) {
          const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
          for (const parentLink of parentLinks) {
            if (typeof parentLink === 'string' && parentLink.toLowerCase().trim() === 'hidden') {
              isHidden = true;
              break; // 'hidden' found, no need to check further properties for this file
            }
          }
        }
        if (isHidden) break;
      }

      if (isHidden) {
        // If explicitly hidden, link only to HIDDEN_FOLDER_ID
        if (!this.parentToChildren[HIDDEN_FOLDER_ID]) {
          this.parentToChildren[HIDDEN_FOLDER_ID] = new Set();
        }
        this.parentToChildren[HIDDEN_FOLDER_ID].add(file.path);
        
        if (!this.childToParents.has(file.path)) {
          this.childToParents.set(file.path, new Set());
        }
        this.childToParents.get(file.path)?.add(HIDDEN_FOLDER_ID);
        this.allFiles.add(HIDDEN_FOLDER_ID); // Ensure HIDDEN_FOLDER_ID is part of allFiles for view rendering
      } else {
        // If not hidden, process all valid parent links from ALL configured properties
        for (const propName of this.PARENT_PROPERTY_NAMES_TO_CHECK) {
          const parentProperty = metadata.frontmatter[propName];
          if (parentProperty) {
            const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
            for (const parentLink of parentLinks) {
              if (typeof parentLink === 'string' && parentLink.toLowerCase().trim() !== 'hidden') { // Ensure 'hidden' isn't accidentally processed here
                const resolvedParentPath = this.resolveLinkToPath(parentLink, file.path);
                if (resolvedParentPath) {
                  potentialParents.add(resolvedParentPath);
                }
              }
            }
          }
        }

        for (const resolvedParentPath of potentialParents) {
          if (!this.parentToChildren[resolvedParentPath]) {
            this.parentToChildren[resolvedParentPath] = new Set();
          }
          this.parentToChildren[resolvedParentPath].add(file.path);

          if (!this.childToParents.has(file.path)) {
            this.childToParents.set(file.path, new Set());
          }
          this.childToParents.get(file.path)?.add(resolvedParentPath);
          this.allFiles.add(resolvedParentPath);
        }
      }
    }
    this.allFiles.add(file.path); // Ensure the file itself is always tracked
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
    return resolvedFile ? resolvedFile.path : null;
  }

  private updateFileInGraph(file: TFile, cache: CachedMetadata) {
    this.removeFileChildRelationships(file); // Remove old relationships where it is a child
    this.processFile(file); // Add new relationships
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }

  /**
   * Removes a file's relationships where it acts as a CHILD.
   * Does NOT remove its entry from `parentToChildren` if it acts as a PARENT.
   * This is used for updates where a file's own parent links might change,
   * but its status as a parent to other files remains.
   */
  private removeFileChildRelationships(file: TFile) {
    // Remove file as a child from its parents
    const parentsOfFile = this.childToParents.get(file.path);
    if (parentsOfFile) {
      for (const parentPath of parentsOfFile) {
        this.parentToChildren[parentPath]?.delete(file.path);
        if (this.parentToChildren[parentPath]?.size === 0) {
          delete this.parentToChildren[parentPath];
        }
      }
    }
    this.childToParents.delete(file.path);
  }

  /**
   * Completely removes a file from the graph, including its identity as a parent.
   * This is used when a file is deleted.
   */
  private deleteFileFromGraph(file: TFile) {
    this.allFiles.delete(file.path); // Remove from master list

    // Remove child-side relationships
    this.removeFileChildRelationships(file);

    // Remove file as a parent from its children
    const childrenOfFile = this.parentToChildren[file.path];
    if (childrenOfFile) {
      for (const childPath of childrenOfFile) {
        this.childToParents.get(childPath)?.delete(file.path);
        if (this.childToParents.get(childPath)?.size === 0) {
          this.childToParents.delete(childPath);
        }
      }
    }
    delete this.parentToChildren[file.path]; // Completely remove this file as a parent
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }

  private renameFileInGraph(file: TFile, oldPath: string) {
    // Completely remove all traces of the old path
    this.deleteFileFromGraph({ path: oldPath } as TFile);

    // Re-process the file with its new path to establish all its relationships
    this.processFile(file);

    // After renaming, a full graph rebuild is the most robust way to ensure
    // all existing references (especially from children whose `parent` property
    // might point to the old file name/path) are correctly re-resolved.
    this.buildGraph();
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }
}