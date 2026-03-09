import { FolderNode } from "../../../types";

export type LibraryStatus = 'up-to-date' | 'update-available' | 'dirty' | 'syncing' | 'error';

// Moved SharedSpaceConfig to features/spaces/types.ts

export interface LocalConfig {
    propertyNames?: {
        parent?: string | string[];
        children?: string | string[];
    };
    forceStandardProperties?: boolean;
}

export interface LibraryConfig {
    id: string;
    name: string;
    author: string;
    description?: string;
    version: string;
    repo: string;
    branch: string;
    lastSync?: number;
    isStandalone?: boolean;
    fundingUrl?: string;
    category?: string;
    // --- Manifest Fields (Tracked in Git) ---
    topics?: string[];               // Topics defined in the remote manifest.json or library.json
    // --- Local Runtime State (Merged from LibraryState) ---
    localVersion?: string;           
    subscribedTopics?: string[];     
    availableTopics?: string[];      
    lastEngine2GcTime?: number;      
}

/**
 * Persisted local state for a library. 
 * Stored in plugin data.json, NEVER in the repository.
 */
export interface LibraryState {
    id: string;
    vaultPath: string;
    localVersion: string;           // Locally synced version (persisted for SemVer comparison)
    subscribedTopics: string[];     // Sparse checkout: only sync these topics
    availableTopics: string[];      // Full list of topics available in technical manifest (fetched from CDN)
    lastEngine2GcTime?: number;      // Last git gc --prune=now timestamp
}

export interface LibraryNode extends FolderNode {
    isLibrary: true;
    libraryId: string;
    catalogId: string;
    isPublic: boolean;
    status: LibraryStatus;
    isLocked: boolean;
    children: (FolderNode | LibraryNode)[];
}

export interface CatalogItem {
    id: string;
    name: string;
    description: string;
    repo: string;
    author: string;
    category: string;
    tags?: string[];
    sourceCatalog?: string;
    fundingUrl?: string;
}

export interface LibraryFeatureSettings {
    librariesPath: string; // Default: "Abstract Library"
    catalogs: string[];  // List of custom catalog URLs
    standaloneLibraries: string[]; // List of direct repository URLs
    libraryStates: Record<string, LibraryState>; // Per-library local state (metadata, subscriptions)
    libraryTemplateRepo: string; // The URL of the library template repository
}

/**
 * Shared Git settings used across all features (Library, Spaces, Personal)
 */
export interface GitFeatureSettings {
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
    autoSyncEnabled: boolean; // Whether auto-sync engine is active
    lastGcTime?: number; // Timestamp of last git gc run
}
