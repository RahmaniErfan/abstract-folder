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
        if (!(file instanceof TFile) || file.extension !== 'md') return;

        // Check if the parent folder is synced
        const parentPath = file.parent ? file.parent.path : "";
        // Root is "/", but getAbstractParentForPhysicalFolder expects "" for root or "Folder"
        // Adjust logic: file.parent.path returns "/" for root if using getAbstractFileByPath("/") but usually it returns parent folder name or "/"
        // Let's standardise: if parent is root, path is "/"
        
        const abstractParentPath = this.indexer.getAbstractParentForPhysicalFolder(parentPath === "/" ? "" : parentPath);

        if (abstractParentPath) {
            await this.linkFileToAbstractParent(file, abstractParentPath);
        }
    }

    private async handleFileRename(file: TAbstractFile, oldPath: string) {
        if (!(file instanceof TFile) || file.extension !== 'md') return;

        const newParentPath = file.parent ? file.parent.path : "";
        const abstractParentPath = this.indexer.getAbstractParentForPhysicalFolder(newParentPath === "/" ? "" : newParentPath);

        // If moved INTO a synced folder
        if (abstractParentPath) {
             // We check if it is already linked to avoid double linking or overwriting intentional changes?
             // For now, "Sync" implies strict adherence. If you move it physically, you want it there abstractly.
            await this.linkFileToAbstractParent(file, abstractParentPath);
        }
        
        // Note: If moved OUT of a synced folder, we might want to remove the link?
        // That's tricky because the user might want to keep the abstract link even if moved physically.
        // But strictly "Synced" implies mirroring.
        // For V1, we only ADD links when moving IN. We don't remove when moving OUT to avoid destructive data loss.
    }

    private async linkFileToAbstractParent(file: TFile, abstractParentPath: string) {
        const abstractParentFile = this.app.vault.getAbstractFileByPath(abstractParentPath);
        if (!abstractParentFile) return;

        const abstractParentName = abstractParentFile.name.replace(/\.md$/, '');

        await this.app.fileManager.processFrontMatter(file, (frontmatter: AbstractFolderFrontmatter) => {
            const propertyName = this.settings.propertyName;
            const currentParents = frontmatter[propertyName];
            
            const newLink = `[[${abstractParentName}]]`;
            
            let parentLinks: string[] = [];

            if (typeof currentParents === 'string') {
                parentLinks = [currentParents];
            } else if (Array.isArray(currentParents)) {
                parentLinks = currentParents as string[];
            }

            // Check if already linked
            // Simple check
            const alreadyLinked = parentLinks.some(link => link.includes(abstractParentName));
            
            if (!alreadyLinked) {
                parentLinks.push(newLink);
                // Update frontmatter
                if (parentLinks.length === 1) {
                    frontmatter[propertyName] = parentLinks[0];
                } else {
                    frontmatter[propertyName] = parentLinks;
                }
                new Notice(`Auto-linked ${file.basename} to synced abstract folder: ${abstractParentName}`);
            }
        });
    }
}