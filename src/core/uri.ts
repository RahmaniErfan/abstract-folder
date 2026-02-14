/**
 * ResourceURI represents a unique, deterministic identifier for any node in the Abstract Folder system.
 * Format: abstract://{provider}/{context}/{resource-path}
 * 
 * Examples:
 * - abstract://local/vault/notes/test.md
 * - abstract://library/my-lib-id/notes/readme.md
 * - abstract://search/query-string/notes/test.md
 */

export type ResourceProvider = 'local' | 'library' | 'search' | 'remote';

export interface ResourceURI {
    protocol: 'abstract';
    provider: ResourceProvider;
    context: string;
    path: string;
}

export class URIUtils {
    /**
     * Serializes a ResourceURI into a string.
     */
    static toString(uri: ResourceURI): string {
        return `${uri.protocol}://${uri.provider}/${uri.context}/${uri.path}`;
    }

    /**
     * Parses a URI string into a ResourceURI object.
     */
    static parse(uriString: string): ResourceURI {
        const url = new URL(uriString);
        if (url.protocol !== 'abstract:') {
            throw new Error(`Invalid protocol: ${url.protocol}`);
        }

        const provider = url.host as ResourceProvider;
        const parts = url.pathname.slice(1).split('/');
        const context = parts[0];
        const path = parts.slice(1).join('/');

        return {
            protocol: 'abstract',
            provider,
            context,
            path
        };
    }

    /**
     * Creates a local vault URI.
     */
    static local(path: string, context: string = 'vault'): ResourceURI {
        return {
            protocol: 'abstract',
            provider: 'local',
            context,
            path
        };
    }

    /**
     * Creates a library URI.
     */
    static library(libraryId: string, path: string): ResourceURI {
        return {
            protocol: 'abstract',
            provider: 'library',
            context: libraryId,
            path
        };
    }

    /**
     * Compares two URIs for equality.
     */
    static equals(a: ResourceURI, b: ResourceURI): boolean {
        return a.provider === b.provider && a.context === b.context && a.path === b.path;
    }
}
