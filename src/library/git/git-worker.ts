import * as git from 'isomorphic-git';
// NodeFsAdapter might not work well in a worker if Node APIs are missing, 
// but in Electron it might. We'll use NodeFsAdapter to match current behaviour.
import { NodeFsAdapter } from './node-fs-adapter';

// Transform isomorphic-git's matrix to the GitStatusMatrix format
function processMatrix(matrix: any[]): Record<string, 'synced' | 'modified' | 'conflict' | 'untracked'> {
    const statusMapData: Record<string, 'synced' | 'modified' | 'conflict' | 'untracked'> = {};
    for (const row of matrix) {
        const [filepath, head, workdir, stage] = row;
        if (filepath === '.') continue;

        if (head === 0 && workdir === 2) {
            statusMapData[filepath] = 'untracked';
        } else if (workdir === 2 && head === 1) {
            statusMapData[filepath] = 'modified';
        } else if (head === 1 && workdir === 1 && stage === 1) {
            statusMapData[filepath] = 'synced';
        } else if (stage > 1) {
            // Rough approximation for conflict
            statusMapData[filepath] = 'conflict';
        } else {
             // Fallback for unmodified/staged
             if (head === 1 && workdir === 2 && stage === 2) {
                 statusMapData[filepath] = 'modified'; // Staged modified
             }
        }
    }
    return statusMapData;
}

self.onmessage = async (e: MessageEvent) => {
    const { action, absoluteDir, nonce } = e.data;
    
    if (action === 'getStatusMatrix') {
        const { absoluteDir, ignoredPaths, nonce } = e.data;
        try {
            /* eslint-disable @typescript-eslint/no-unsafe-assignment */
            const matrix = await git.statusMatrix({
                fs: NodeFsAdapter,
                dir: absoluteDir,
                filter: (filepath) => {
                    if (!ignoredPaths || ignoredPaths.length === 0) return true;
                    // Optimization: High-performance filter to actively block JS crawler from entering sub-repositories
                    return !ignoredPaths.some((ignored: string) => {
                        return filepath === ignored || filepath.startsWith(ignored + '/');
                    });
                }
            });
            /* eslint-enable @typescript-eslint/no-unsafe-assignment */
            
            const statusMapData = processMatrix(matrix);
            
            self.postMessage({ 
                type: 'statusMatrixResult', 
                nonce, 
                statusMapData 
            });
        } catch (error: any) {
            self.postMessage({ 
                type: 'statusMatrixError', 
                nonce, 
                error: error.message || String(error)
            });
        }
    }
};
