import { LibraryConfig, LocalConfig } from "../types";

/**
 * Service for managing library.config.json files and local library metadata.
 */
export class DataService {
    /**
     * Parse and validate a library.config.json content.
     */
    static parseLibraryConfig(content: string): LibraryConfig {
        const config = JSON.parse(content) as any;
        
        const repositoryUrl = config.repositoryUrl || config.repository;

        // Basic validation
        if (!config.id || !repositoryUrl || !config.version) {
            throw new Error("Invalid library configuration: missing required fields (id, repositoryUrl, version)");
        }
        
        return {
            id: config.id,
            name: config.name || config.id,
            author: config.author || "Unknown",
            description: config.description,
            version: config.version,
            repositoryUrl: repositoryUrl,
            branch: config.branch || "main",
            lastSync: config.lastSync,
            parentProperty: config.parentProperty,
            childrenProperty: config.childrenProperty,
            forceStandardProperties: config.forceStandardProperties
        };
    }

    /**
     * Parse and validate a local .abstract/config.json content.
     */
    static parseLocalConfig(content: string): LocalConfig {
        try {
            const config = JSON.parse(content);
            return {
                propertyNames: config.propertyNames ? {
                    parent: config.propertyNames.parent,
                    children: config.propertyNames.children
                } : undefined,
                forceStandardProperties: config.forceStandardProperties
            };
        } catch (e) {
            console.error("Failed to parse local config:", e);
            return {};
        }
    }

    /**
     * Generate standard content for library.config.json
     */
    static stringifyLibraryConfig(config: LibraryConfig): string {
        return JSON.stringify(config, null, 2);
    }
}
