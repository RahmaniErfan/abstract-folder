import { execFile } from 'child_process';
import { promisify } from 'util';
import { IGitStatusAdapter, GitStatusMatrix } from './types';

const execFileAsync = promisify(execFile);

export class GitDesktopAdapter implements IGitStatusAdapter {
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
