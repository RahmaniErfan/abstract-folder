import { App, TFile, CachedMetadata } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FileGraph, ParentChildMap } from "./types";

export class FolderIndexer {
  private app: App;
  private settings: AbstractFolderPluginSettings;
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
    this.buildGraph(); // Rebuild graph with new setting
    this.app.workspace.trigger('abstract-folder:graph-updated');
  }

  async onload() {
    this.buildGraph();
    this.registerEvents();
  }

  onunload() {
    // Obsidian's registerEvent automatically handles unregistering during unload
  }

  getGraph(): FileGraph {
    return this.graph;
  }

  private registerEvents() {
    this.app.metadataCache.on("changed", (file: TFile, _data: string, cache: CachedMetadata) => {
      this.updateFileInGraph(file, cache);
    });

    this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        this.removeFileFromGraph(file);
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

  private processFile(file: TFile) {
    this.allFiles.add(file.path);
    const metadata = this.app.metadataCache.getFileCache(file);
    if (metadata?.frontmatter) {
      const parentProperty = metadata.frontmatter[this.settings.propertyName];
      if (parentProperty) {
        const parentLinks = Array.isArray(parentProperty) ? parentProperty : [parentProperty];
        for (const parentLink of parentLinks) {
          if (typeof parentLink === 'string') {
            const resolvedParentPath = this.resolveLinkToPath(parentLink, file.path);
            if (resolvedParentPath) {
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
      }
    }
  }

  private resolveLinkToPath(link: string, containingFilePath: string): string | null {
    // Clean the link to remove wiki-link brackets if present, and any potential aliases
    const cleanedLink = link.replace(/\[\[|\]\]/g, '').split('|')[0].trim();
    if (!cleanedLink) return null;

    // Resolve the link relative to the containing file
    const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(cleanedLink, containingFilePath);
    return resolvedFile ? resolvedFile.path : null;
  }

  private updateFileInGraph(file: TFile, cache: CachedMetadata) {
    this.removeFileFromGraph(file); // Remove old relationships
    this.processFile(file); // Add new relationships
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }

  private removeFileFromGraph(file: TFile) {
    this.allFiles.delete(file.path);

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
    delete this.parentToChildren[file.path];

    // Check if any removed parent/child is now an orphan and remove from allFiles if needed.
    // This is a bit complex as a file could be a parent, child, and standalone.
    // For simplicity, a full rebuild might be easier for allFiles integrity, but
    // for incremental updates, we just ensure it's removed if it's not a parent or child of anything else.
    // A more robust check might involve iterating through all remaining entries to see if this file path is referenced.
    // For now, we rely on `processFile` to re-add it if it's still relevant.
    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }

  private renameFileInGraph(file: TFile, oldPath: string) {
    // Remove old entries
    this.removeFileFromGraph({ path: oldPath } as TFile); // Simulate deletion of old path

    // Re-process the file with its new path
    this.processFile(file);

    // Update references in existing children's parent lists and parent's children lists
    for (const parentPath in this.parentToChildren) {
      const children = this.parentToChildren[parentPath];
      if (children.has(oldPath)) {
        children.delete(oldPath);
        children.add(file.path);
      }
    }

    const childEntriesToUpdate: [string, Set<string>][] = [];
    this.childToParents.forEach((parents, childPath) => {
      if (parents.has(oldPath)) {
        parents.delete(oldPath);
        parents.add(file.path);
      }
      if (childPath === oldPath) {
        childEntriesToUpdate.push([childPath, parents]);
      }
    });

    for (const [oldChildPath, parents] of childEntriesToUpdate) {
        this.childToParents.delete(oldChildPath);
        this.childToParents.set(file.path, parents);
    }
    this.allFiles.delete(oldPath);
    this.allFiles.add(file.path);

    this.app.workspace.trigger('abstract-folder:graph-updated'); // Notify view to re-render
  }
}