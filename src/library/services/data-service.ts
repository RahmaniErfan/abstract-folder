import { LibraryConfig } from "../types";

/**
 * Service for managing library.config.json files and local library metadata.
 */
export class DataService {
    /**
     * Parse and validate a library.config.json content.
     */
    static parseLibraryConfig(content: string): LibraryConfig {
        const config = JSON.parse(content) as Partial<LibraryConfig>;
        
        // Basic validation
        if (!config.id || !config.repositoryUrl || !config.version) {
            throw new Error("Invalid library configuration: missing required fields (id, repositoryUrl, version)");
        }
        
        return {
            id: config.id,
            name: config.name || config.id,
            author: config.author || "Unknown",
            description: config.description,
            version: config.version,
            repositoryUrl: config.repositoryUrl,
            branch: config.branch || "main",
            lastSync: config.lastSync
        };
    }

    /**
     * Generate standard content for library.config.json
     */
    static stringifyLibraryConfig(config: LibraryConfig): string {
        return JSON.stringify(config, null, 2);
    }
}
