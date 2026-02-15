/**
 * The ScopeProjector provides an O(1) decision engine for visual hierarchy highlighting.
 * It translates raw user selections into an optimized prefix cache.
 */
export class ScopeProjector {
    private _activePrefixes: string[] = [];

    /**
     * Updates the prefix cache based on the currently selected URIs.
     * Implements "Redundancy Collapsing" to ensure O(S) lookup where S is unique roots.
     * 
     * @param selectedURIs Set of synthetic URIs (e.g. view://Root/Folder/)
     */
    update(selectedURIs: Set<string>): void {
        if (selectedURIs.size === 0) {
            this._activePrefixes = [];
            return;
        }

        // 1. Normalize: Ensure all URIs end with a slash to prevent partial matches
        const normalized = Array.from(selectedURIs).map(uri => 
            uri.endsWith('/') ? uri : `${uri}/`
        );

        // 2. Sort by length (Shortest -> Longest)
        // This allows us to find root parents first.
        normalized.sort((a, b) => a.length - b.length);

        // 3. Redundancy Collapsing
        // If we have "Folder A/" and "Folder A/Subfolder B/", we only need "Folder A/".
        const optimized: string[] = [];
        for (const uri of normalized) {
            const isRedundant = optimized.some(prefix => uri.startsWith(prefix));
            if (!isRedundant) {
                optimized.push(uri);
            }
        }

        this._activePrefixes = optimized;
    }

    /**
     * Blazing fast check to see if a node is a descendant of a selected scope.
     * This is called in the hot render loop of the VirtualViewport.
     * 
     * @param nodeUri The synthetic URI of the node to check
     */
    isDescendant(nodeUri: string): boolean {
        if (this._activePrefixes.length === 0) return false;

        // Optimized check: return true if nodeUri starts with any active prefix
        // but is not the prefix itself (descendants only).
        return this._activePrefixes.some(prefix => 
            nodeUri.startsWith(prefix) && nodeUri !== prefix
        );
    }

    /**
     * Returns the current optimized prefixes (for debugging)
     */
    getActivePrefixes(): string[] {
        return [...this._activePrefixes];
    }
}
