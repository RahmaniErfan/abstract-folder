export type GitStatusMatrix = Map<string, 'synced' | 'modified' | 'conflict' | 'untracked'>;

export interface IGitStatusAdapter {
    /**
     * Retrieves the status matrix for the repository.
     */
    getStatusMatrix(absoluteDir: string): Promise<GitStatusMatrix>;
}
