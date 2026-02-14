import { TFile } from "obsidian";
import { ResourceURI } from "./uri";

/**
 * Standard tree node structure for the SOVM architecture.
 */
export interface TreeNode {
	uri: ResourceURI;
	name: string;
	isFolder: boolean;
	depth?: number; // Calculated by TreeCoordinator during flattening
	file?: TFile; // Optional, as some nodes might be purely virtual or from remote sources
	metadata?: Record<string, any>;
}

/**
 * Interface for pluggable tree data sources.
 */
export interface ITreeProvider {
	readonly id: string;

	getRoots(): Promise<TreeNode[]>;
	getChildren(parentUri: ResourceURI): Promise<TreeNode[]>;
	getMetadata(uri: ResourceURI): Promise<Record<string, any>>;
	search(query: string): Promise<ResourceURI[]>;
}
