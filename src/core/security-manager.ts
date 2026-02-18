import { AbstractFolderPluginSettings } from "../settings";
import * as path from 'path';

/**
 * SecurityManager unifies file exclusion and validation logic
 * for both Managed Libraries and Personal Backups/Shared Vaults.
 */
export class SecurityManager {
    constructor(private settings: AbstractFolderPluginSettings) {}

    /**
     * Checks if a path should be excluded from sync based on settings
     * and hardcoded safety rules.
     */
    public isPathExcluded(filepath: string): boolean {
        const exclusions = this.settings.librarySettings.securityExclusions || [];
        const normalizedPath = filepath.replace(/\\/g, '/');

        // 1. Check against configurable exclusions
        for (const pattern of exclusions) {
            if (this.matchPattern(normalizedPath, pattern)) {
                return true;
            }
        }

        // 2. Hardcoded safety: Always exclude the Abstract Library folder from Personal Backup
        // to avoid recursive git issues.
        const librariesPath = this.settings.librarySettings.librariesPath || "Abstract Library";
        if (normalizedPath === librariesPath || normalizedPath.startsWith(librariesPath + '/')) {
            return true;
        }

        return false;
    }

    /**
     * Minimal glob-like pattern matching.
     * Supports:
     * - "folder/" (matches directory and all contents)
     * - "*.ext" (matches file extension)
     * - "exact-file.txt" (matches exact path)
     */
    private matchPattern(filepath: string, pattern: string): boolean {
        if (pattern.endsWith('/')) {
            const dirPattern = pattern.slice(0, -1);
            return filepath === dirPattern || filepath.startsWith(pattern);
        }

        if (pattern.startsWith('*.')) {
            const ext = pattern.slice(1);
            return filepath.endsWith(ext);
        }

        return filepath === pattern;
    }

    /**
     * Validates a file for sync (e.g., size checks).
     */
    public validateFile(filepath: string, sizeInBytes: number): { valid: boolean; reason?: string } {
        const thresholdMB = 10;
        const thresholdBytes = thresholdMB * 1024 * 1024;

        if (sizeInBytes > thresholdBytes) {
            return { 
                valid: false, 
                reason: `File too large (${(sizeInBytes / (1024 * 1024)).toFixed(2)}MB > ${thresholdMB}MB)` 
            };
        }

        return { valid: true };
    }

    /**
     * Generates content for a .gitignore file based on current security settings.
     */
    public generateGitIgnoreContent(): string {
        const exclusions = this.settings.librarySettings.securityExclusions || [];
        const librariesPath = this.settings.librarySettings.librariesPath || "Abstract Library";
        
        const allPatterns = new Set(exclusions);
        allPatterns.add(librariesPath + '/');
        
        return Array.from(allPatterns).join('\n');
    }
}
