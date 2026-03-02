/**
 * @file path-utils.ts
 * @description POSIX path normalization for cross-platform compatibility.
 *
 * Windows resolves paths with backslashes (C:\Vault\Note.md), while Git's
 * stdout uses forward slashes (C:/Vault/Note.md). If the debounceMap keys
 * use Windows paths but GitCommandRunner output uses POSIX paths, the state
 * machine loses track of which files are locked, conflicted, or debouncing.
 *
 * ALL file paths entering the sync engine are normalized to POSIX format
 * at the SyncOrchestrator boundary before hitting the debounce Map or Git binary.
 */

/**
 * Normalize a file path to POSIX format (forward slashes).
 * Safe to call on already-POSIX paths.
 */
export function toPosixPath(filepath: string): string {
    return filepath.replace(/\\/g, '/');
}

/**
 * Normalize an absolute directory path to POSIX format,
 * ensuring no trailing slash.
 */
export function toPosixDir(dirPath: string): string {
    return toPosixPath(dirPath).replace(/\/+$/, '');
}
