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
    /**
     * Invite a collaborator to a specific repository
     */
    static async inviteCollaborator(
        token: string, 
        owner: string, 
        repo: string, 
        username: string,
        permission: 'pull' | 'push' | 'admin' | 'maintain' | 'triage' = 'push'
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                body: JSON.stringify({ permission }),
                throw: false
            });

            if (response.status === 201 || response.status === 204) {
                return { success: true };
            }

            if (response.status === 422) {
                return { success: false, error: "User is already a collaborator or you cannot invite yourself." };
            }

            return { success: false, error: `GitHub error: ${response.status}` };
        } catch (error) {
            console.error("Failed to invite collaborator", error);
            return { success: false, error: error.message || "Unknown error" };
        }
    }

    /**
     * List pending invitations for a repository
     */
    static async listInvitations(token: string, owner: string, repo: string): Promise<any[]> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}/invitations?t=${Date.now()}`,
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
            });
            return response.json;
        } catch (error) {
            console.error("Failed to list invitations", error);
            return [];
        }
    }

    /**
     * List active collaborators for a repository
     */
    static async listCollaborators(token: string, owner: string, repo: string): Promise<any[]> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}/collaborators?t=${Date.now()}`,
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
            });
            return response.json;
        } catch (error) {
            console.error("Failed to list collaborators", error);
            return [];
        }
    }

    /**
     * Delete a pending invitation
     */
    static async deleteInvitation(token: string, owner: string, repo: string, invitationId: number): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}/invitations/${invitationId}`,
                method: "DELETE",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                throw: false
            });
            if (response.status !== 204) {
                console.error(`Failed to delete invitation ${invitationId} on ${owner}/${repo}. Status: ${response.status}`, response.text);
            }
            return response.status === 204;
        } catch (error) {
            console.error("Failed to delete invitation due to request error", error);
            return false;
        }
    }

    /**
     * Remove a collaborator from a repository
     */
    static async removeCollaborator(token: string, owner: string, repo: string, username: string): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
                method: "DELETE",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                throw: false
            });
            return response.status === 204;
        } catch (error) {
            console.error("Failed to remove collaborator", error);
            return false;
        }
    }

    /**
     * Get specific repository details
     */
    static async getRepository(token: string, owner: string, repo: string): Promise<{ private: boolean; html_url: string; full_name: string } | null> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}`,
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                throw: false
            });
            if (response.status !== 200) return null;
            const data = response.json as { private: boolean; html_url: string; full_name: string };
            return {
                private: data.private,
                html_url: data.html_url,
                full_name: data.full_name
            };
        } catch (error) {
            console.error("Failed to fetch repository details", error);
            return null;
        }
    }

    /**
     * Star a repository
     */
    static async starRepository(token: string, owner: string, repo: string): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/user/starred/${owner}/${repo}`,
                method: "PUT",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                body: "",
                throw: false
            });
            // 204 No Content is the success response for starring
            return response.status === 204;
        } catch (error) {
            console.error("Failed to star repository", error);
            return false;
        }
    }

    /**
     * Check if a repository is starred by the user
     */
    static async isStarred(token: string, owner: string, repo: string): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/user/starred/${owner}/${repo}`,
                method: "GET",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                throw: false
            });
            return response.status === 204;
        } catch (error) {
            // 404 means it's not starred
            return false;
        }
    }

    /**
     * Delete a repository from GitHub
     */
    static async deleteRepository(token: string, owner: string, repo: string): Promise<boolean> {
        try {
            const response = await requestUrl({
                url: `https://api.github.com/repos/${owner}/${repo}`,
                method: "DELETE",
                headers: {
                    "Authorization": `token ${token}`,
                    "Accept": "application/json",
                },
                throw: false
            });
            // 204 No Content is the success response for deletion
            return response.status === 204;
        } catch (error) {
            console.error("Failed to delete repository", error);
            return false;
        }
    }
}
