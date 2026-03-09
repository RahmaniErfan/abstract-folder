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
        
        const repo = config.repo || config.repositoryUrl || config.repository;

        // Basic validation
        if (!config.id || !repo || !config.version) {
            throw new Error("Invalid library configuration: missing required fields (id, repo, version)");
        }
        
        // Engine 2: Topic Data Mapping & Source Attribution
        // Priorities: 
        // 1. 'availableTopics' (Specific to local library.json state)
        // 2. 'topics' (Standard field in remote manifest.json)
        const availableTopics = config.availableTopics || config.topics || [];
        
        if (config.availableTopics) {
            console.log(`[DataService] [${config.id}] Source Attribution: Topics mapped from 'availableTopics' (Local State). count: ${availableTopics.length}`);
        } else if (config.topics) {
            console.log(`[DataService] [${config.id}] Source Attribution: Topics mapped from 'topics' (Manifest). count: ${availableTopics.length}`);
        } else {
            console.log(`[DataService] [${config.id}] Source Attribution: No topics found in config.`);
        }

        const configObj: LibraryConfig = {
            id: config.id,
            name: config.name || config.id,
            author: config.author || "Unknown",
            description: config.description,
            version: config.version,
            repo: repo,
            branch: config.branch || "main",
            lastSync: config.lastSync,
            category: config.category,
            topics: config.topics || []
        };

        console.debug(`[DataService] Parsed LibraryConfig (Manifest):`, configObj);
        return configObj;
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
