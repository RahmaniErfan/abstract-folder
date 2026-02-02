import { App, TFolder, Notice, normalizePath, Platform } from "obsidian";
import { FolderIndexer } from "../indexer";
import { AbstractFolderPluginSettings } from "../settings";
import { VIEW_TYPE_ABSTRACT_FOLDER } from "../view";
import { getLogs, Logger } from "./logger";


interface PluginManifestSummary {
    id: string;
    name: string;
    version: string;
    author?: string;
}

interface DebugPluginDetails {
    enabledPlugins: string[];
    manifests: PluginManifestSummary[];
}

interface VaultConfig {
    getConfig(key: string): unknown;
}

interface AppWithInternal extends App {
    version: string;
    isMobile: boolean;
    plugins: {
        enabledPlugins: Set<string>;
        manifests: Record<string, {
            name: string;
            version: string;
            author?: string;
        }>;
    };
    vault: App["vault"] & VaultConfig;
    customCss: {
        enabledSnippets: Set<string>;
        snippets: string[];
    };
}

interface AbstractFolderViewInternal {
    settings?: { viewStyle: string };
    isSearchVisible?: boolean;
    searchInputEl?: { value: string };
    isConverting?: boolean;
    isLoading?: boolean;
}

/**
 * Basic log capturing mechanism.
 * Since we don't have a global logger, we can at least try to capture
 * some recent activity or errors if we had a log buffer.
 * For now, we'll export the plugin's internal state which is "the state of stuff".
 */

