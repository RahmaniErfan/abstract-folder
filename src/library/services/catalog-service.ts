import { requestUrl } from "obsidian";
import { CatalogItem, LibrarySettings } from "../types";

export class CatalogService {
    // Hardcoded official catalog URL
    private static readonly OFFICIAL_CATALOG_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/catalog.json";

    private _categories: Set<string> = new Set();

    constructor(private settings: LibrarySettings) {}

    /**
     * Fetches items from all configured catalogs (official + custom) + standalones.
     * Consolidates and deduplicates by item.id.
     */
    async fetchAllItems(): Promise<CatalogItem[]> {
        const urls = [
            CatalogService.OFFICIAL_CATALOG_URL,
            ...this.settings.catalogs
        ].filter(url => !url.includes("/username/"));

        const allItems: CatalogItem[] = [];
        const seenIds = new Set<string>();
        this._categories.clear();

        // 1. Fetch from catalogs
        for (const url of urls) {
            try {
                const response = await requestUrl({ url });
                if (response.status === 200) {
                    const data = response.json;
                    let items: CatalogItem[] = [];
                    
                    if (Array.isArray(data)) {
                        items = data;
                    } else if (data && typeof data === 'object' && Array.isArray(data.libraries)) {
                        items = data.libraries.map((lib: any) => ({
                            ...lib,
                            repositoryUrl: lib.repositoryUrl || lib.repository
                        }));
                        if (Array.isArray(data.categories)) {
                            data.categories.forEach((cat: string) => this._categories.add(cat));
                        }
                    }

                    for (const item of items) {
                        if (!seenIds.has(item.id)) {
                            item.sourceCatalog = url;
                            allItems.push(item);
                            seenIds.add(item.id);
                            if (item.category) this._categories.add(item.category);
                        }
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch catalog from ${url}:`, error);
            }
        }

        // 2. Resolve Standalones
        const standalones = this.settings.standaloneLibraries || [];
        for (const url of standalones) {
            const item = await this.resolveStandalone(url);
            if (item && !seenIds.has(item.id)) {
                item.sourceCatalog = "standalone";
                allItems.push(item);
                seenIds.add(item.id);
                if (item.category) this._categories.add(item.category);
            }
        }

        return allItems;
    }

    get categories(): string[] {
        return Array.from(this._categories).sort();
    }

    /**
     * Resolves a library from a standalone URL.
     */
    async resolveStandalone(url: string): Promise<CatalogItem | null> {
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
                        repositoryUrl: meta.repositoryUrl || meta.repository || url,
                        author: meta.author || "Unknown",
                        category: meta.category || "Standalone",
                        tags: (meta as any).tags || ["standalone"],
                        fundingUrl: meta.fundingUrl
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
