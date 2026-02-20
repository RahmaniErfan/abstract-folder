import { execFile } from 'child_process';
import { promisify } from 'util';
import { IGitEngine, GitStatusMatrix, GitAuthor } from './types';

const execFileAsync = promisify(execFile);

export class GitDesktopAdapter implements IGitEngine {
    isDesktopNative(): boolean {
        return true;
    }

    private injectAuthUrl(url: string, token?: string): string {
        if (!token) return url;
        try {
            const parsedUrl = new URL(url);
            parsedUrl.username = token;
            return parsedUrl.toString();
        } catch (e) {
            // fallback if it's not a standard URL
            return url;
        }
    }

    async init(absoluteDir: string, defaultBranch: string = 'main'): Promise<void> {
        await execFileAsync('git', ['init', '-b', defaultBranch], { cwd: absoluteDir });
    }

    async clone(absoluteDir: string, url: string, token?: string): Promise<void> {
        const authUrl = this.injectAuthUrl(url, token);
        await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', authUrl, '.'], { cwd: absoluteDir });
    }

    async add(absoluteDir: string, filepath: string): Promise<void> {
        await execFileAsync('git', ['add', filepath], { cwd: absoluteDir });
    }

    async remove(absoluteDir: string, filepath: string): Promise<void> {
        try {
            await execFileAsync('git', ['rm', '--cached', '--ignore-unmatch', filepath], { cwd: absoluteDir });
        } catch (e: any) {
            // ignore if not tracked
        }
    }

    async commit(absoluteDir: string, message: string, author: GitAuthor, parents?: string[]): Promise<void> {
        const env = {
            ...process.env,
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_COMMITTER_NAME: author.name,
            GIT_COMMITTER_EMAIL: author.email
        };
        try {
            await execFileAsync('git', ['commit', '-m', message], { cwd: absoluteDir, env });
        } catch (e: any) {
             const output = (e.stdout || '') + '\n' + (e.stderr || '');
             if (output.includes('nothing to commit')) {
                  const error: any = new Error("NothingToCommitError");
                  error.code = 'NothingToCommitError';
                  throw error;
             }
             if (output.includes('Error building trees') && output.includes('You have both')) {
                 // Native git tree conflict because isomorphic-git previously indexed files inside a submodule.
                 // Extract all conflicting directories.
                 const dirsToFix = new Set<string>();
                 const lines = output.split('\n');
                 for (const line of lines) {
                     const m = /You have both (.+?) and \1\//.exec(line);
                     if (m && m[1]) {
                         dirsToFix.add(m[1].trim());
                     }
                 }
                 if (dirsToFix.size > 0) {
                     console.warn('[GitDesktopAdapter] Detected nested submodule index conflict. Attempting auto-resolution strategy:', Array.from(dirsToFix));
                     for (const dir of dirsToFix) {
                         try {
                              // Unstage the contents inside the submodule directory that isomorphic-git erroneously added
                              await execFileAsync('git', ['rm', '--cached', '-r', '-f', dir], { cwd: absoluteDir });
                              // Add the directory as a standard submodule gitlink
                              await execFileAsync('git', ['add', dir], { cwd: absoluteDir });
                         } catch (fixErr) {
                              console.warn(`[GitDesktopAdapter] Failed to automatically resolve tree boundary for ${dir}`, fixErr);
                         }
                     }
                     // Retry commit after resolving the tree boundary
                     return this.commit(absoluteDir, message, author, parents);
                 }
             }
             throw e;
        }
    }

    async pull(absoluteDir: string, branch: string, author: GitAuthor, token?: string): Promise<void> {
        const env = {
            ...process.env,
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_COMMITTER_NAME: author.name,
            GIT_COMMITTER_EMAIL: author.email
        };
        try {
            const originUrl = await this.getConfig(absoluteDir, 'remote.origin.url');
            const args = [];
            if (originUrl && token) {
                 const authUrl = this.injectAuthUrl(originUrl, token);
                 args.push('-c', `remote.origin.url=${authUrl}`);
            }
            args.push('pull', originUrl ? 'origin' : 'origin', branch, '--no-edit'); // always using origin

            await execFileAsync('git', args, { cwd: absoluteDir, env });
        } catch (e: any) {
            if (e.stdout?.includes('CONFLICT') || e.stderr?.includes('CONFLICT') || e.stdout?.includes('Automatic merge failed')) {
                const error: any = new Error("MergeConflictError");
                error.code = 'MergeConflictError';
                throw error;
            }
            throw e;
        }
    }

