import * as git from 'isomorphic-git';
import { ObsidianHttpAdapter } from './http-adapter';
import { NodeFsAdapter } from './node-fs-adapter';
import { SecureFsAdapter } from './secure-fs-adapter';
import { IGitEngine, GitStatusMatrix, GitAuthor } from './types';
import { getGitWorkerBlobUrl } from './git-worker-bundle';
import { SecurityManager } from '../../core/security-manager';

export class GitMobileAdapter implements IGitEngine {
    private worker: Worker | null = null;

    constructor(private securityManager: SecurityManager) {
        this.initWorker();
    }

    isDesktopNative(): boolean {
        return false;
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

    private getSecureFs(absoluteDir: string) {
        return new SecureFsAdapter(this.securityManager, absoluteDir);
    }

    async init(absoluteDir: string, defaultBranch: string = 'main'): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        await git.init({ fs: secureFs, dir: absoluteDir, defaultBranch });
    }

    async clone(absoluteDir: string, url: string, token?: string): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        await git.clone({
            fs: secureFs,
            http: ObsidianHttpAdapter as any,
            dir: absoluteDir,
            url,
            onAuth: token ? () => ({ username: token }) : undefined,
            singleBranch: true,
            depth: 1
        });
    }

    async add(absoluteDir: string, filepath: string): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        await git.add({ fs: secureFs, dir: absoluteDir, filepath });
    }

    async remove(absoluteDir: string, filepath: string): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        await git.remove({ fs: secureFs, dir: absoluteDir, filepath });
    }

    async commit(absoluteDir: string, message: string, author: GitAuthor, parents?: string[]): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        await git.commit({
            fs: secureFs,
            dir: absoluteDir,
            message,
            author,
            committer: author,
            parent: parents
        });
    }

    async pull(absoluteDir: string, branch: string, author: GitAuthor, token?: string): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        const currentRef = await git.currentBranch({ fs: secureFs, dir: absoluteDir }) || branch;
        await git.pull({
            fs: secureFs,
            http: ObsidianHttpAdapter as any,
            dir: absoluteDir,
            onAuth: token ? () => ({ username: token }) : undefined,
            singleBranch: true,
            ref: currentRef,
            author,
            committer: author
        });
    }

    async push(absoluteDir: string, branch: string, token?: string, force?: boolean): Promise<void> {
        const secureFs = this.getSecureFs(absoluteDir);
        const currentRef = await git.currentBranch({ fs: secureFs, dir: absoluteDir }) || branch;
        await git.push({
            fs: secureFs,
            http: ObsidianHttpAdapter as any,
            dir: absoluteDir,
            onAuth: token ? () => ({ username: token }) : undefined,
            remote: 'origin',
            ref: currentRef,
            force
        });
    }

    async addRemote(absoluteDir: string, remote: string, url: string): Promise<void> {
        await git.addRemote({
            fs: NodeFsAdapter,
            dir: absoluteDir,
            remote,
            url
        });
    }

    async currentBranch(absoluteDir: string): Promise<string | undefined> {
        const secureFs = this.getSecureFs(absoluteDir);
        return await git.currentBranch({ fs: secureFs, dir: absoluteDir }) || undefined;
    }

    async resolveRef(absoluteDir: string, ref: string): Promise<string> {
        const secureFs = this.getSecureFs(absoluteDir);
        return await git.resolveRef({ fs: secureFs, dir: absoluteDir, ref });
    }

    async getConfig(absoluteDir: string, configPath: string): Promise<string | undefined> {
        const val = await git.getConfig({
            fs: NodeFsAdapter,
            dir: absoluteDir,
            path: configPath
        });
        return typeof val === 'string' ? val : undefined;
    }

    async discardChanges(absoluteDir: string, filepaths: string[]): Promise<void> {
        if (filepaths.length === 0) return;
        const secureFs = this.getSecureFs(absoluteDir);
        for (const filepath of filepaths) {
            await git.checkout({
                fs: secureFs,
                dir: absoluteDir,
                force: true,
                filepaths: [filepath]
            });
        }
    }

    async getStatusMatrix(absoluteDir: string, ignoredPaths?: string[]): Promise<GitStatusMatrix> {
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
            this.worker!.postMessage({ action: 'getStatusMatrix', absoluteDir, ignoredPaths, nonce: tempNonce });
        });
    }

    public terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
