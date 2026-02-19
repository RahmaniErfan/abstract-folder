import * as git from "isomorphic-git";
import * as path from 'path';
import { NodeFsAdapter } from "./node-fs-adapter";

export interface ConflictInfo {
    path: string;
    currentContent: string;  // Local (Ours)
    incomingContent: string; // Remote (Theirs)
}

/**
 * ConflictManager handles the low-level Git operations for finding
 * and resolving merge conflicts.
 */
export class ConflictManager {
    /**
     * Finds all files that have merge conflicts.
     * Uses the error message from isomorphic-git as the primary source of truth,
     * with a fallback to scanning for conflict markers if needed.
     */
    static async detectConflicts(dir: string, error?: any): Promise<string[]> {
        const conflicts: Set<string> = new Set();
        
        // 1. Try to parse the error message
        // Error format: "Automatic merge failed with one or more merge conflicts in the following files: file1.md, file2.md. Fix conflicts..."
        if (error && error.message) {
            const match = error.message.match(/in the following files: (.*?)\. Fix/);
            if (match && match[1]) {
                const files = match[1].split(',').map((f: string) => f.trim());
                files.forEach((f: string) => conflicts.add(f));
                console.log("[ConflictManager] Detected conflicts from error message:", Array.from(conflicts));
            }
        }

        // 2. If no conflicts found from error, try scanning statusMatrix for modified files
        // and checking for conflict markers.
        if (conflicts.size === 0) {
            try {
                const matrix = await git.statusMatrix({ fs: NodeFsAdapter, dir });
                for (const [filepath, head, workdir, stage] of matrix) {
                    if (filepath === '.') continue;
                    // If workdir is modified (2), check for markers
                    if (workdir === 2) {
                        try {
                            const content = await NodeFsAdapter.promises.readFile(path.join(dir, filepath), 'utf8');
                            if (content.includes('<<<<<<< HEAD') && content.includes('=======')) {
                                conflicts.add(filepath);
                            }
                        } catch (e) {
                            // ignore read errors
                        }
                    }
                }
            } catch (e) {
                console.error("[ConflictManager] Matrix scan failed:", e);
            }
        }

        return Array.from(conflicts);
    }

    /**
     * Automatically resolves conflicts for certain file types (e.g. config files) 
     * based on predefined rules.
     */
    static async autoResolveConflicts(dir: string, conflictPaths: string[]): Promise<string[]> {
        const remainingConflicts: string[] = [];
        const configFiles = new Set(['workspace.json', 'appearance.json', 'hotkeys.json', 'core-plugins.json', 'plugins.json']);

        for (const filepath of conflictPaths) {
            const basename = path.basename(filepath);
            
            // Rule: "My Config Wins" - Keep Local for .obsidian config files
            if (configFiles.has(basename) || filepath.includes('.obsidian/')) {
                console.log(`[ConflictManager] Auto-resolving config file: ${filepath} (Keep Local)`);
                try {
                    const info = await this.getConflictInfo(dir, filepath);
                    if (info) {
                        await this.resolveConflict(dir, filepath, info.currentContent);
                        continue; // Resolved!
                    }
                } catch (e) {
                    console.error(`[ConflictManager] Failed to auto-resolve ${filepath}:`, e);
                }
            }
            remainingConflicts.push(filepath);
        }
        return remainingConflicts;
    }

    /**
     * Retrieves the contents of the "Current" (Local/Ours) and "Incoming" (Remote/Theirs)
     * versions of a conflicted file.
     * 
     * Strategy:
     * 1. Try to parse Git conflict markers (<<<<<<<, =======, >>>>>>>) from the file on disk.
     *    This is the most reliable method as it reflects exactly what's in the workdir.
     * 2. Fallback: Resolve HEAD and remote refs to OIDs and read blobs.
     */
    static async getConflictInfo(dir: string, filepath: string): Promise<ConflictInfo | null> {
        try {
            console.log(`[ConflictManager] Retrieving conflict info for ${filepath}`);
            const absolutePath = path.join(dir, filepath);

            // Strategy 1: Parse markers from disk
            try {
                const content = await NodeFsAdapter.promises.readFile(absolutePath, 'utf8');
                if (content.includes('<<<<<<< HEAD') && content.includes('=======')) {
                    console.log(`[ConflictManager] Found conflict markers in ${filepath}. Parsing...`);
                    const oursMatch = content.match(/<<<<<<< HEAD\n([\s\S]*?)\n=======/);
                    const theirsMatch = content.match(/=======\n([\s\S]*?)\n>>>>>>>/);

                    if (oursMatch && theirsMatch) {
                        return {
                            path: filepath,
                            currentContent: oursMatch[1],
                            incomingContent: theirsMatch[1]
                        };
                    }
                }
            } catch (e) {
                console.warn(`[ConflictManager] Failed to read/parse markers from disk:`, e);
            }

            // Strategy 2: Git Blobs (Fallback)
            console.log(`[ConflictManager] Markers not found or parsing failed. Trying Git blobs...`);
            
            // Resolve HEAD
            let oursContent = "";
            let oursOid = "";
            try {
                oursOid = await git.resolveRef({ fs: NodeFsAdapter, dir, ref: 'HEAD' });
                console.log(`[ConflictManager] Resolved HEAD to ${oursOid}`);
                
                const { blob } = await git.readBlob({
                    fs: NodeFsAdapter,
                    dir,
                    oid: oursOid,
                    filepath
                });
                oursContent = Buffer.from(blob).toString('utf8');
            } catch (e) {
                console.warn(`[ConflictManager] Failed to read HEAD blob for ${filepath}`, e);
            }

            // Resolve Remote
            let theirsContent = "";
            try {
                // Try references in order: FETCH_HEAD, origin/main, origin/master
                const remotes = ['FETCH_HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master'];
                let theirsOid = "";
                
                for (const remote of remotes) {
                    try {
                        theirsOid = await git.resolveRef({ fs: NodeFsAdapter, dir, ref: remote });
                        console.log(`[ConflictManager] Resolved ${remote} to ${theirsOid}`);
                        break;
                    } catch (e) { /* continue */ }
                }

                if (theirsOid) {
                    const { blob } = await git.readBlob({
                        fs: NodeFsAdapter,
                        dir,
                        oid: theirsOid,
                        filepath
                    });
                    theirsContent = Buffer.from(blob).toString('utf8');
                } else {
                    console.warn(`[ConflictManager] Could not resolve any remote refs.`);
                }
            } catch (e) {
                console.warn(`[ConflictManager] Failed to read Remote blob for ${filepath}`, e);
            }

            return {
                path: filepath,
                currentContent: oursContent, // If empty, user will see empty. Better than crashing.
                incomingContent: theirsContent
            };
        } catch (e) {
            console.error(`[ConflictManager] Failed to get conflict info for ${filepath}:`, e);
            return null;
        }
    }

    /**
     * Resolves a conflict by writing the merged content to the working directory,
     * adding it to the index.
     */
    static async resolveConflict(dir: string, filepath: string, mergedContent: string): Promise<void> {
        const absolutePath = path.join(dir, filepath);
        console.log(`[ConflictManager] Resolving conflict for ${filepath}`);
        
        // 1. Write the resolved content to the working directory
        await NodeFsAdapter.promises.writeFile(absolutePath, mergedContent, 'utf8');
        console.log(`[ConflictManager] Verified content written to ${absolutePath}`);
        
        // 2. Add the file to the stage
        await git.add({
            fs: NodeFsAdapter,
            dir,
            filepath
        });
        console.log(`[ConflictManager] Added ${filepath} to index (conflict should be cleared)`);
    }
}
