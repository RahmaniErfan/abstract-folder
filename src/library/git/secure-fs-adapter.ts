import * as fs from 'fs';
import * as path from 'path';
import { SecurityManager } from '../../core/security-manager';

/**
 * SecureFsAdapter wraps the standard Node FS adapter to enforce security policies
 * during Git operations (pull/checkout).
 * 
 * It intercepts write operations to:
 * 1. Enforce Whitelist (Block forbidden extensions)
 * 2. Sanitize Markdown files (Neutralize scripts)
 * 3. Quarantine .obsidian configuration folders
 */
export class SecureFsAdapter {
    private securityManager: SecurityManager;
    private vaultRoot: string;

    constructor(securityManager: SecurityManager, vaultRoot: string) {
        this.securityManager = securityManager;
        this.vaultRoot = vaultRoot;
    }

    // We implement the subset of the FS interface required by isomorphic-git
    // and strictly intercept the write methods.
    
    public promises = {
        ...fs.promises,
        
        writeFile: async (file: fs.PathLike | fs.FileHandle, data: any, options?: any): Promise<void> => {
            const filepath = file.toString();
            
            // 1. Get relative path to check against security rules
            // isomorphic-git often passes absolute paths
            let relativePath = filepath;
            if (filepath.startsWith(this.vaultRoot)) {
                relativePath = path.relative(this.vaultRoot, filepath);
            }

            // 2. Quarantine Check: Redirect .obsidian writes
            // We do NOT want shared vaults to overwrite the user's root configuration.
            if (relativePath.includes('.obsidian') || relativePath.includes('/.obsidian/')) {
                const quarantineBase = path.join(this.vaultRoot, '_conflicts', 'remote_settings');
                
                // Reconstruct the path inside isolation folder
                // e.g. "Space/.obsidian/plugins/foo/main.js" -> "_conflicts/remote_settings/Space/.obsidian/plugins/foo/main.js"
                const isolatedPath = path.join(quarantineBase, relativePath);
                
                // Ensure directory exists
                await fs.promises.mkdir(path.dirname(isolatedPath), { recursive: true });
                
                // We write the raw data to quarantine. Users must manually move it if they trust it.
                return fs.promises.writeFile(isolatedPath, data, options);
            }

            // 2.5 Allow Internal Git Files
            // We must allow writing to .git or we cannot push/pull!
            if (relativePath.includes('.git/') || relativePath.endsWith('.git')) {
                // Git files are safe to write as they are managed by the plugin
                return fs.promises.writeFile(file, data, options);
            }

            // 3. Security Validation (Extension Whitelist)
            const validation = this.securityManager.validatePath(relativePath);
            if (!validation.valid) {
                console.warn(`[SecureFsAdapter] Blocked write to ${relativePath}: ${validation.reason}`);
                // We skip writing to the file. This effectively "filters" the repo content locally.
                // Git status will report these as "deleted" or "missing" - this is expected behavior for a secure view.
                return Promise.resolve(); 
            }

            // 4. Content Sanitization (Markdown)
            if (relativePath.endsWith('.md')) {
                let contentStr = '';
                if (typeof data === 'string') contentStr = data;
                else if (Buffer.isBuffer(data)) contentStr = data.toString('utf8');
                else contentStr = String(data);

                const sanitized = this.securityManager.sanitizeMarkdown(contentStr);
                
                // If content changed, log it
                if (contentStr !== sanitized) {
                    console.log(`[SecureFsAdapter] Sanitized content for ${relativePath}`);
                }

                return fs.promises.writeFile(filepath, sanitized, options);
            }

            // Default: Passthrough for safe, allowed files
            return fs.promises.writeFile(filepath, data, options);
        }
    };

    // Forward synchronous methods if needed (isomorphic-git mostly uses promises)
    public readFileSync = fs.readFileSync;
    public writeFileSync = (file: fs.PathLike | number, data: any, options?: any) => {
        // We throw here because we want to force async usage or at least be aware if sync is used.
        throw new Error("[SecureFsAdapter] Synchronous writeFileSync is not supported by the security layer.");
    };
    public existsSync = fs.existsSync;
    public lstatSync = fs.lstatSync;
    public mkdirSync = fs.mkdirSync;
    public rmdirSync = fs.rmdirSync;
    public unlinkSync = fs.unlinkSync;
    public statSync = fs.statSync;
    public readdirSync = fs.readdirSync;
}
