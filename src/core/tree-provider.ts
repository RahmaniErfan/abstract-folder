import { TFile } from "obsidian";
import { ResourceURI } from "./uri";

/**
 * Contextual information for tree operations.
 */
export interface TreeContext {
	providerIds: string[] | null;
	libraryId: string | null;
}

/**
 * Standard tree node structure for the SOVM architecture.
 */
export interface TreeNode {
	uri: ResourceURI;
	name: string;
	isFolder: boolean;
	depth?: number; // Calculated by TreeCoordinator during flattening
	file?: TFile; // Optional, as some nodes might be purely virtual or from remote sources
	metadata?: Record<string, unknown>;
}

export interface ITreeProvider {
	readonly id: string;

	getRoots(context: TreeContext): Promise<TreeNode[]>;
	getChildren(parentUri: ResourceURI, context: TreeContext): Promise<TreeNode[]>;
	getMetadata(uri: ResourceURI): Promise<Record<string, unknown>>;
	search(query: string): Promise<ResourceURI[]>;
}
