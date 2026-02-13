import { FolderNode } from "../../types";

export type LibraryStatus = 'up-to-date' | 'update-available' | 'dirty' | 'syncing' | 'error';

export interface LibraryConfig {
    id: string;
    name: string;
    author: string;
    description?: string;
    version: string;
    repositoryUrl: string;
    branch: string;
    lastSync?: number;
}

export interface LibraryNode extends FolderNode {
    isLibrary: true;
    libraryId: string;
    registryId: string;
    isPublic: boolean;
    status: LibraryStatus;
    isLocked: boolean;
    children: (FolderNode | LibraryNode)[];
}

export interface RegistryItem {
    id: string;
    name: string;
    description: string;
    repositoryUrl: string;
    author: string;
    category: string;
    tags: string[];
}

export interface LibrarySettings {
    librariesPath: string; // Default: "Abstract Library"
    registries: string[];  // List of registry URLs
    githubToken?: string;
    deviceId?: string;
}
