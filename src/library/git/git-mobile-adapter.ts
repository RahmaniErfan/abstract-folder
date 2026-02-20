import { IGitStatusAdapter, GitStatusMatrix } from './types';
import { getGitWorkerBlobUrl } from './git-worker-bundle';

export class GitMobileAdapter implements IGitStatusAdapter {
    private worker: Worker | null = null;

    constructor() {
        this.initWorker();
    }

    private initWorker() {
        try {
            const blobUrl = getGitWorkerBlobUrl();
            if (blobUrl) {
                this.worker = new Worker(blobUrl);
            }
        } catch (e) {
            console.error('[GitMobileAdapter] Failed to initialize worker', e);
        }
    }

    async getStatusMatrix(absoluteDir: string): Promise<GitStatusMatrix> {
        if (!this.worker) {
            console.warn('[GitMobileAdapter] Worker not running, returning empty status map.');
            return new Map();
        }

        return new Promise((resolve, reject) => {
            const tempNonce = Date.now().toString() + Math.random().toString();
            
            const listener = (e: MessageEvent) => {
                const currentWorker = this.worker;
                if (!currentWorker || e.data.nonce !== tempNonce) return;

                if (e.data.type === 'statusMatrixResult') {
                    currentWorker.removeEventListener('message', listener);
                    resolve(new Map(Object.entries(e.data.statusMapData))); 
                } else if (e.data.type === 'statusMatrixError') {
                    currentWorker.removeEventListener('message', listener);
                    reject(new Error(e.data.error));
                }
            };

            this.worker!.addEventListener('message', listener);
            this.worker!.postMessage({ action: 'getStatusMatrix', absoluteDir, nonce: tempNonce });
        });
    }

    public terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
