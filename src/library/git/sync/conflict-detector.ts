/**
 * @file conflict-detector.ts
 * @description Component 3: Conflict Detection (The Traffic Cop)
 *
 * Stateless utility class that performs a dry-run merge-tree analysis
 * after git fetch to determine if conflicts exist before actually merging.
 *
 * Key invariants:
 * - Uses `git merge-tree` output, NOT `git pull`
 * - Relies on presence of `<<<<<<<` markers, NOT exit code (ghost conflicts)
 * - Detects binary file clashes via file extension heuristic
 * - Detects rename/modify and delete/modify conflicts via git output strings
 */

import { ConflictDetectionResult, ConflictFile } from './types';
import { GitCommandRunner } from './git-command-runner';

/** Extensions treated as binary. Adapt as needed. */
const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'mp3', 'mp4', 'wav', 'ogg', 'webm', 'avi', 'mov',
    'zip', 'tar', 'gz', 'rar', '7z',
    'ttf', 'otf', 'woff', 'woff2',
    'exe', 'dll', 'so', 'dylib',
]);

export class ConflictDetector {
    constructor(private runner: GitCommandRunner) {}

    /**
     * Perform a dry-run conflict check after fetch.
     * Does NOT modify the working tree — purely inspects merge-tree output.
     */
    async detect(): Promise<ConflictDetectionResult> {
        // 1. Check if FETCH_HEAD even exists (maybe fetch had nothing)
        let fetchHeadExists = false;
        try {
            await this.runner.exec(['rev-parse', 'FETCH_HEAD']);
            fetchHeadExists = true;
        } catch {
            // No FETCH_HEAD — nothing was fetched, or remote is empty
            return { hasConflicts: false, files: [], canFastForward: true };
        }

        // 2. Check if HEAD and FETCH_HEAD have diverged
        try {
            const { stdout: mergeBaseOut } = await this.runner.exec(['merge-base', 'HEAD', 'FETCH_HEAD']);
            const mergeBase = mergeBaseOut.trim();

            const { stdout: headOut } = await this.runner.exec(['rev-parse', 'HEAD']);
            const headOid = headOut.trim();

            const { stdout: fetchOut } = await this.runner.exec(['rev-parse', 'FETCH_HEAD']);
            const fetchOid = fetchOut.trim();

            // If FETCH_HEAD equals HEAD, nothing to merge
            if (fetchOid === headOid) {
                return { hasConflicts: false, files: [], canFastForward: true };
            }

            // If merge-base equals FETCH_HEAD, we're ahead — nothing to pull
            if (mergeBase === fetchOid) {
                return { hasConflicts: false, files: [], canFastForward: true };
            }

            // If merge-base equals HEAD, remote is ahead — can fast-forward
            if (mergeBase === headOid) {
                return { hasConflicts: false, files: [], canFastForward: false };
            }

            // Both sides have diverged — run merge-tree to check for conflicts
            const mergeTreeOutput = await this.runner.mergeTree();
            return this.parseMergeTreeOutput(mergeTreeOutput);
        } catch (e: any) {
            // If merge-base fails (no common ancestor), treat as conflict
            console.warn('[ConflictDetector] merge-base failed:', e);
            return { hasConflicts: false, files: [], canFastForward: false };
        }
    }

    /**
     * Parse merge-tree stdout for conflict markers and file paths.
     *
     * IMPORTANT: We rely on the PRESENCE of `<<<<<<<` markers in the blob
     * output, NOT on the exit code. `merge-tree` may exit code 1 due to
     * Git configuration quirks even on clean merges ("ghost conflicts").
     */
    private parseMergeTreeOutput(output: string): ConflictDetectionResult {
        if (!output || output.trim().length === 0) {
            return { hasConflicts: false, files: [], canFastForward: false };
        }

        const conflicts: ConflictFile[] = [];
        const lines = output.split('\n');

        // Look for conflict markers in the output
        const hasMarkers = output.includes('<<<<<<<');

        if (!hasMarkers) {
            // No conflict markers — clean merge possible
            return { hasConflicts: false, files: [], canFastForward: false };
        }

        // Extract conflicted file paths from merge-tree output
        // merge-tree outputs sections like:
        //   changed in both
        //     base   100644 <oid> <path>
        //     our    100644 <oid> <path>
        //     their  100644 <oid> <path>
        // And for conflicts, the blob content will contain <<<<<<< markers

        const pathsWithConflicts = new Set<string>();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Parse "changed in both" sections
            if (line.includes('changed in both') || line.includes('added in both')) {
                // The next few lines contain file info — look for the path
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    const match = lines[j].match(/(?:base|our|their)\s+\d+\s+\w+\s+(.+)/);
                    if (match && match[1]) {
                        pathsWithConflicts.add(match[1].trim());
                    }
                }
            }

            // Detect rename/delete conflicts
            if (line.includes('deleted by us') || line.includes('deleted by them')) {
                const match = line.match(/:\s*(.+)/);
                if (match && match[1]) {
                    conflicts.push({
                        path: match[1].trim(),
                        type: 'delete-modify',
                    });
                }
            }

            // Detect rename conflicts
            if (line.includes('renamed') && (line.includes('conflict') || line.includes('both'))) {
                const match = line.match(/:\s*(.+)/);
                if (match && match[1]) {
                    conflicts.push({
                        path: match[1].trim(),
                        type: 'rename-modify',
                    });
                }
            }
        }

        // Classify the "changed in both" paths
        for (const filePath of pathsWithConflicts) {
            const ext = filePath.split('.').pop()?.toLowerCase() || '';
            conflicts.push({
                path: filePath,
                type: BINARY_EXTENSIONS.has(ext) ? 'binary' : 'text',
            });
        }

        return {
            hasConflicts: conflicts.length > 0,
            files: conflicts,
            canFastForward: false,
        };
    }
}