    async push(absoluteDir: string, branch: string, token?: string, force?: boolean): Promise<void> {
        const originUrl = await this.getConfig(absoluteDir, 'remote.origin.url');
        const args = [];
        if (originUrl && token) {
             const authUrl = this.injectAuthUrl(originUrl, token);
             args.push('-c', `remote.origin.url=${authUrl}`);
        }
        
        args.push('push', 'origin', branch);
        if (force) args.push('--force');
        await execFileAsync('git', args, { cwd: absoluteDir });
    }

    async addRemote(absoluteDir: string, remote: string, url: string): Promise<void> {
        try {
             await execFileAsync('git', ['remote', 'add', remote, url], { cwd: absoluteDir });
        } catch (e: any) {
             if (e.message && e.message.includes('already exists')) {
                  await execFileAsync('git', ['remote', 'set-url', remote, url], { cwd: absoluteDir });
             } else {
                  throw e;
             }
        }
    }

    async currentBranch(absoluteDir: string): Promise<string | undefined> {
        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: absoluteDir });
            return stdout.trim();
        } catch (e) {
            return undefined;
        }
    }

    async resolveRef(absoluteDir: string, ref: string): Promise<string> {
        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd: absoluteDir });
            return stdout.trim();
        } catch (e) {
            const error: any = new Error(`NotFoundError: could not find ${ref}`);
            error.code = 'NotFoundError';
            throw error;
        }
    }

    async getConfig(absoluteDir: string, configPath: string): Promise<string | undefined> {
        try {
            const { stdout } = await execFileAsync('git', ['config', '--get', configPath], { cwd: absoluteDir });
            return stdout.trim() || undefined;
        } catch (e) {
            return undefined;
        }
    }

    async getStatusMatrix(absoluteDir: string, ignoredPaths?: string[]): Promise<GitStatusMatrix> {
        // Native Git handles sub-repo boundaries automatically via .git folder detection.
        const statusMap = new Map<string, 'synced' | 'modified' | 'conflict' | 'untracked'>();
        try {
            // First, get all tracked files and mark them as synced
            // -c core.quotePath=false ensures paths with spaces aren't quoted/escaped
            try {
                const { stdout: lsFilesOut } = await execFileAsync('git', ['-c', 'core.quotePath=false', 'ls-files'], { cwd: absoluteDir });
                const trackedFiles = lsFilesOut.split('\n');
                for (const f of trackedFiles) {
                    const trimmed = f.trim();
                    if (trimmed) {
                        statusMap.set(trimmed, 'synced');
                    }
                }
            } catch (err: any) {
                // If not a git repo, it naturally fails here and we can return the empty map
                if (err.code === 128 || (err.message && err.message.includes('not a git repository'))) {
                    return statusMap;
                }
                throw err;
            }

            // --porcelain outputs a stable, parseable format for changes
            const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain'], { cwd: absoluteDir });
            
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (!line) continue;
                const status = line.substring(0, 2);
                let filepath = line.substring(3).trim();

                // Even with core.quotePath=false, some edge cases or older git versions might quote.
                // We strip leading/trailing quotes just in case.
                if (filepath.startsWith('"') && filepath.endsWith('"')) {
                    filepath = filepath.substring(1, filepath.length - 1);
                }

                if (status === '??') {
                    statusMap.set(filepath, 'untracked');
                } else if (status === 'UU') {
                    statusMap.set(filepath, 'conflict');
                } else {
                    // M, A, D, R, C combinations overwrite "synced"
                    statusMap.set(filepath, 'modified'); 
                }
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error('GIT_NOT_FOUND'); // Signal to fallback
            }
            console.error('[GitDesktopAdapter] Failed to get native git status', error);
        }
        return statusMap;
    }
}
