import { requestUrl } from "obsidian";

/**
 * AuthService implements GitHub authentication helper methods.
 */
export class AuthService {
    /**
     * Validate a Personal Access Token
     */
    static async validateToken(token: string): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: "https://api.github.com/user",
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
            });
            return response.status === 200;
        } catch (error) {
            console.error("Token validation failed", error);
            return false;
        }
    }
    /**
     * Get basic user info (needed for determining ownership)
     */
    static async getUserInfo(token: string): Promise<{ login: string; avatar_url: string; name: string | null; email: string | null } | null> {
        try {
            const response = await requestUrl({
                url: "https://api.github.com/user",
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
            });
            if (response.status !== 200) return null;
            const data = response.json as { login: string; avatar_url: string; name: string | null; email: string | null };
            return { 
                login: data.login, 
                avatar_url: data.avatar_url,
                name: data.name,
                email: data.email
            };
        } catch (error) {
            console.error("Failed to fetch user info", error);
            return null;
        }
    }

    /**
     * Check permissions for a specific repository
     */
    static async getRepoPermissions(token: string, owner: string, repo: string): Promise<{ push: boolean; pull: boolean; admin: boolean } | null> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}`,
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
            });
            if (response.status !== 200) return null;
            const data = response.json as { permissions: { push: boolean; pull: boolean; admin: boolean } };
            return data.permissions;
        } catch (error) {
            console.error("Failed to fetch repo permissions", error);
            return null;
        }
    }
    /**
     * Create a new repository on GitHub
     */
    static async createRepository(token: string, name: string, isPrivate: boolean): Promise<{ url: string; name: string } | null> {
        try {
            const response = await requestUrl({
                url: "https://api.github.com/user/repos",
                method: "POST",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name,
                    private: isPrivate,
                    description: "Backup via Abstract Folder",
                    auto_init: false,
                }),
            });
            if (response.status !== 201) return null;
            const data = response.json as { clone_url: string; name: string };
            return { url: data.clone_url, name: data.name };
        } catch (error) {
            console.error("Failed to create repository", error);
            return null;
        }
    }
}
