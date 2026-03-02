/**
 * @file version-controller.ts
 * @description Engine 2, Component 2: Cache-Aware Version Controller (The Comparator).
 *
 * Manages SemVer comparison between remote manifest and local persisted version.
 *
 * Key behaviors:
 * - Inline SemVer compare (no external dependency)
 * - Downgrade protection: rejects remote < local unless forceResync is true
 * - Mutex guard: isChecking boolean drops duplicate checks from timer + manual click
 * - Local version persisted via callbacks (backed by data.json / library.json)
 */

import { ManifestData } from './cdn-manifest-poller';

// ─── SemVer Comparison ──────────────────────────────────────────────

interface SemVerParts {
    major: number;
    minor: number;
    patch: number;
}

/**
 * Parse a SemVer string into numeric parts.
 * Handles formats: "1.0.0", "1.0", "1"
 */
function parseSemVer(version: string): SemVerParts {
    const parts = version.replace(/^v/, '').split('.').map(Number);
    return {
        major: parts[0] || 0,
        minor: parts[1] || 0,
        patch: parts[2] || 0,
    };
}

/**
 * Compare two SemVer strings.
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemVer(a: string, b: string): number {
    const pa = parseSemVer(a);
    const pb = parseSemVer(b);

    if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
    if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
    if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
    return 0;
}

// ─── Version Check Result ───────────────────────────────────────────

export interface VersionCheckResult {
    shouldUpdate: boolean;
    reason: string;
    remoteVersion?: string;
    localVersion?: string;
}

// ─── Version Controller ─────────────────────────────────────────────

export class VersionController {
    private isChecking = false; // Mutex guard against concurrent checks

    constructor(
        private getLocalVersion: () => string,
        private setLocalVersion: (version: string) => void,
    ) {}

    /**
     * Determine if an update should be applied.
     *
     * Rules:
     * - Remote > Local → update
     * - Remote == Local → skip
     * - Remote < Local → reject (downgrade protection) unless forceResync
     */
    shouldUpdate(remote: ManifestData, forceResync = false): VersionCheckResult {
        // Mutex guard: prevent duplicate checks
        if (this.isChecking) {
            return { shouldUpdate: false, reason: 'check-in-progress' };
        }

        this.isChecking = true;
        try {
            const localVersion = this.getLocalVersion();
            const remoteVersion = remote.version;

            // First sync: no local version yet
            if (!localVersion) {
                return {
                    shouldUpdate: true,
                    reason: 'first-sync',
                    remoteVersion,
                    localVersion: 'none',
                };
            }

            const comparison = compareSemVer(remoteVersion, localVersion);

            if (comparison > 0) {
                // Remote is newer
                return {
                    shouldUpdate: true,
                    reason: 'update-available',
                    remoteVersion,
                    localVersion,
                };
            }

            if (comparison === 0) {
                // Already up to date
                return {
                    shouldUpdate: false,
                    reason: 'up-to-date',
                    remoteVersion,
                    localVersion,
                };
            }

            // comparison < 0: Remote is older (potential revert/force-push)
            if (forceResync) {
                return {
                    shouldUpdate: true,
                    reason: 'force-resync',
                    remoteVersion,
                    localVersion,
                };
            }

            // Downgrade protection
            return {
                shouldUpdate: false,
                reason: 'downgrade-rejected',
                remoteVersion,
                localVersion,
            };

        } finally {
            this.isChecking = false;
        }
    }

    /**
     * Persist the new version after a successful sync.
     * Called by the orchestrator after ShallowSyncExecutor completes.
     */
    applyVersion(version: string): void {
        this.setLocalVersion(version);
        console.log(`[VersionController] Version updated to ${version}`);
    }

    /**
     * Get the current local version.
     */
    get currentVersion(): string {
        return this.getLocalVersion();
    }
}
