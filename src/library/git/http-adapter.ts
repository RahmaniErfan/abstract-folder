import { requestUrl, RequestUrlResponse } from "obsidian";

/**
 * GitHttpRequest defines the structure expected for incoming git requests.
 */
interface GitHttpRequest {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: any;
}

interface GitHttpResponse {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any; // Can be Uint8Array or Array<Uint8Array> for isomorphic-git
    statusCode: number;
    statusMessage: string;
}

/**
 * Helper to combine multiple Uint8Array chunks into a single ArrayBuffer.
 */
function combineChunks(chunks: Uint8Array[]): ArrayBuffer {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    return combined.buffer;
}

/**
 * ObsidianHttpAdapter
 * 
 * A custom HTTP adapter for isomorphic-git that uses Obsidian's requestUrl.
 * This is CRITICAL for mobile support and bypassing CORS issues on desktop,
 * as Obsidian's requestUrl bypasses standard browser CORS restrictions.
 */
export const ObsidianHttpAdapter = {
    async request({
        url,
        method,
        headers,
        body,
    }: GitHttpRequest): Promise<GitHttpResponse> {
        let requestBody: ArrayBuffer | string | undefined;
        
        if (body) {
            if (body instanceof Uint8Array) {
                requestBody = body.buffer as ArrayBuffer;
            } else if (typeof body === "string") {
                requestBody = body;
            } else if (typeof body === "object" && body !== null) {
                if (Symbol.asyncIterator in body) {
                    const chunks: Uint8Array[] = [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const iterable = body as any;
                    for await (const chunk of iterable) {
                        if (chunk instanceof Uint8Array) {
                            chunks.push(chunk);
                        }
                    }
                    requestBody = combineChunks(chunks);
                } else if (Symbol.iterator in body) {
                    const chunks: Uint8Array[] = [];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const iterable = body as any;
                    for (const chunk of iterable) {
                        if (chunk instanceof Uint8Array) {
                            chunks.push(chunk);
                        }
                    }
                    requestBody = combineChunks(chunks);
                }
            }
        }

        // Ensure body is undefined for GET requests to avoid 401 errors from some servers (like GitHub)
        // when an empty body or content-length is sent.
        const finalBody = (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD")
            ? undefined
            : requestBody;

        // Merge standard headers that GitHub and other servers expect
        const finalHeaders: Record<string, string> = {
            "User-Agent": "git/2.0.0",
            "Accept": url.includes("/info/refs")
                ? "application/x-git-upload-pack-advertisement"
                : "*/*",
            ...headers,
        };

        // CRITICAL: GitHub rejects public access if bad/empty auth headers are present.
        // If isomorphic-git (or our logic) passed an empty Authorization header, strip it.
        if (finalHeaders["Authorization"] &&
           (finalHeaders["Authorization"].includes("undefined") ||
            finalHeaders["Authorization"].includes("null") ||
            finalHeaders["Authorization"] === "Basic Og==")) { // "Og==" is ":" base64
            delete finalHeaders["Authorization"];
        }

        // Test: Removing Git-Protocol version 2 to see if it bypasses stricter GH validation
        delete finalHeaders["Git-Protocol"];

        // Ensure URL ends in .git for smart HTTP protocol if it's a GitHub URL
        let finalUrl = url;
        if (url.includes("github.com") && !url.includes(".git/info/refs") && url.includes("/info/refs")) {
            finalUrl = url.replace("/info/refs", ".git/info/refs");
        }

        const response: RequestUrlResponse = await requestUrl({
            url: finalUrl,
            method,
            headers: finalHeaders,
            body: finalBody,
            throw: false,
        });

        // isomorphic-git expects lowercase header keys.
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) {
            responseHeaders[key.toLowerCase()] = value;
        }

        let resBody: any;
        if (response.arrayBuffer) {
            // isomorphic-git discovery parser requires an iterable body (AsyncIterator or Array).
            // Wrapping the Uint8Array in an array satisfies this and prevents EmptyServerResponseError.
            resBody = [new Uint8Array(response.arrayBuffer)];
        }

        return {
            url: finalUrl, // Important for redirects
            method,
            headers: responseHeaders,
            body: resBody,
            statusCode: response.status,
            statusMessage: "OK",
        };
    },
};
