import { App, TFile } from "obsidian";
import { FolderNode, SortBy } from "../types";
import { AbstractFolderPluginSettings } from "../settings";
import { MetricsManager } from "../metrics-manager";

/**
 * Retrieves the timestamp for a file, prioritizing custom frontmatter properties
 * if configured in settings. Falls back to system ctime/mtime.
 */
export function getFileTime(app: App, settings: AbstractFolderPluginSettings, file: TFile, type: 'ctime' | 'mtime'): number {
    const customPropsStr = type === 'ctime' 
      ? settings.customCreatedDateProperties 
      : settings.customModifiedDateProperties;
    
    if (customPropsStr) {
      const customProps = customPropsStr.split(',').map(p => p.trim()).filter(Boolean);
      const cache = app.metadataCache.getFileCache(file);
      if (cache?.frontmatter) {
        for (const prop of customProps) {
          const value = cache.frontmatter[prop] as unknown;
          if (value) {
            if (value instanceof Date) {
              return value.getTime();
            }
            if (typeof value === 'number') {
              return value;
            }
            if (typeof value === 'string') {
              const parsed = Date.parse(value);
              if (!isNaN(parsed)) {
                return parsed;
              }
            }
          }
        }
      }
    }

    return type === 'ctime' ? file.stat.ctime : file.stat.mtime;
}

/**
 * Creates a sort comparator function for FolderNodes based on current view state and metrics.
 */
export function createSortComparator(
    app: App,
    settings: AbstractFolderPluginSettings,
    sortBy: SortBy,
    sortOrder: 'asc' | 'desc',
    metricsManager: MetricsManager
): (a: FolderNode, b: FolderNode) => number {
    return (a: FolderNode, b: FolderNode): number => {
        let compareResult: number;
        
        if (sortBy === 'name') {
            compareResult = a.path.localeCompare(b.path);
        } else if (sortBy === 'mtime' || sortBy === 'ctime') {
            const fileA = a.file ? app.vault.getAbstractFileByPath(a.path) : null;
            const fileB = b.file ? app.vault.getAbstractFileByPath(b.path) : null;
            
            const timeA = (fileA instanceof TFile) ? getFileTime(app, settings, fileA, sortBy) : 0;
            const timeB = (fileB instanceof TFile) ? getFileTime(app, settings, fileB, sortBy) : 0;
            
            compareResult = timeA - timeB;
        } else if (sortBy === 'thermal') {
            compareResult = metricsManager.getMetrics(a.path).thermal - metricsManager.getMetrics(b.path).thermal;
        } else if (sortBy === 'rot') {
            compareResult = metricsManager.getMetrics(a.path).rot - metricsManager.getMetrics(b.path).rot;
        } else if (sortBy === 'gravity') {
            compareResult = metricsManager.getMetrics(a.path).gravity - metricsManager.getMetrics(b.path).gravity;
        } else {
            compareResult = a.path.localeCompare(b.path);
        }

        return sortOrder === 'asc' ? compareResult : -compareResult;
    };
}
