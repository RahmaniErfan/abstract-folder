/**
 * @file git-command-runner.ts
 * @description Thin wrapper around child_process.execFile for git CLI operations.
 * Provides error classification, PAT injection, and cross-platform normalization.
 *
 * Reusable by both Engine 1 (private vault) and Engine 2 (public repos).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';
import { NetworkErrorKind, SyncAuthor, MAX_AUTO_COMMIT_FILE_SIZE } from './types';
import { toPosixPath } from './path-utils';

const execFileAsync = promisify(execFile);

// ─── Error Classification ───────────────────────────────────────────

export interface GitCommandResult {
    stdout: string;
    stderr: string;
}

export interface GitCommandError {
    kind: NetworkErrorKind | 'nothing-to-commit' | 'git-error';
    message: string;
    raw?: any;
}

/**
 * Classify a git command error into a known kind.
 * Checks stderr/stdout patterns to determine the root cause.
 */
function classifyError(error: any): GitCommandError {
    const stdout = (error.stdout || '').toString();
    const stderr = (error.stderr || '').toString();
    const combined = stdout + '\n' + stderr;

    // Empty commit — NOT a real error
    if (combined.includes('nothing to commit, working tree clean')) {
        return { kind: 'nothing-to-commit', message: 'Nothing to commit', raw: error };
    }

    // Auth errors
    if (combined.includes('401') || combined.includes('Authentication failed') ||
        combined.includes('Unauthorized') || combined.includes('could not read Username')) {
        return { kind: 'auth-expired', message: 'Authentication failed — PAT may be expired', raw: error };
    }
    if (combined.includes('403') || combined.includes('Forbidden')) {
        return { kind: 'auth-expired', message: 'Access forbidden — check PAT permissions', raw: error };
    }

    // Rate limiting
    if (combined.includes('429') || combined.includes('Too Many Requests') ||
        combined.includes('rate limit')) {
        return { kind: 'rate-limited', message: 'GitHub rate limit exceeded', raw: error };
    }

    // Repo not found
    if (combined.includes('Repository not found') || combined.includes('does not appear to be a git repository')) {
        return { kind: 'repo-not-found', message: 'Repository not found', raw: error };
    }

    // Network/offline errors
    if (combined.includes('Could not resolve host') || combined.includes('unable to access') ||
        combined.includes('Connection refused') || combined.includes('Network is unreachable') ||
        combined.includes('Failed to connect') || combined.includes('Temporary failure in name resolution') ||
        combined.includes('SSL_ERROR') || combined.includes('LibreSSL') ||
        combined.includes('Connection timed out') || combined.includes('Connection reset')) {
        return { kind: 'offline', message: 'Network unreachable', raw: error };
    }

    return { kind: 'unknown', message: error.message || String(error), raw: error };
}

// ─── GitCommandRunner ───────────────────────────────────────────────

export class GitCommandRunner {
    constructor(
        private absoluteDir: string,
        private getToken: () => Promise<string | undefined>,
    ) {}

    // ─── Core Execution ─────────────────────────────────────────

    /**
     * Execute a raw git command. All paths in args are POSIX-normalized.
     * Returns { stdout, stderr } on success.
     * Throws GitCommandError on failure.
     */
    async exec(args: string[], env?: Record<string, string>): Promise<GitCommandResult> {
        try {
            const result = await execFileAsync('git', args, {
                cwd: this.absoluteDir,
                env: env ? { ...process.env, ...env } : undefined,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large status outputs
            });
            return { stdout: result.stdout, stderr: result.stderr };
        } catch (error: any) {
            const classified = classifyError(error);
            throw classified;
        }
    }

    /**
     * Execute a git command with PAT injected into the remote URL.
     * Used for fetch/push operations that require authentication.
     */
    async execWithAuth(args: string[]): Promise<GitCommandResult> {
        const token = await this.getToken();
        const originUrl = await this.getOriginUrl();

        const authArgs: string[] = [];
        if (originUrl && token) {
            const authUrl = this.injectAuthUrl(originUrl, token);
            authArgs.push('-c', `remote.origin.url=${authUrl}`);
        }
        authArgs.push(...args);

        return this.exec(authArgs);
    }

    // ─── PAT Injection ──────────────────────────────────────────

    /**
     * Inject PAT directly into the remote URL.
     * This avoids relying on the host OS credential manager,
     * which fails silently in Electron apps.
     */
    injectAuthUrl(url: string, token: string): string {
        try {
            const parsed = new URL(url);
            parsed.username = token;
            return parsed.toString();
        } catch {
            return url;
        }
    }

    // ─── Git Author Env ─────────────────────────────────────────

    /** Build environment variables for git commit with author info. */
    authorEnv(author: SyncAuthor): Record<string, string> {
        return {
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_COMMITTER_NAME: author.name,
            GIT_COMMITTER_EMAIL: author.email,
        };
    }

    // ─── High-Level Operations ──────────────────────────────────

    /** git add <filepath> — targeting a single file (NEVER git add .) */
    async add(filepath: string): Promise<void> {
        await this.exec(['add', toPosixPath(filepath)]);
    }

