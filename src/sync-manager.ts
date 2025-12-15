import { App, TFile, TAbstractFile, Notice } from "obsidian";
import { AbstractFolderPluginSettings } from "./settings";
import { FolderIndexer } from "./indexer";
import AbstractFolderPlugin from "../main";
import { AbstractFolderFrontmatter } from "./types";

export class SyncManager {
    private app: App;
    private settings: AbstractFolderPluginSettings;
    private indexer: FolderIndexer;
    private plugin: AbstractFolderPlugin;
    
    // Queue for batching updates to parent files (prevent race conditions)
    // Key: Abstract Parent Path, Value: Set of child paths to add
    private pendingParentUpdates: Map<string, Set<string>> = new Map();
    private batchUpdateTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer, plugin: AbstractFolderPlugin) {
        this.app = app;
        this.settings = settings;
        this.indexer = indexer;
        this.plugin = plugin;
    }

    public registerEvents() {
        this.plugin.registerEvent(
            this.app.vault.on("create", (file) => this.handleFileCreate(file))
        );

        this.plugin.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => this.handleFileRename(file, oldPath))
        );
    }

    private async handleFileCreate(file: TAbstractFile) {
        if (!(file instanceof TFile)) return;

        // Check if the parent folder is synced
        const parentPath = file.parent ? file.parent.path : "";
        const normalizedParentPath = parentPath === "/" ? "" : parentPath;
        
        const abstractParentPath = this.indexer.getAbstractParentForPhysicalFolder(normalizedParentPath);

        if (abstractParentPath) {
            await this.linkFileToAbstractParent(file, abstractParentPath);
        }
    }

    private async handleFileRename(file: TAbstractFile, oldPath: string) {
        if (!(file instanceof TFile)) return;

        const newParentPath = file.parent ? file.parent.path : "";
        const normalizedParentPath = newParentPath === "/" ? "" : newParentPath;
        const abstractParentPath = this.indexer.getAbstractParentForPhysicalFolder(normalizedParentPath);

        // If moved INTO a synced folder
        if (abstractParentPath) {
            await this.linkFileToAbstractParent(file, abstractParentPath);
        }
    }

    private async linkFileToAbstractParent(file: TFile, abstractParentPath: string) {
        const abstractParentFile = this.app.vault.getAbstractFileByPath(abstractParentPath);
        if (!(abstractParentFile instanceof TFile)) return;

        if (file.extension === 'md') {
            // Markdown files: Safe to update immediately as we modify the child file itself
            await this.app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
                const propertyName = this.settings.propertyName;
                const currentParents = frontmatter[propertyName];
                
                const newLink = `[[${abstractParentFile.basename}]]`;
                
                let parentLinks: string[] = [];

                if (typeof currentParents === 'string') {
                    parentLinks = [currentParents];
                } else if (Array.isArray(currentParents)) {
                    parentLinks = currentParents as string[];
                }

                // Check if already linked
                const cleanNewLink = abstractParentFile.basename;
                const alreadyLinked = parentLinks.some(link => {
                    const cleanLink = link.replace(/[[\]"]/g, '').split('|')[0].trim();
                    return cleanLink === cleanNewLink;
                });
                
                if (!alreadyLinked) {
                    parentLinks.push(newLink);
                    if (parentLinks.length === 1) {
                        frontmatter[propertyName] = parentLinks[0];
                    } else {
                        frontmatter[propertyName] = parentLinks;
                    }
                    new Notice(`Auto-linked ${file.basename} to synced abstract folder: ${abstractParentFile.basename}`);
                }
            });
        } else {
            // Non-Markdown files: Must update the PARENT file.
            // Queue this update to batch it preventing race conditions.
            // Use full path to avoid ambiguity in links
            this.queueParentUpdate(abstractParentPath, file.path);
        }
    }

    private queueParentUpdate(abstractParentPath: string, childPath: string) {
        if (!this.pendingParentUpdates.has(abstractParentPath)) {
            this.pendingParentUpdates.set(abstractParentPath, new Set());
        }
        this.pendingParentUpdates.get(abstractParentPath)?.add(childPath);

        if (this.batchUpdateTimer) {
            clearTimeout(this.batchUpdateTimer);
        }

        this.batchUpdateTimer = setTimeout(() => {
            void this.processBatchUpdates();
        }, 300); // 300ms debounce
    }

    private async processBatchUpdates() {
        this.batchUpdateTimer = null;
        
        // Iterate over a copy of the map entries to safely handle async operations
        const updatesToProcess = new Map(this.pendingParentUpdates);
        this.pendingParentUpdates.clear();

        for (const [abstractParentPath, childrenPathsToAdd] of updatesToProcess) {
             const abstractParentFile = this.app.vault.getAbstractFileByPath(abstractParentPath);
             if (!(abstractParentFile instanceof TFile)) continue;

             try {
                await this.app.fileManager.processFrontMatter(abstractParentFile, (frontmatter: AbstractFolderFrontmatter) => {
                    const childrenProp = this.settings.childrenPropertyName;
                    const rawChildren = frontmatter[childrenProp];
                    
                    let childrenList: string[] = [];
                    if (typeof rawChildren === 'string') {
                        childrenList = [rawChildren];
                    } else if (Array.isArray(rawChildren)) {
                        childrenList = rawChildren as string[];
                    }

                    let addedCount = 0;
                    for (const childPath of childrenPathsToAdd) {
                        // Use full path for the link to avoid ambiguity
                        const newLink = `[[${childPath}]]`;
                        
                        if (!childrenList.includes(newLink)) {
                             const nameLink = `[[${childPath.split('/').pop()}]]`;
                             if (!childrenList.includes(nameLink)) {
                                childrenList.push(newLink);
                                addedCount++;
                             }
                        }
                    }

                    if (addedCount > 0) {
                        frontmatter[childrenProp] = childrenList.length === 1 ? childrenList[0] : childrenList;
                        new Notice(`Auto-linked ${addedCount} file(s) to synced abstract folder: ${abstractParentFile.basename}`);
                    }
                });
             } catch (error) {
                 console.error(`Abstract Folder: Failed to batch update parent ${abstractParentPath}`, error);
             }
        }
    }
}