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
    body: Uint8Array | undefined;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return combined.buffer as any;
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                requestBody = body.buffer as any;
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

        const response: RequestUrlResponse = await requestUrl({
            url,
            method,
            headers,
            body: requestBody,
            throw: false,
        });

        // isomorphic-git expects lowercase header keys.
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) {
            responseHeaders[key.toLowerCase()] = value;
        }

        const resBody = response.arrayBuffer ? new Uint8Array(response.arrayBuffer) : undefined;

        return {
            url,
            method,
            headers: responseHeaders,
            body: resBody,
            statusCode: response.status,
            statusMessage: "OK",
        };
    },
};
