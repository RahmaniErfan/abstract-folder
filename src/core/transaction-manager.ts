import { App, TFile, Notice } from 'obsidian';
import { IGraphEngine } from './graph-engine';
import { AbstractFolderPluginSettings } from '../settings';
import { Logger } from '../utils/logger';

export interface TransactionError {
    file: string;
    error: string;
}

export interface TransactionResult {
    success: boolean;
    modifiedCount: number;
    errors: TransactionError[];
}

/**
 * The TransactionManager is the gatekeeper for multi-file operations.
 * It ensures that batch updates to frontmatter are executed safely and efficiently.
 */
export class TransactionManager {
    private app: App;
    private graph: IGraphEngine;
    private settings: AbstractFolderPluginSettings;
    private concurrencyLimit = 10;

    constructor(app: App, graph: IGraphEngine, settings: AbstractFolderPluginSettings) {
        this.app = app;
        this.graph = graph;
        this.settings = settings;
    }

    /**
     * Executes a series of frontmatter updates in a throttled batch.
     */
    private async executeBatch(
        targets: TFile[],
        processor: (frontmatter: Record<string, unknown>) => boolean
    ): Promise<TransactionResult> {
        const errors: TransactionError[] = [];
        let modifiedCount = 0;

        // 1. Suspend Graph to prevent event storms
        this.graph.suspend();

        try {
            // 2. Process in chunks
            for (let i = 0; i < targets.length; i += this.concurrencyLimit) {
                const chunk = targets.slice(i, i + this.concurrencyLimit);
                await Promise.all(
                    chunk.map(async (file) => {
                        try {
                            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                                const changed = processor(fm);
                                if (changed) {
                                    modifiedCount++;
                                    return true;
                                }
                                return false;
                            });
                        } catch (e) {
                            errors.push({
                                file: file.path,
                                error: e instanceof Error ? e.message : String(e)
                            });
                        }
                    })
                );
            }
        } finally {
            // 3. Resume and force re-index to reflect changes
            this.graph.resume();
            await this.graph.forceReindex();
        }

        if (errors.length > 0) {
            new Notice(`Updated ${modifiedCount} files. ${errors.length} failures.`);
            Logger.warn('Transaction batch completed with errors:', errors);
        }

        return {
            success: errors.length === 0,
            modifiedCount,
            errors
        };
    }

    /**
     * Moves a node to a new parent by updating its frontmatter link.
     */
    async moveNode(file: TFile, newParentPath: string): Promise<TransactionResult> {
        const parentProp = this.settings.propertyName || 'Parent'; // Use first available or default
        
        return this.executeBatch([file], (fm) => {
            // We use the newParentPath. In Obsidian, links in frontmatter are best as [[Path]]
            // or just Path if the resolver is good. The GraphEngine handles both.
            // For safety and portability, we use [[Path]].
            fm[parentProp] = `[[${newParentPath}]]`;
            return true;
        });
    }

    /**
     * Renames an "Abstract Folder" by updating all children that link to it.
     */
    async renameAbstractFolder(oldPath: string, newPath: string): Promise<TransactionResult> {
        // 1. Identify all children currently linking to oldPath
        const childIds = this.graph.getChildren(oldPath);
        const targets: TFile[] = [];

        for (const id of childIds) {
            const file = this.app.vault.getAbstractFileByPath(id);
            if (file instanceof TFile) {
                targets.push(file);
            }
        }

        // 2. Identify property names to check
        const parentProps = new Set(this.settings.parentPropertyNames || []);
        if (this.settings.propertyName) parentProps.add(this.settings.propertyName);

        // 3. Execute batch update
        return this.executeBatch(targets, (fm) => {
            let changed = false;
            for (const prop of parentProps) {
                const val = fm[prop];
                if (!val) continue;

                if (Array.isArray(val)) {
                    fm[prop] = val.map(v => this.updateLinkInString(String(v), oldPath, newPath));
                    changed = true;
                } else if (typeof val === 'string') {
                    fm[prop] = this.updateLinkInString(val, oldPath, newPath);
                    changed = true;
                }
            }
            return changed;
        });
    }

    private updateLinkInString(val: string, oldPath: string, newPath: string): string {
        // Robust replacement of links. Handles [[OldPath]], [[OldPath|Alias]], [Alias](OldPath)
        // For simplicity in this v2 alpha, we do a targeted string replacement if it matches.
        // A more complex regex-based replacement from indexer.ts can be ported if needed.
        
        const oldName = this.getNameFromPath(oldPath);
        const newName = this.getNameFromPath(newPath);

        // Replace exact matches of path or basename within brackets
        return val
            .replace(`[[${oldPath}]]`, `[[${newPath}]]`)
            .replace(`[[${oldName}]]`, `[[${newName}]]`)
            .replace(`(${oldPath})`, `(${newPath})`);
    }

    private getNameFromPath(path: string): string {
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path.replace(/\.md$/, '');
        return path.substring(lastSlash + 1).replace(/\.md$/, '');
    }
}
