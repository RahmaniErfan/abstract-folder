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
     * Internal validator for path safety during writes.
     * Enforces a strict whitelist of allowed file extensions.
     */
    public validatePath(filepath: string): { valid: boolean; reason?: string } {
        const normalized = filepath.replace(/\\/g, '/');
        const basename = path.basename(normalized);
        const ext = path.extname(basename).toLowerCase();
        
        // 1. Strict Whitelist Strategy
        // Only allow specific, safe file types.
        const allowedExtensions = new Set([
            // Text / Data
            '.md', '.txt', '.json', '.csv', '.canvas',
            // Images
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
            // Documents
            '.pdf',
            // Styles (Restricted, but often needed for snippets - keeping strict for now)
            // '.css' // CSS is intentionally excluded from the default whitelist to prevent UI spoofing
        ]);

        // Special case: License files or other common capitalizations
        if (allowedExtensions.has(ext)) {
            // Allowed
        } else if (basename.toLowerCase() === 'license' || basename.toLowerCase() === 'readme') {
            // Allowed no-extension files
        } else {
            return { valid: false, reason: `Security Restriction: File type '${ext}' is not on the allowlist.` };
        }

        // 2. Block .obsidian folder writes at root (Quarantine logic handles this redirection, 
        // but if it slips through to here, we block it to be safe).
        if (normalized.startsWith('.obsidian/') || normalized.includes('/.obsidian/')) {
            // usage of .obsidian is restricted to specific safe config files if we were to allow it,
            // but for now, we rely on the adapter to redirect.
            // If the adapter didn't redirect, we treat it as an unsafe direct write.
             return { valid: false, reason: `Security Restriction: Direct write to .obsidian folder is blocked.` };
        }

        return { valid: true };
    }

    /**
     * Sanitizes Markdown content to neutralize executable code blocks.
     * Renames 'dataviewjs' -> 'text:dataviewjs-sanitized'
     */
    public sanitizeMarkdown(content: string): string {
        let sanitized = content;

        // 1. Neutralize DataviewJS
        sanitized = sanitized.replace(
            /(```\s*)dataviewjs(\s*\n)/gi, 
            '$1text:dataviewjs-sanitized$2'
        );

        // 2. Neutralize Templater
        sanitized = sanitized.replace(
            /(<%[\s\S]*?%>)/g, 
            (match) => match.replace(/<%/g, '<%_SAFE_').replace(/%>/g, '_SAFE_%>')
        );
        sanitized = sanitized.replace(
            /(```\s*)templater(\s*\n)/gi, 
            '$1text:templater-sanitized$2'
        );

        // 3. Neutralize CustomJS
        sanitized = sanitized.replace(
            /(```\s*)customjs(\s*\n)/gi, 
            '$1text:customjs-sanitized$2'
        );

        // 4. Neutralize HTML scripts (basic check)
        sanitized = sanitized.replace(
            /<script\b[^>]*>([\s\S]*?)<\/script>/gmi,
            '<!-- SANITIZED SCRIPT: $1 -->'
        );

        return sanitized;
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