    /**
     * git commit with message and author.
     * Returns true if committed, false if nothing to commit.
     */
    async commit(message: string, author: SyncAuthor): Promise<boolean> {
        try {
            await this.exec(['commit', '-m', message], this.authorEnv(author));
            return true;
        } catch (e: any) {
            if (e.kind === 'nothing-to-commit') return false;
            throw e;
        }
    }

    /** git fetch origin <branch> */
    async fetch(branch: string): Promise<void> {
        await this.execWithAuth(['fetch', 'origin', branch]);
    }

    /** git push origin <branch> */
    async push(branch: string, force = false): Promise<void> {
        const args = ['push', 'origin', branch];
        if (force) args.push('--force');
        await this.execWithAuth(args);
    }

    /** git merge origin/<branch> --no-edit */
    async merge(branch: string): Promise<void> {
        await this.exec(['merge', `origin/${branch}`, '--no-edit']);
    }

    /** git merge --abort */
    async mergeAbort(): Promise<void> {
        await this.exec(['merge', '--abort']);
    }

    /**
     * git merge-tree dry run for conflict detection.
     * Returns raw stdout for parsing by ConflictDetector.
     *
     * Uses: git merge-tree $(git merge-base HEAD FETCH_HEAD) HEAD FETCH_HEAD
     */
    async mergeTree(): Promise<string> {
        // First, get the merge base
        let mergeBase: string;
        try {
            const { stdout } = await this.exec(['merge-base', 'HEAD', 'FETCH_HEAD']);
            mergeBase = stdout.trim();
        } catch {
            // No common ancestor — diverged histories
            return '';
        }

        try {
            const { stdout } = await this.exec(['merge-tree', mergeBase, 'HEAD', 'FETCH_HEAD']);
            return stdout;
        } catch (e: any) {
            // merge-tree may exit with code 1 even on clean merges in some git configs
            // Return whatever stdout we can extract from the error
            if (e.raw?.stdout) return e.raw.stdout;
            return '';
        }
    }

    /**
     * Check how many commits local is ahead of remote.
     * Returns 0 if not ahead (Smart Push gate).
     */
    async logAheadCount(branch: string): Promise<number> {
        try {
            const { stdout } = await this.exec(['log', `origin/${branch}..HEAD`, '--oneline']);
            const lines = stdout.trim().split('\n').filter(l => l.length > 0);
            return lines.length;
        } catch {
            // If origin/<branch> doesn't exist yet (first push), we ARE ahead
            return 1;
        }
    }

    /** git rev-parse --abbrev-ref HEAD */
    async currentBranch(): Promise<string> {
        try {
            const { stdout } = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
            return stdout.trim();
        } catch {
            return 'main';
        }
    }

    /** git gc --auto — fire and forget */
    gc(): void {
        // Intentionally not awaited. Runs as detached background process.
        execFileAsync('git', ['gc', '--auto'], { cwd: this.absoluteDir })
            .catch(e => console.warn('[GitCommandRunner] git gc --auto failed (non-fatal):', e));
    }

    // ─── Large File Guard ───────────────────────────────────────

    /**
     * Check if a file exceeds the safe auto-commit threshold (50MB).
     * GitHub rejects pushes with files > 100MB. We gate at 50MB to be safe.
     * Returns the file size in bytes, or -1 if the file doesn't exist.
     */
    async checkFileSize(absoluteFilePath: string): Promise<number> {
        try {
            const stats = await stat(absoluteFilePath);
            return stats.size;
        } catch {
            return -1; // File doesn't exist or can't be stat'd
        }
    }

    /**
     * Returns true if the file is safe to auto-commit (under 50MB).
     * Returns false and logs a warning if the file exceeds the threshold.
     */
    async isFileSafeForAutoCommit(absoluteFilePath: string): Promise<boolean> {
        const size = await this.checkFileSize(absoluteFilePath);
        if (size < 0) return false; // File gone
        if (size > MAX_AUTO_COMMIT_FILE_SIZE) {
            console.warn(
                `[GitCommandRunner] File exceeds ${MAX_AUTO_COMMIT_FILE_SIZE / (1024 * 1024)}MB auto-commit threshold: ` +
                `${absoluteFilePath} (${(size / (1024 * 1024)).toFixed(1)}MB). Skipping auto-commit.`
            );
            return false;
        }
        return true;
    }

    // ─── Helpers ────────────────────────────────────────────────

    /** Check if .git/MERGE_HEAD exists (crash recovery indicator). */
    async hasMergeHead(): Promise<boolean> {
        try {
            await stat(`${this.absoluteDir}/.git/MERGE_HEAD`);
            return true;
        } catch {
            return false;
        }
    }

    /** Get remote.origin.url */
    private async getOriginUrl(): Promise<string | undefined> {
        try {
            const { stdout } = await this.exec(['config', '--get', 'remote.origin.url']);
            return stdout.trim() || undefined;
        } catch {
            return undefined;
        }
    }
}
