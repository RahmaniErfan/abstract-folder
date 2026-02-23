import { App, EventRef } from "obsidian";
import { AbstractFolderPluginSettings } from "../../settings";
import { SecurityManager } from "../../core/security-manager";
import { GitScopeManager } from "./git-scope-manager";
import { LibraryConfig, LibraryStatus, CatalogItem } from "../types";
import { GitStatusMatrix } from "./types";
import { SyncOrchestrator, SyncAuthor, SyncEventListener } from "./sync";

import { GitService } from "./manager/git-service";
import { StatusManager } from "./manager/status-manager";
import { LibraryService } from "./manager/library-service";
import { SpaceService } from "./manager/space-service";
import { SyncManager } from "./manager/sync-manager";

/**
 * LibraryManager is a facade that coordinates various Git-related services.
 * It provides a unified API for the rest of the plugin while delegating
 * specific responsibilities to specialized services.
 */
export class LibraryManager {
    public readonly scopeManager: GitScopeManager;
    private gitService: GitService;
    private statusManager: StatusManager;
    private libraryService: LibraryService;
    private spaceService: SpaceService;
    private syncManager: SyncManager;

    private vaultRefs: EventRef[] = [];
    private windowFocusListener: () => void;

    constructor(
        private app: App,
        private settings: AbstractFolderPluginSettings,
        private securityManager: SecurityManager
    ) {
        this.scopeManager = new GitScopeManager(app);
        this.gitService = new GitService(this.app, this.settings, this.securityManager);
        this.statusManager = new StatusManager(this.app, this.gitService);
        this.libraryService = new LibraryService(this.app, this.settings, this.gitService, this.statusManager, this.scopeManager);
        this.spaceService = new SpaceService(this.app, this.settings, this.gitService, this.statusManager, this.securityManager, this.scopeManager, (vp) => this.stopSyncEngine(vp));
        this.syncManager = new SyncManager(this.app, this.settings, this.gitService, this.statusManager, (vp, m, t, s) => this.spaceService.syncBackup(vp, m, t, s));

        // Reactive Cache Invalidation Hooks
        this.vaultRefs.push(this.app.vault.on('modify', (file) => this.flagCacheDirty(file.path)));
        this.vaultRefs.push(this.app.vault.on('create', (file) => this.flagCacheDirty(file.path)));
        this.vaultRefs.push(this.app.vault.on('delete', (file) => this.flagCacheDirty(file.path)));

        // Window Focus Listener: Force cache invalidation when returning to the app
        this.windowFocusListener = () => {
            for (const vaultPath of this.statusManager.getCacheKeys()) {
                this.statusManager.flagCacheDirtyByPath(vaultPath);
            }
        };
        window.addEventListener('focus', this.windowFocusListener);
    }

    // --- Core Git Operations (Delegated to GitService) ---

    async checkNativeGit(): Promise<boolean> {
        return this.gitService.checkNativeGit();
    }

    async refreshIdentity(providedToken?: string) {
        return this.gitService.refreshIdentity(providedToken);
    }

    async getToken(): Promise<string | undefined> {
        return this.gitService.getToken();
    }

    async getAuthorCredentials(): Promise<SyncAuthor> {
        return this.gitService.getAuthorCredentials();
    }

    getAbsolutePath(vaultPath: string): string {
        return this.gitService.getAbsolutePath(vaultPath);
    }

    // --- Status & Cache Management (Delegated to StatusManager) ---

    flagCacheDirty(filePath: string) {
        this.statusManager.flagCacheDirty(filePath);
    }

    flagCacheDirtyByPath(vaultPath: string) {
        this.statusManager.flagCacheDirtyByPath(vaultPath);
    }

    getCachedStatusForPath(filePath: string) {
        return this.statusManager.getCachedStatusForPath(filePath);
    }

    async getFileStatuses(vaultPath: string): Promise<GitStatusMatrix> {
        return this.statusManager.getFileStatuses(vaultPath);
    }

    async getSyncStatus(vaultPath: string) {
        return this.statusManager.getSyncStatus(vaultPath);
    }

