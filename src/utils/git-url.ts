/**
 * Normalizes a GitHub repository reference (slug or URL) into a standard https URL.
 * Supports:
 * - Slugs: "owner/repo"
 * - Full URLs: "https://github.com/owner/repo"
 * - SSH URLs: "git@github.com:owner/repo.git"
 */
export function normalizeRepoUrl(repo: string): string {
    if (!repo) return "";
    let clean = repo.trim().replace(/\.git$/, "");
    
    // Handle SSH format
    if (clean.includes("git@github.com:")) {
        clean = clean.replace("git@github.com:", "https://github.com/");
    }
    
    // Handle Slugs (no protocol and no github.com)
    if (!clean.startsWith("http") && !clean.includes("github.com")) {
        // Simple slug check (ensure it has at least one slash)
        if (clean.includes("/")) {
            return `https://github.com/${clean}`;
        }
    }
    
    return clean;
}

/**
 * Converts a GitHub repository reference to a raw.githubusercontent.com URL for a specific file.
 */
export function getRawContentUrl(repo: string, branch: string, filePath: string): string {
    const baseUrl = normalizeRepoUrl(repo);
    if (!baseUrl.includes("github.com")) return "";
    
    const rawUrl = baseUrl.replace("github.com", "raw.githubusercontent.com");
    return `${rawUrl}/${branch}/${filePath.startsWith("/") ? filePath.substring(1) : filePath}`;
}
