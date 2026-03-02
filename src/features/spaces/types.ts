export interface SharedSpaceConfig {
    path: string;
    enableScheduledSync: boolean;
    syncIntervalValue: number;
    syncIntervalUnit: 'minutes' | 'hours' | 'days' | 'weeks';
    lastSync?: number;
    parentProperty?: string;
    childrenProperty?: string;
}

export interface SpacesFeatureSettings {
    sharedSpacesRoot: string; // Default: "Abstract Spaces"
    sharedSpaces: string[]; // List of paths that are Shared Spaces (Collaborative)
    spaceConfigs: Record<string, SharedSpaceConfig>; // Per-space configuration
}
