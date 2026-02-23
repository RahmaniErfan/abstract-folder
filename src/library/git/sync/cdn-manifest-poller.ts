/**
 * @file cdn-manifest-poller.ts
 * @description Engine 2, Component 1: CDN Manifest Bypass (The Gatekeeper).
 *
 * Polls `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/manifest.json`
 * using ETag caching for near-zero bandwidth when nothing has changed (304 Not Modified).
 *
 * Key behaviors:
 * - Wraps JSON.parse in try/catch — falls back to last known good manifest on malformed JSON
 * - Strips W/ prefix from Weak ETags (GitHub CDN returns these)
 * - Exponential backoff on 429/503 (5min → 15min → 30min cap)
 * - Desktop-only: uses Node https module for ETag/If-None-Match header support
 */

import { ISyncEngine, SyncEvent, SyncEventListener, SyncEventType, CDN_POLL_INTERVAL_MS } from './types';

// ─── Types ──────────────────────────────────────────────────────────

export interface ManifestData {
    version: string;
    timestamp: number;
}

type ManifestCallback = (manifest: ManifestData) => void;

// ─── CDN Manifest Poller ────────────────────────────────────────────

export class CDNManifestPoller implements ISyncEngine {
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private lastETag: string | null = null;
    private lastKnownGood: ManifestData | null = null;
    private consecutiveFailures = 0;
    private listeners: Map<string, Set<SyncEventListener>> = new Map();
    private manifestUrl: string;

    constructor(
        private repositoryUrl: string,
        private branch: string,
        private onUpdateAvailable: ManifestCallback,
        pollIntervalMs: number = CDN_POLL_INTERVAL_MS,
    ) {
        // Convert GitHub repo URL to raw.githubusercontent.com manifest URL
        // e.g. "https://github.com/owner/repo" → "https://raw.githubusercontent.com/owner/repo/main/manifest.json"
        this.manifestUrl = this.buildManifestUrl(repositoryUrl, branch);
        this.pollIntervalMs = pollIntervalMs;
    }

    private pollIntervalMs: number;

    // ─── ISyncEngine Lifecycle ──────────────────────────────────

    start(): void {
        if (this.running) return;
        this.running = true;
        this.consecutiveFailures = 0;

        console.log(`[CDNManifestPoller] Started polling: ${this.manifestUrl}`);

        // First check immediately
        void this.poll();

        this.intervalHandle = setInterval(() => {
            void this.poll();
        }, this.pollIntervalMs);
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }

