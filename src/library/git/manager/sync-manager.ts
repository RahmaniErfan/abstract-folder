import { App } from "obsidian";
import { GitService } from "./git-service";
import { StatusManager } from "./status-manager";
import { AbstractFolderPluginSettings } from "../../../settings";
import { SyncOrchestrator, SyncOrchestratorConfig, Mutex, SyncEventListener } from "../sync";
import { ConflictResolutionModal } from "../../../ui/modals/conflict-resolution-modal";
import { Logger } from "../../../utils/logger";

/**
 * SyncManager handles the lifecycle of SyncOrchestrator instances.
 * One orchestrator is created per sub-repository (space, library, or vault root).
 */
export class SyncManager {
    /** One SyncOrchestrator per registered vault path. */
    private syncOrchestrators: Map<string, SyncOrchestrator> = new Map();
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
    }
}