export async function exportDebugDetails(app: App, settings: AbstractFolderPluginSettings, indexer: FolderIndexer) {
    const internalApp = app as AppWithInternal;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const debugFolderName = `abstract-folder-debug-${timestamp}`;
    const debugFolderPath = normalizePath(`${debugFolderName}`);

    try {
        // 1. Create the debug folder
        await app.vault.createFolder(debugFolderPath);
        new Notice(`Creating debug folder: ${debugFolderName}`);

        // 2. Gather Environment Info
        const configTheme = internalApp.vault.getConfig("theme");
        const configAccent = internalApp.vault.getConfig("accentColor");
        
        const vaultConfigKeys = [
            "useMarkdownLinks",
            "newLinkFormat",
            "attachmentFolderPath",
            "showUnsupportedFiles",
            "foldFootnotes",
            "strictLineBreaks"
        ];
        const vaultConfigs: Record<string, unknown> = {};
        vaultConfigKeys.forEach(key => {
            vaultConfigs[key] = internalApp.vault.getConfig(key);
        });

        const envInfo = {
            obsidianVersion: internalApp.version,
            isMobile: internalApp.isMobile,
            userAgent: "redacted",
            platform: Platform.isMacOS ? "macOS" : Platform.isWin ? "Windows" : Platform.isLinux ? "Linux" : Platform.isIosApp ? "iOS" : Platform.isAndroidApp ? "Android" : "unknown",
            theme: typeof configTheme === "string" ? configTheme : "default",
            accentColor: typeof configAccent === "string" ? configAccent : "none",
            vaultConfigs,
            activeSnippets: Array.from(internalApp.customCss?.enabledSnippets || []),
            allSnippets: internalApp.customCss?.snippets || [],
            activeFile: app.workspace.getActiveFile()?.path || "none"
        };
        await app.vault.create(normalizePath(`${debugFolderPath}/environment.json`), JSON.stringify(envInfo, null, 2));

        // 3. Gather Plugin Details
        const pluginDetails: DebugPluginDetails = {
            enabledPlugins: Array.from(internalApp.plugins.enabledPlugins),
            manifests: Object.keys(internalApp.plugins.manifests).map(id => {
                const manifest = internalApp.plugins.manifests[id];
                return {
                    id,
                    name: manifest.name,
                    version: manifest.version,
                    author: manifest.author
                };
            })
        };
        await app.vault.create(normalizePath(`${debugFolderPath}/plugins.json`), JSON.stringify(pluginDetails, null, 2));

        // 4. Gather Plugin Settings
        await app.vault.create(normalizePath(`${debugFolderPath}/settings.json`), JSON.stringify(settings, null, 2));

        // 5. Gather Vault Stats
        const allFiles = app.vault.getFiles();
        const markdownFiles = allFiles.filter(f => f.extension === "md");
        const vaultStats = {
            totalFiles: allFiles.length,
            markdownFiles: markdownFiles.length,
            folders: app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder).length,
            totalLinks: Object.keys(app.metadataCache.resolvedLinks).reduce((acc, path) => acc + Object.keys(app.metadataCache.resolvedLinks[path]).length, 0)
        };
        await app.vault.create(normalizePath(`${debugFolderPath}/vault_stats.json`), JSON.stringify(vaultStats, null, 2));

        // 6. Gather Graph Data (indexer state)
        const graph = indexer.getGraph();
        const graphData = {
            roots: Array.from(graph.roots),
            allFilesCount: graph.allFiles.size,
            parentToChildren: Object.fromEntries(
                Object.entries(graph.parentToChildren).map(([parent, children]) => [parent, Array.from(children)])
            ),
            childToParents: Object.fromEntries(
                Array.from(graph.childToParents.entries()).map(([child, parents]) => [child, Array.from(parents)])
            ),
            cycles: indexer.getCycles(),
            isBuilding: indexer.isGraphBuilding()
        };
        await app.vault.create(normalizePath(`${debugFolderPath}/graph_state.json`), JSON.stringify(graphData, null, 2));

        // 7. Gather Logs
        const logs = getLogs();
        await app.vault.create(normalizePath(`${debugFolderPath}/logs.json`), JSON.stringify(logs, null, 2));

        // 8. Gather View State (active views)
        const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_ABSTRACT_FOLDER);
        const viewStates = leaves.map((leaf, index) => {
            const view = leaf.view as unknown as AbstractFolderViewInternal;
            return {
                index,
                type: leaf.view.getViewType(),
                viewStyle: view.settings?.viewStyle,
                isSearchVisible: view.isSearchVisible,
                searchQuery: view.searchInputEl?.value,
                isConverting: view.isConverting,
                isLoading: view.isLoading
            };
        });
        await app.vault.create(normalizePath(`${debugFolderPath}/active_views.json`), JSON.stringify(viewStates, null, 2));

        // 9. Gather Folder Structure
        const structure: string[] = [];
        interface FolderStructureNode {
            name: string;
            type: "folder" | "file";
            path: string;
            children?: FolderStructureNode[];
        }

        const traverseForJson = (folder: TFolder): FolderStructureNode => {
            const node: FolderStructureNode = {
                name: folder.name || "/",
                type: "folder",
                path: folder.path,
                children: []
            };
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    node.children?.push(traverseForJson(child));
                } else {
                    node.children?.push({
                        name: child.name,
                        type: "file",
                        path: child.path
                    });
                }
            }
            return node;
        };

        const traverse = (folder: TFolder, level: number) => {
            structure.push("  ".repeat(level) + (folder.name || "/") + "/");
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    traverse(child, level + 1);
                } else {
                    structure.push("  ".repeat(level + 1) + child.name);
                }
            }
        };
        const rootFolder = app.vault.getRoot();
        traverse(rootFolder, 0);
        await app.vault.create(normalizePath(`${debugFolderPath}/folder_structure.txt`), structure.join("\n"));

        const jsonStructure = traverseForJson(rootFolder);
        await app.vault.create(normalizePath(`${debugFolderPath}/folder_structure.json`), JSON.stringify(jsonStructure, null, 2));

        new Notice(`Debug folder created successfully at: ${debugFolderPath}`);
    } catch (error) {
        Logger.error("Abstract Folder: Error exporting debug details", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to create debug folder: ${errorMessage}`);
    }
}
