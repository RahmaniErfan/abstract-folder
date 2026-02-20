import { execFile } from 'child_process';
import { promisify } from 'util';
import { IGitStatusAdapter, GitStatusMatrix } from './types';

const execFileAsync = promisify(execFile);

export class GitDesktopAdapter implements IGitStatusAdapter {
    async getStatusMatrix(absoluteDir: string): Promise<GitStatusMatrix> {
        const statusMap = new Map<string, 'synced' | 'modified' | 'conflict' | 'untracked'>();
        try {
            // --porcelain outputs a stable, parseable format
            const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: absoluteDir });
            
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (!line) continue;
                const status = line.substring(0, 2);
                const filepath = line.substring(3).trim();

                if (status === '??') {
                    statusMap.set(filepath, 'untracked');
                } else if (status === 'UU') {
                    statusMap.set(filepath, 'conflict');
                } else {
                    // M, A, D, R, C combinations
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
