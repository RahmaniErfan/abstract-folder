import { requestUrl } from "obsidian";
import { CatalogItem, LibraryFeatureSettings as LibrarySettings, LibraryConfig } from "../types";

export class CatalogService {
    // Hardcoded official catalog URL
    private static readonly OFFICIAL_CATALOG_URL = "https://raw.githubusercontent.com/RahmaniErfan/abstract-catalog/main/.abstract/catalog.json";

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
        for (const inputUrl of urls) {
            try {
                let url = inputUrl;
                if (!url.startsWith("http")) {
                    url = `https://raw.githubusercontent.com/${url}/main/.abstract/catalog.json`;
                } else if (url.includes("github.com") && !url.includes("raw.githubusercontent.com")) {
                    url = url.replace("github.com", "raw.githubusercontent.com").replace(/\/blob\/main\//, "/main/") + (url.endsWith(".json") ? "" : "/main/.abstract/catalog.json");
                }

                const response = await requestUrl({ url });
                if (response.status === 200) {
                    const data = response.json;
                    let items: CatalogItem[] = [];
                    
                    if (Array.isArray(data)) {
                        items = data;
                    } else if (data && typeof data === 'object' && Array.isArray(data.libraries)) {
                        items = data.libraries.map((lib: any) => ({
                            ...lib,
                            repo: lib.repo || lib.repositoryUrl || lib.repository
                        }));
                        if (Array.isArray(data.categories)) {
                            data.categories.forEach((cat: string) => this._categories.add(cat));
                        }
                    }

                    for (const item of items) {
                        if (!seenIds.has(item.id)) {
                            item.sourceCatalog = inputUrl;
                            allItems.push(item);
                            seenIds.add(item.id);
                            if (item.category) this._categories.add(item.category);
                        }
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch catalog from ${inputUrl}:`, error);
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
    async resolveStandalone(inputUrl: string): Promise<CatalogItem | null> {
        try {
            let url = inputUrl;
            let repoSlug = inputUrl;

            if (!url.startsWith("http")) {
                repoSlug = url;
                url = `https://github.com/${url}`;
            }

            // Try to fetch library.json if it's a GitHub repo
            let metadataUrl = url;
            if (url.includes("github.com")) {
                metadataUrl = url.replace("github.com", "raw.githubusercontent.com") + "/main/.abstract/library.json";
                try { 
                    const pathname = new URL(url).pathname;
                    repoSlug = pathname.startsWith("/") ? pathname.substring(1) : pathname; 
                } catch {}
            }

            try {
                const response = await requestUrl({ url: metadataUrl });
                if (response.status === 200) {
                    const meta = response.json as Record<string, string>;
                    return {
                        id: meta.id || inputUrl,
                        name: meta.name || inputUrl.split("/").pop() || "Unknown Library",
                        description: meta.description || "Standalone library",
                        repo: meta.repo || meta.repositoryUrl || meta.repository || repoSlug,
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
                id: inputUrl,
                name: inputUrl.split("/").pop() || inputUrl,
                description: "Standalone library",
                repo: repoSlug,
                author: "Unknown",
                category: "Standalone",
                tags: ["standalone"]
            };
        } catch {
            return null;
        }
    }

    /**
     * Handshake: Fetches the library.json from a remote repository.
     */
    async fetchRemoteLibraryConfig(repoUrl: string): Promise<LibraryConfig | null> {
        if (!repoUrl) return null;

        let metadataUrl = repoUrl;
        if (repoUrl.includes("github.com")) {
            // Normalize: remove .git suffix if present
            const cleanUrl = repoUrl.replace(/\.git$/, "");
            metadataUrl = cleanUrl.replace("github.com", "raw.githubusercontent.com") + "/main/.abstract/library.json";
        } else if (!repoUrl.startsWith("http")) { // If it's just a slug "user/repo"
            metadataUrl = `https://raw.githubusercontent.com/${repoUrl}/main/.abstract/library.json`;
        }

        try {
            const response = await requestUrl({ url: metadataUrl });
            if (response.status === 200) {
                const data = response.json;
                return {
                    id: data.id,
                    name: data.name,
                    author: data.author,
                    description: data.description,
                    version: data.version,
                    repo: repoUrl,
                    branch: data.branch || "main",
                    subscribedTopics: [], // Initialize empty
                    availableTopics: data.topics || [] // Read topics from JSON
                };
            }
        } catch (error) {
            console.error(`Failed to fetch remote library config from ${metadataUrl}:`, error);
        }
        return null;
    }
}
