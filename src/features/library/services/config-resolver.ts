import { App, TFile, TFolder } from "obsidian";
import { AbstractFolderPluginSettings } from "../../../settings";
import { DataService } from "./data-service";
import { Logger } from "../../../utils/logger";

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
            const localConfigPath = current === "" ? ".abstract/config.json" : `${current}/.abstract/config.json`;
            try {
                if (await this.app.vault.adapter.exists(localConfigPath)) {
                    const content = await this.app.vault.adapter.read(localConfigPath);
                    const config = DataService.parseLocalConfig(content);
                    if (config.propertyNames || config.forceStandardProperties !== undefined) {
                        return {
                            parentPropertyNames: config.propertyNames?.parent ? (Array.isArray(config.propertyNames.parent) ? config.propertyNames.parent : [config.propertyNames.parent]) : globalProps.parentPropertyNames,
                            childrenPropertyNames: config.propertyNames?.children ? (Array.isArray(config.propertyNames.children) ? config.propertyNames.children : [config.propertyNames.children]) : globalProps.childrenPropertyNames,
                            forceStandardProperties: config.forceStandardProperties || false
                        };
                    }
                }
            } catch (e) {
                Logger.error(`Failed to read local config at ${localConfigPath}`, e);
            }

            // Removed checking for library.json config overrides

            // 3. Check Shared Space config in settings
            const spaceConfig = this.settings.spaces.spaceConfigs[current];
            if (spaceConfig && (spaceConfig.parentProperty || spaceConfig.childrenProperty)) {
                return {
                    parentPropertyNames: spaceConfig.parentProperty ? (Array.isArray(spaceConfig.parentProperty) ? spaceConfig.parentProperty : [spaceConfig.parentProperty]) : globalProps.parentPropertyNames,
                    childrenPropertyNames: spaceConfig.childrenProperty ? (Array.isArray(spaceConfig.childrenProperty) ? spaceConfig.childrenProperty : [spaceConfig.childrenProperty]) : globalProps.childrenPropertyNames,
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

        const allFiles = this.app.vault.getAllLoadedFiles();
        
        // Find all hidden .abstract files since they are not in getAllLoadedFiles()
        const foldersToCheck = allFiles.filter((f: any) => f instanceof TFolder).map((f: any) => f.path);
        foldersToCheck.push(""); // Add root vault

        for (const folderPath of foldersToCheck) {
            const libraryPath = folderPath === "" ? ".abstract/library.json" : `${folderPath}/.abstract/library.json`;
            try {
                if (await this.app.vault.adapter.exists(libraryPath)) {
                    const content = await this.app.vault.adapter.read(libraryPath);
                    const config = DataService.parseLibraryConfig(content);
                    configs.push({ path: libraryPath, type: 'library', config });
                }
            } catch {}

            const configPath = folderPath === "" ? ".abstract/config.json" : `${folderPath}/.abstract/config.json`;
            try {
                if (await this.app.vault.adapter.exists(configPath)) {
                    const content = await this.app.vault.adapter.read(configPath);
                    const config = DataService.parseLocalConfig(content);
                    configs.push({ path: configPath, type: 'local', config });
                }
            } catch (e) {
                // Ignore errors inside hidden folders or if parsing fails
            }
        }
        
        return configs;
    }

    clearCache() {
        this.cache.clear();
    }
}
