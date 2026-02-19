import { App, TFile } from 'obsidian';
import { AbstractFolderPluginSettings } from '../settings';
import { IGraphEngine, FileID, NodeMeta } from './graph-engine';
import { Group } from '../types';

/**
 * Defines the "Configuration Rule Set" for a specific view context.
 * This interface decouples "What to show" (Logic) from "How to show it" (UI/TreeBuilder).
 */
export interface ContentProvider {
    /**
     * Unique identifier for the scope (e.g. 'global', 'library', 'space:path/to/space')
     */
    resolveScope(): string;

    /**
     * Determines the root nodes for the tree.
     */
    getRoots(graph: IGraphEngine): FileID[];

    /**
     * Returns the "Creation Root" path if one exists.
     * New files created via the toolbar should go here.
     */
    getCreationRoot(): string | undefined;

    // Capabilities
    supportsGroups(): boolean;
    supportsSorting(): boolean;
    supportsFiltering(): boolean; // Usually true, but allows disabling if needed
    
    // Actions (Optional hooks for custom behavior, e.g. "Create Note" logic overrides)
    // For now, toolbar handles standard creation using getCreationRoot()
}

/**
 * The standard provider for the "My Abstract Folder" view.
 * Handles Orphans, Groups, and Global Settings.
 */
export class GlobalContentProvider implements ContentProvider {
    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private activeGroupId: string | null
    ) {}

    resolveScope(): string {
        return 'global';
    }

    getRoots(graph: IGraphEngine): FileID[] {
        // Delegate to GraphEngine's robust request handler, but we could move that logic here eventually.
        // For now, GraphEngine.getAllRoots is "SmartEnough" to handle activeGroupId logic if we pass it,
        // BUT the goal is to move logic OUT of GraphEngine if possible.
        // Let's rely on GraphEngine for now to minimize risk, but use the provider to orchestrate.
        
        // Actually, GraphEngine.getAllRoots takes (activeGroupId, scopingPath).
        // Global view has activeGroupId, but NO scopingPath.
        return graph.getAllRoots(this.activeGroupId, null);
    }

    getCreationRoot(): string | undefined {
        // Global view: creation is usually at root or active file location.
        // Toolbar logic handles "if no root, use modal default".
        return undefined;
    }

    supportsGroups(): boolean {
        return true;
    }

    supportsSorting(): boolean {
        return true;
    }

    supportsFiltering(): boolean {
        return true;
    }
}

/**
 * A provider for "Scoped" views like Library Explorer or Abstract Spaces.
 * It focuses on a specific subdirectory and ignores global groups.
 */
export class ScopedContentProvider implements ContentProvider {
    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private scopingPath: string,
        private scopeId: string, // e.g. 'library' or 'space:xyz'
        private allowGroups: boolean = false,
        private activeGroupId: string | null = null
    ) {}

    resolveScope(): string {
        return this.scopeId;
    }

    getRoots(graph: IGraphEngine): FileID[] {
        // Scoped view: Pass the scoping path.
        // If groups are allowed, we pass activeGroupId too.
        return graph.getAllRoots(this.activeGroupId, this.scopingPath);
    }

    getCreationRoot(): string | undefined {
        return this.scopingPath;
    }

    supportsGroups(): boolean {
        return this.allowGroups;
    }

    supportsSorting(): boolean {
        return true;
    }

    supportsFiltering(): boolean {
        return true;
    }
}
