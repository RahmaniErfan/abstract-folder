export type GitStatusMatrix = Map<string, 'synced' | 'modified' | 'conflict' | 'untracked'>;

export interface IGitStatusAdapter {
    /**
     * Retrieves the status matrix for the repository.
     */
    getStatusMatrix(absoluteDir: string, ignoredPaths?: string[]): Promise<GitStatusMatrix>;
}

export interface GitAuthor {
    name: string;
    email: string;
}

export interface IGitEngine extends IGitStatusAdapter {
    /** Whether this engine uses native system git process */
    isDesktopNative(): boolean;
    init(absoluteDir: string, defaultBranch?: string): Promise<void>;
    clone(absoluteDir: string, url: string, token?: string): Promise<void>;
    add(absoluteDir: string, filepath: string): Promise<void>;
    remove(absoluteDir: string, filepath: string): Promise<void>;
    commit(absoluteDir: string, message: string, author: GitAuthor, parents?: string[]): Promise<void>;
    pull(absoluteDir: string, branch: string, author: GitAuthor, token?: string): Promise<void>;
    push(absoluteDir: string, branch: string, token?: string, force?: boolean): Promise<void>;
    addRemote(absoluteDir: string, remote: string, url: string): Promise<void>;
    currentBranch(absoluteDir: string): Promise<string | undefined>;
    resolveRef(absoluteDir: string, ref: string): Promise<string>;
    getConfig(absoluteDir: string, path: string): Promise<string | undefined>;
    discardChanges(absoluteDir: string, filepaths: string[]): Promise<void>;
}
