import { App, TFile, TFolder } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { DataService } from "./data-service";
import { Logger } from "../../utils/logger";

export interface ResolvedProperties {
    parentPropertyNames: string[];
    childrenPropertyNames: string[];
    forceStandardProperties: boolean;
}

export class ConfigResolver {
    private cache: Map<string, ResolvedProperties> = new Map();

    constructor(private app: App, private settings: AbstractFolderPluginSettings) {}

    /**
     * Resolves the property names for a given file path by walking up the tree.
     */
    async getProperties(filePath: string): Promise<ResolvedProperties> {
        // Find the nearest folder
        let currentPath = filePath;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            currentPath = file.parent?.path || "";
        }

        // Check cache for this folder path
        if (this.cache.has(currentPath)) {
            return this.cache.get(currentPath)!;
        }

        const resolved = await this.resolvePath(currentPath);
        this.cache.set(currentPath, resolved);
        return resolved;
    }

    private async resolvePath(folderPath: string): Promise<ResolvedProperties> {
        let current = folderPath;
        
        // Default values from global settings
        const globalProps: ResolvedProperties = {
            parentPropertyNames: this.settings.parentPropertyNames,
            childrenPropertyNames: this.settings.childrenPropertyNames,
            forceStandardProperties: false
        };

        while (current !== "" && current !== "/") {
            // 1. Check for .abstract/config.json
            const localConfigPath = `${current}/.abstract/config.json`;
            const localFile = this.app.vault.getAbstractFileByPath(localConfigPath);
            if (localFile instanceof TFile) {
                try {
                    const content = await this.app.vault.read(localFile);
                    const config = DataService.parseLocalConfig(content);
                    if (config.propertyNames || config.forceStandardProperties !== undefined) {
                        return {
                            parentPropertyNames: config.propertyNames?.parent ? [config.propertyNames.parent] : globalProps.parentPropertyNames,
                            childrenPropertyNames: config.propertyNames?.children ? [config.propertyNames.children] : globalProps.childrenPropertyNames,
                            forceStandardProperties: config.forceStandardProperties || false
                        };
                    }
                } catch (e) {
                    Logger.error(`Failed to read local config at ${localConfigPath}`, e);
                }
            }

            // 2. Check for library.json
            const libraryJsonPath = `${current}/library.json`;
            const libraryFile = this.app.vault.getAbstractFileByPath(libraryJsonPath);
            if (libraryFile instanceof TFile) {
                try {
                    const content = await this.app.vault.read(libraryFile);
                    const config = DataService.parseLibraryConfig(content);
                    
                    const parentProps = config.parentProperty ? [config.parentProperty] : globalProps.parentPropertyNames;
                    const childrenProps = config.childrenProperty ? [config.childrenProperty] : globalProps.childrenPropertyNames;
                    
                    return {
                        parentPropertyNames: parentProps,
                        childrenPropertyNames: childrenProps,
                        forceStandardProperties: config.forceStandardProperties || false
                    };
                } catch (e) {
                    Logger.error(`Failed to read library config at ${libraryJsonPath}`, e);
                }
            }

            // 3. Check Shared Space config in settings
            const spaceConfig = this.settings.librarySettings.spaceConfigs[current];
            if (spaceConfig && (spaceConfig.parentProperty || spaceConfig.childrenProperty)) {
                return {
                    parentPropertyNames: spaceConfig.parentProperty ? [spaceConfig.parentProperty] : globalProps.parentPropertyNames,
                    childrenPropertyNames: spaceConfig.childrenProperty ? [spaceConfig.childrenProperty] : globalProps.childrenPropertyNames,
                    forceStandardProperties: false
                };
            }

            // Move up
            const folder = this.app.vault.getAbstractFileByPath(current);
            if (folder instanceof TFolder) {
                current = folder.parent?.path || "";
            } else {
                break;
            }
        }

        return globalProps;
    }

    async listConfigs(): Promise<{ path: string, type: 'library' | 'local', config: any }[]> {
        const configs: { path: string, type: 'library' | 'local', config: any }[] = [];
        const files = this.app.vault.getMarkdownFiles(); // We can't use markdown files only, need to scan all files for library.json

        const allFiles = this.app.vault.getAllLoadedFiles();
        for (const file of allFiles) {
            if (!(file instanceof TFile)) continue;

            if (file.name === 'library.json') {
                try {
                    const content = await this.app.vault.read(file);
                    const config = DataService.parseLibraryConfig(content);
                    configs.push({ path: file.path, type: 'library', config });
                } catch {}
            } else if (file.path.endsWith('/.abstract/config.json')) {
                try {
                    const content = await this.app.vault.read(file);
                    const config = DataService.parseLocalConfig(content);
                    configs.push({ path: file.path, type: 'local', config });
                } catch {}
            }
        }
        return configs;
    }

    clearCache() {
        this.cache.clear();
    }
}
