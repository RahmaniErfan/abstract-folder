/**
 * @file mutex.ts
 * @description Async mutual exclusion lock for serializing git operations.
 * Prevents .git/index corruption when multiple components (auto-commit, network queue,
 * manual push) attempt concurrent git operations.
 *
 * IMPORTANT: Must be instantiated ONCE per vault path at the LibraryManager level
 * and shared across all components. Obsidian can open multiple workspace windows
 * of the same vault via Electron's shared process — a per-UI-instance mutex
 * would NOT prevent cross-window race conditions.
 */

export class Mutex {
    private locked = false;
    private queue: Array<() => void> = [];

    /**
     * Acquire the lock. Returns a release function.
     * If the lock is already held, the caller is queued and will resolve
     * when the current holder releases.
     *
     * Usage:
     * ```ts
     * const release = await mutex.acquire();
     * try {
     *     await doGitStuff();
     * } finally {
     *     release();
     * }
     * ```
     */
    async acquire(): Promise<() => void> {
        return new Promise<() => void>(resolve => {
            const tryAcquire = () => {
                if (!this.locked) {
                    this.locked = true;
                    resolve(() => {
                        this.locked = false;
                        // Drain the next waiter, if any
                        if (this.queue.length > 0) {
                            const next = this.queue.shift()!;
                            next();
                        }
                    });
                } else {
                    this.queue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    /** Whether the lock is currently held. */
    get isLocked(): boolean {
        return this.locked;
    }

    /** Number of waiters currently queued. */
    get pendingCount(): number {
        return this.queue.length;
    }
}
