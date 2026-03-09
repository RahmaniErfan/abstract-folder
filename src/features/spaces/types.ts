export interface SharedSpaceConfig {
    path: string;
    enableScheduledSync: boolean;
    syncIntervalValue: number;
    syncIntervalUnit: 'minutes' | 'hours' | 'days' | 'weeks';
    lastSync?: number;
    parentProperty?: string | string[];
    childrenProperty?: string | string[];
    spaceType?: 'shared' | 'library';
}

export interface SpacesFeatureSettings {
    sharedSpacesRoot: string; // Default: "Abstract Spaces"
    sharedSpaces: string[]; // List of paths that are Shared Spaces (Collaborative)
    spaceConfigs: Record<string, SharedSpaceConfig>; // Per-space configuration
}
