import { requestUrl } from "obsidian";

export interface GitHubDeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

export interface GitHubTokenResponse {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}

/**
 * AuthService implements the GitHub Device Flow for OAuth.
 * This allows users to authenticate without manual token entry.
 */
export class AuthService {
    private static CLIENT_ID = "Iv1.your_client_id_here"; // To be replaced with actual Client ID

    /**
     * Step 1: Request device and user codes from GitHub
     */
    static async requestDeviceCode(): Promise<GitHubDeviceCodeResponse> {
        const response = await requestUrl({
            url: "https://github.com/login/device/code",
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: this.CLIENT_ID,
                scope: "repo",
            }),
        });

        if (response.status !== 200) {
            throw new Error(`Failed to request device code: ${response.status}`);
        }

        return response.json as GitHubDeviceCodeResponse;
    }

    /**
     * Step 2: Poll GitHub for the access token
     */
    static async pollForToken(deviceCode: string): Promise<string | null> {
        const response = await requestUrl({
            url: "https://github.com/login/oauth/access_token",
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: this.CLIENT_ID,
                device_code: deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
        });

        const data = response.json as GitHubTokenResponse;

        if (data.access_token) {
            return data.access_token;
        }

        if (data.error === "authorization_pending") {
            return null;
        }

        if (data.error) {
            throw new Error(`Auth error: ${data.error_description || data.error}`);
        }

        return null;
    }
}