    clearFetchingLock(vaultPath: string) {
        this.statusManager.clearFetchingLock(vaultPath);
    }

    // --- Library Operations (Delegated to LibraryService) ---

    async cloneLibrary(repositoryUrl: string, destinationPath: string, item?: CatalogItem, token?: string) {
        return this.libraryService.cloneLibrary(repositoryUrl, destinationPath, item, token);
    }

    async updateLibrary(vaultPath: string, token?: string) {
        return this.libraryService.updateLibrary(vaultPath, token);
    }

    async getStatus(vaultPath: string): Promise<LibraryStatus> {
        return this.libraryService.getStatus(vaultPath);
    }

    async validateLibrary(vaultPath: string): Promise<LibraryConfig> {
        return this.libraryService.validateLibrary(vaultPath);
    }

    async deleteLibrary(vaultPath: string) {
        return this.libraryService.deleteLibrary(vaultPath);
    }

    async isLibraryOwner(vaultPath: string): Promise<{ isOwner: boolean; author: string; repositoryUrl: string | null }> {
        return this.libraryService.isLibraryOwner(vaultPath);
    }

    async getRemoteUrl(vaultPath: string): Promise<string | null> {
        return this.libraryService.getRemoteUrl(vaultPath);
    }

    // --- Space & Backup Operations (Delegated to SpaceService) ---

    async cloneSpace(repositoryUrl: string, destinationPath: string, token?: string) {
        return this.spaceService.cloneSpace(repositoryUrl, destinationPath, token);
    }

    async detectExistingGit(vaultPath: string): Promise<boolean> {
        return this.spaceService.detectExistingGit(vaultPath);
    }

    async checkForLargeFiles(vaultPath: string): Promise<string[]> {
        return this.spaceService.checkForLargeFiles(vaultPath);
    }

    async initRepository(vaultPath: string) {
        return this.spaceService.initRepository(vaultPath);
    }

    async initializePersonalBackup(vaultPath: string, repositoryUrl: string, token?: string) {
        return this.spaceService.initializePersonalBackup(vaultPath, repositoryUrl, token);
    }

    async syncBackup(vaultPath: string, message?: string, token?: string, silent?: boolean) {
        return this.spaceService.syncBackup(vaultPath, message, token, silent);
    }

    async addRemote(vaultPath: string, url: string) {
        return this.spaceService.addRemote(vaultPath, url);
    }

    async finalizeMerge(absoluteDir: string, vaultPath: string, token?: string, silent?: boolean) {
        return this.spaceService.finalizeMerge(absoluteDir, vaultPath, token, silent);
    }

    async getHistory(vaultPath: string, depth?: number) {
        return this.spaceService.getHistory(vaultPath, depth);
    }

    async getCollaborators(vaultPath: string) {
        return this.spaceService.getCollaborators(vaultPath);
    }

    async deleteSharedSpace(vaultPath: string, deleteRemote: boolean) {
        return this.spaceService.deleteSharedSpace(vaultPath, deleteRemote);
    }

    async pruneMissingRepositories() {
        return this.spaceService.pruneMissingRepositories();
    }

    // --- Sync Orchestration (Delegated to SyncManager) ---

    async startSyncEngine(vaultPath: string) {
        return this.syncManager.startSyncEngine(vaultPath);
    }

    stopSyncEngine(vaultPath: string) {
        this.syncManager.stopSyncEngine(vaultPath);
    }

    getSyncOrchestrator(vaultPath: string) {
        return this.syncManager.getSyncOrchestrator(vaultPath);
    }

    async pushNow(vaultPath: string) {
        return this.syncManager.pushNow(vaultPath);
    }

    async flushAll() {
        return this.syncManager.flushAll();
    }

    onSyncEvent(vaultPath: string, type: string, listener: SyncEventListener) {
        return this.syncManager.onSyncEvent(vaultPath, type, listener);
    }

    /**
     * Cleanup resources before plugin unload.
     */
    cleanup() {
        window.removeEventListener('focus', this.windowFocusListener);
        for (const ref of this.vaultRefs) {
            this.app.vault.offref(ref);
        }
        this.statusManager.cleanup();
        this.syncManager.cleanup();
    }
}
