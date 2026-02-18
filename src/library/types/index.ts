import { FolderNode } from "../../types";

export type LibraryStatus = 'up-to-date' | 'update-available' | 'dirty' | 'syncing' | 'error';

export interface SharedSpaceConfig {
    path: string;
    enableScheduledSync: boolean;
    syncIntervalValue: number;
    syncIntervalUnit: 'minutes' | 'hours' | 'days' | 'weeks';
    lastSync?: number;
}

export interface LibraryConfig {
    id: string;
    name: string;
    author: string;
    description?: string;
    version: string;
    repositoryUrl: string;
    branch: string;
    lastSync?: number;
    isStandalone?: boolean;
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
    sharedSpacesRoot: string; // Default: "Abstract Spaces"
    registries: string[];  // List of custom registry URLs
    standaloneLibraries: string[]; // List of direct repository URLs
    sharedSpaces: string[]; // List of paths that are Shared Spaces (Collaborative)
    spaceConfigs: Record<string, SharedSpaceConfig>; // Per-space configuration
    personalBackups: string[]; // List of paths that are Personal Backups
    githubToken?: string;
    githubUsername?: string;
    githubAvatar?: string;
    gitName?: string;
    gitEmail?: string;
    deviceId?: string;
    enableScheduledSync: boolean;
    syncIntervalValue: number;
    syncIntervalUnit: 'minutes' | 'hours' | 'days' | 'weeks';
    lastScheduledSync?: number;
    securityExclusions: string[]; // Patterns for files to exclude from sync
}
