import { App } from "obsidian";
import { GitService } from "./git-service";
import { StatusManager } from "./status-manager";
import { AbstractFolderPluginSettings } from "../../../settings";
import { SyncOrchestrator, SyncOrchestratorConfig, Mutex, SyncEventListener } from "../sync";
import { PublicSyncOrchestrator, PublicSyncConfig } from "../sync/public-sync-orchestrator";
import { ConflictResolutionModal } from "../../../ui/modals/conflict-resolution-modal";
import { Logger } from "../../../utils/logger";
import { LibraryConfig } from "../../types";

/**
 * SyncManager handles the lifecycle of SyncOrchestrator instances.
 * One orchestrator is created per sub-repository (space, library, or vault root).
 */
export class SyncManager {
    /** One SyncOrchestrator per registered vault path (Engine 1). */
    private syncOrchestrators: Map<string, SyncOrchestrator> = new Map();
    /** One PublicSyncOrchestrator per library vault path (Engine 2). */
    private publicOrchestrators: Map<string, PublicSyncOrchestrator> = new Map();
    /** One Mutex per vault path — global, shared across all components and UI windows. */
    private mutexes: Map<string, Mutex> = new Map();

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private gitService: GitService,
        private statusManager: StatusManager,
        private syncBackupFallback: (vaultPath: string, message: string, token: string | undefined, silent: boolean) => Promise<void>
    ) {}

    /**
     * Start a SyncOrchestrator for a vault path.
     * Creates all components with proper DI wiring.
     */
    async startSyncEngine(vaultPath: string): Promise<void> {
        console.log(`[SyncManager] Starting sync engine for: "${vaultPath}"`);
        if (this.syncOrchestrators.has(vaultPath)) {
            Logger.debug(`[SyncManager] Sync engine already running for ${vaultPath}`);
            return;
        }

        const absoluteDir = this.gitService.getAbsolutePath(vaultPath);

        // Get or create a global mutex for this vault path
        if (!this.mutexes.has(vaultPath)) {
            this.mutexes.set(vaultPath, new Mutex());
        }
        const mutex = this.mutexes.get(vaultPath)!;

        const config: SyncOrchestratorConfig = {
            app: this.app,
            absoluteDir,
            vaultPath,
            branch: 'main',
            mutex,
            getToken: () => this.gitService.getToken(),
            getAuthor: () => this.gitService.getSyncAuthor(),
            openMergeUI: (dir, conflicts, onResolved) => {
                // Delegate to the existing ConflictResolutionModal UI
                const modal = new ConflictResolutionModal(
                    this.app,
                    dir,
                    conflicts,
                    async (strategy) => {
                        await onResolved(strategy === 'overwrite');
                    }
                );
                modal.open();
            },
            lastGcTime: this.settings.librarySettings.lastGcTime,
            onGcRun: (timestamp) => {
                this.settings.librarySettings.lastGcTime = timestamp;
                // Fire-and-forget settings save
                const plugin = (this.app as any).plugins?.getPlugin?.("abstract-folder");
                if (plugin) void plugin.saveSettings();
            },
            getIgnoredPaths: () => {
                // Only the root engine needs to ignore sub-repos
                if (vaultPath !== "") return [];
                return [
                    ...(this.settings.librarySettings.sharedSpaces || []),
                    ...(this.settings.librarySettings.personalBackups || []),
                ];
            }
        };

        const orchestrator = new SyncOrchestrator(config);

        // Crash recovery: check for interrupted merge
        const recovered = await orchestrator.recoverIfNeeded();
        if (recovered) {
            Logger.debug(`[SyncManager] Recovered crashed merge for ${vaultPath}`);
        }

        const success = await orchestrator.start();
        if (success) {
            this.syncOrchestrators.set(vaultPath, orchestrator);
            
            // Fire-and-forget gc
            orchestrator.gcIfNeeded();

            Logger.debug(`[SyncManager] Sync engine started for ${vaultPath}`);
        }
    }

    /**
     * Stop a SyncOrchestrator for a vault path.
     */
    stopSyncEngine(vaultPath: string): void {
        const orchestrator = this.syncOrchestrators.get(vaultPath);
        if (orchestrator) {
            orchestrator.stop();
            this.syncOrchestrators.delete(vaultPath);
            Logger.debug(`[SyncManager] Sync engine stopped for ${vaultPath}`);
        }

        // Also check Engine 2
        const publicOrch = this.publicOrchestrators.get(vaultPath);
        if (publicOrch) {
            publicOrch.stop();
            this.publicOrchestrators.delete(vaultPath);
            Logger.debug(`[SyncManager] Public sync engine stopped for ${vaultPath}`);
        }
    }

    // ─── Engine 2: Public Library Sync ───────────────────────────

    /**
     * Start Engine 2 (PublicSyncOrchestrator) for a public library path.
     * Uses CDN manifest polling + shallow fetch instead of Engine 1's bidirectional sync.
     */
    async startPublicSyncEngine(vaultPath: string, libraryConfig: LibraryConfig): Promise<void> {
        console.log(`[SyncManager] Starting public sync engine (Engine 2) for: "${vaultPath}"`);
        if (this.publicOrchestrators.has(vaultPath)) {
            Logger.debug(`[SyncManager] Public sync engine already running for ${vaultPath}`);
            return;
        }

        const absoluteDir = this.gitService.getAbsolutePath(vaultPath);

        const config: PublicSyncConfig = {
            app: this.app,
            absoluteDir,
            vaultPath,
            repositoryUrl: libraryConfig.repositoryUrl,
            branch: libraryConfig.branch || 'main',
            getToken: () => this.gitService.getToken(),
            getLocalVersion: () => libraryConfig.localVersion || '',
            setLocalVersion: (v: string) => {
                libraryConfig.localVersion = v;
                // Fire-and-forget settings save
                const plugin = (this.app as any).plugins?.getPlugin?.("abstract-folder");
                if (plugin) void plugin.saveSettings();
            },
            subscribedFolders: libraryConfig.subscribedFolders,
            lastGcTime: libraryConfig.lastEngine2GcTime,
            onGcRun: (timestamp: number) => {
                libraryConfig.lastEngine2GcTime = timestamp;
                const plugin = (this.app as any).plugins?.getPlugin?.("abstract-folder");
                if (plugin) void plugin.saveSettings();
            },
        };

        const orchestrator = new PublicSyncOrchestrator(config);
        const success = await orchestrator.start();
        if (success) {
            this.publicOrchestrators.set(vaultPath, orchestrator);
            Logger.debug(`[SyncManager] Public sync engine started for ${vaultPath}`);
        }
    }

    /**
     * Get the PublicSyncOrchestrator for a library vault path.
     */
    getPublicSyncOrchestrator(vaultPath: string): PublicSyncOrchestrator | undefined {
        return this.publicOrchestrators.get(vaultPath);
    }

    /**
     * Get the SyncOrchestrator for a vault path (for event subscriptions).
     */
    getSyncOrchestrator(vaultPath: string): SyncOrchestrator | undefined {
        return this.syncOrchestrators.get(vaultPath);
    }

    /**
     * Manual push from UI. Flushes pending auto-commits then pushes.
     */
    async pushNow(vaultPath: string): Promise<void> {
        const orchestrator = this.syncOrchestrators.get(vaultPath);
        if (orchestrator) {
            await orchestrator.pushNow();
        } else {
            // Fallback to legacy syncBackup for unregistered paths
            await this.syncBackupFallback(vaultPath, "Manual push via Abstract Folder", undefined, true);
        }
    }

    /**
     * Flush all pending auto-commits and push.
     * Called from plugin.onunload().
     */
    async flushAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [path, orchestrator] of this.syncOrchestrators) {
            Logger.debug(`[SyncManager] Flushing sync engine for ${path}`);
            promises.push(orchestrator.flush());
        }
        // Engine 2 flush is no-op but include for completeness
        for (const [path, orchestrator] of this.publicOrchestrators) {
            Logger.debug(`[SyncManager] Flushing public sync engine for ${path}`);
            promises.push(orchestrator.flush());
        }
        await Promise.allSettled(promises);
    }

    /**
     * Subscribe to sync events from a specific orchestrator.
     */
    onSyncEvent(vaultPath: string, type: string, listener: SyncEventListener): (() => void) | null {
        const orchestrator = this.syncOrchestrators.get(vaultPath);
        if (orchestrator) {
            return orchestrator.on(type as any, listener);
        }
        return null;
    }

    /**
     * Cleanup all orchestrators.
     */
    public cleanup() {
        for (const orchestrator of this.syncOrchestrators.values()) {
            orchestrator.stop();
        }
        this.syncOrchestrators.clear();

        for (const orchestrator of this.publicOrchestrators.values()) {
            orchestrator.stop();
        }
        this.publicOrchestrators.clear();
    }
}