        console.log(`[CDNManifestPoller] Stopped polling`);
    }

    /** No-op for Engine 2 — nothing to flush (read-only). */
    async flush(): Promise<void> {}

    // ─── Public API ─────────────────────────────────────────────

    /**
     * Manual check from UI. Returns the manifest if an update is available, null otherwise.
     */
    async checkNow(): Promise<ManifestData | null> {
        return this.poll();
    }

    // ─── Core Polling ───────────────────────────────────────────

    private async poll(): Promise<ManifestData | null> {
        if (!this.running && this.intervalHandle) return null; // Safety: stopped mid-tick

        this.emit({ type: 'manifest-check' });

        try {
            const https = require('https');
            const url = new URL(this.manifestUrl);

            const result = await new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
                const headers: Record<string, string> = {
                    'User-Agent': 'AbstractFolder-Obsidian-Plugin',
                };

                // ETag cache: send If-None-Match if we have a previous ETag
                if (this.lastETag) {
                    headers['If-None-Match'] = this.lastETag;
                }

                const req = https.get({
                    hostname: url.hostname,
                    path: url.pathname,
                    headers,
                }, (res: any) => {
                    let body = '';
                    res.on('data', (chunk: string) => body += chunk);
                    res.on('end', () => {
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            body,
                        });
                    });
                });

                req.on('error', reject);
                req.setTimeout(15000, () => {
                    req.destroy();
                    reject(new Error('CDN request timeout'));
                });
            });

            // ─── 304 Not Modified ────────────────────────────────
            if (result.status === 304) {
                this.consecutiveFailures = 0;
                this.emit({ type: 'update-skipped', detail: { reason: 'not-modified' } });
                return null;
            }

            // ─── Rate Limiting / Server Errors ───────────────────
            if (result.status === 429 || result.status === 503) {
                this.handleBackoff(result.status);
                return null;
            }

            // ─── Success ─────────────────────────────────────────
            if (result.status === 200) {
                // Store ETag for next request (strip Weak ETag W/ prefix)
                const rawETag = result.headers['etag'];
                if (rawETag) {
                    this.lastETag = this.normalizeETag(rawETag);
                }

                // Parse manifest with malformed JSON protection
                let manifest: ManifestData;
                try {
                    const parsed = JSON.parse(result.body);
                    if (!parsed.version || typeof parsed.version !== 'string') {
                        throw new Error('Missing or invalid "version" field');
                    }
                    manifest = {
                        version: parsed.version,
                        timestamp: parsed.timestamp || Date.now(),
                    };
                } catch (parseError) {
                    // Malformed JSON — fall back to last known good, don't crash the poll loop
                    console.error('[CDNManifestPoller] Malformed manifest.json, falling back to last known good:', parseError);
                    this.emit({ type: 'error', detail: { phase: 'manifest-parse', error: parseError } });
                    return this.lastKnownGood;
                }

                this.lastKnownGood = manifest;
                this.consecutiveFailures = 0;
                this.onUpdateAvailable(manifest);
                return manifest;
            }

            // ─── Other Errors (404, 500, etc.) ───────────────────
            console.warn(`[CDNManifestPoller] Unexpected status ${result.status} from CDN`);
            this.emit({ type: 'error', detail: { phase: 'cdn-fetch', status: result.status } });
            return null;

        } catch (error: any) {
            // Network error (offline, DNS failure, timeout)
            this.consecutiveFailures++;
            const isOffline = error.message?.includes('ENOTFOUND') ||
                              error.message?.includes('ECONNREFUSED') ||
                              error.message?.includes('timeout') ||
                              error.code === 'ENOTFOUND';

            if (isOffline) {
                this.emit({ type: 'offline', detail: { consecutiveFailures: this.consecutiveFailures } });
                console.debug('[CDNManifestPoller] Offline, will retry next tick');
            } else {
                this.emit({ type: 'error', detail: { phase: 'cdn-request', error: error.message } });
                console.error('[CDNManifestPoller] Request error:', error);
            }
            return null;
        }
    }

    // ─── Helpers ────────────────────────────────────────────────

    /**
     * Normalize ETag: strip Weak ETag prefix (W/"...") that GitHub CDN sometimes returns.
     */
    private normalizeETag(etag: string): string {
        if (etag.startsWith('W/')) {
            return etag.substring(2);
        }
        return etag;
    }

    /**
     * Build the raw.githubusercontent.com manifest URL from a GitHub repo URL.
     */
    private buildManifestUrl(repoUrl: string, branch: string): string {
        // Handle various GitHub URL formats:
        // https://github.com/owner/repo
        // https://github.com/owner/repo.git
        // git@github.com:owner/repo.git
        let cleanUrl = repoUrl
            .replace(/\.git$/, '')
            .replace('git@github.com:', 'https://github.com/');

        if (cleanUrl.includes('github.com')) {
            cleanUrl = cleanUrl.replace('github.com', 'raw.githubusercontent.com');
            return `${cleanUrl}/${branch}/manifest.json`;
        }

        // Fallback: assume it's already a raw URL
        return `${repoUrl}/${branch}/manifest.json`;
    }

    /**
     * Exponential backoff on rate limiting / server errors.
     * Reschedules the poll interval to back off.
     */
    private handleBackoff(statusCode: number): void {
        this.consecutiveFailures++;
        const backoffMs = Math.min(
            this.pollIntervalMs * Math.pow(2, this.consecutiveFailures),
            30 * 60 * 1000 // Cap at 30 minutes
        );

        console.warn(`[CDNManifestPoller] ${statusCode} response. Backing off for ${backoffMs / 1000}s`);
        this.emit({ type: 'error', detail: { kind: 'rate-limited', backoffMs, statusCode } });

        // Reschedule with new backoff interval
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
        }
        this.intervalHandle = setInterval(() => {
            void this.poll();
        }, backoffMs);
    }

    // ─── Event Bus ──────────────────────────────────────────────

    on(type: SyncEventType | '*', listener: SyncEventListener): () => void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
        return () => this.listeners.get(type)?.delete(listener);
    }

    private emit(event: SyncEvent): void {
        const typeListeners = this.listeners.get(event.type);
        if (typeListeners) {
            typeListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[CDNManifestPoller] Listener error:', e); }
            });
        }
        const allListeners = this.listeners.get('*');
        if (allListeners) {
            allListeners.forEach(l => {
                try { l(event); } catch (e) { console.error('[CDNManifestPoller] Listener error:', e); }
            });
        }
    }
}
