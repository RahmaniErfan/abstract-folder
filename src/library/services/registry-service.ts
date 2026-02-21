import { requestUrl } from "obsidian";
import { RegistryItem, LibrarySettings } from "../types";

export class RegistryService {
    // Hardcoded official registry URL
    private static readonly OFFICIAL_CATALOG_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/directory.json";

    constructor(private settings: LibrarySettings) {}

    /**
     * Fetches items from all configured registries (official + custom).
     */
    async fetchAllItems(): Promise<RegistryItem[]> {
        const urls = [
            RegistryService.OFFICIAL_CATALOG_URL,
            ...this.settings.registries
        ].filter(url => !url.includes("/username/"));

        const allItems: RegistryItem[] = [];
        const seenIds = new Set<string>();

        for (const url of urls) {
            try {
                const response = await requestUrl({ url });
                if (response.status === 200) {
                    const items = response.json as RegistryItem[];
                    if (Array.isArray(items)) {
                        for (const item of items) {
                            if (!seenIds.has(item.id)) {
                                item.sourceCatalog = url;
                                allItems.push(item);
                                seenIds.add(item.id);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch registry from ${url}:`, error);
            }
        }

        return allItems;
    }

    /**
     * Resolves a library from a standalone URL.
     */
    async resolveStandalone(url: string): Promise<RegistryItem | null> {
        // For standalone, we might want to fetch a library.json from the root of the repo
        // to get the metadata, or just return a skeleton item.
        try {
            // Check if it's a valid URL
            new URL(url);
            
            // Try to fetch library.json if it's a GitHub repo
            let metadataUrl = url;
            if (url.includes("github.com")) {
                metadataUrl = url.replace("github.com", "raw.githubusercontent.com") + "/main/library.json";
            }

            try {
                const response = await requestUrl({ url: metadataUrl });
                if (response.status === 200) {
                    const meta = response.json as Record<string, string>;
                    return {
                        id: meta.id || url,
                        name: meta.name || url.split("/").pop() || "Unknown Library",
                        description: meta.description || "Standalone library",
                        repositoryUrl: url,
                        author: meta.author || "Unknown",
                        category: "Standalone",
                        tags: ["standalone"]
                    };
                }
            } catch {
                // Ignore failure to fetch metadata
            }

            // Fallback skeleton
            return {
                id: url,
                name: url.split("/").pop() || url,
                description: "Standalone library",
                repositoryUrl: url,
                author: "Unknown",
                category: "Standalone",
                tags: ["standalone"]
            };
        } catch {
            return null;
        }
    }
}
