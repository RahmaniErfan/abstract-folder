/**
 * @file index.ts
 * @description Barrel export for the sync engine module.
 */

// Core types & interfaces
export type { ISyncEngine, SyncEvent, SyncEventType, SyncEventListener, SyncAuthor, ConflictFile, ConflictDetectionResult, NetworkErrorKind } from './types';
export { AUTO_COMMIT_DEBOUNCE_MS, NETWORK_SYNC_INTERVAL_MS, MAX_AUTO_COMMIT_FILE_SIZE, GC_INTERVAL_MS, CDN_POLL_INTERVAL_MS, ENGINE2_GC_INTERVAL_MS } from './types';

// Infrastructure
export { Mutex } from './mutex';
export { GitCommandRunner } from './git-command-runner';
export type { GitCommandResult, GitCommandError } from './git-command-runner';
export { toPosixPath, toPosixDir } from './path-utils';

// Engine 1 Components
export { AutoCommitEngine } from './auto-commit-engine';
export { NetworkSyncQueue } from './network-sync-queue';
export { ConflictDetector } from './conflict-detector';
export { MergeResolver } from './merge-resolver';

// Engine 1 Orchestrator
export { SyncOrchestrator } from './sync-orchestrator';
export type { SyncOrchestratorConfig } from './sync-orchestrator';

// Engine 2 Components
export { CDNManifestPoller } from './cdn-manifest-poller';
export type { ManifestData } from './cdn-manifest-poller';
export { VersionController } from './version-controller';
export type { VersionCheckResult } from './version-controller';
export { ShallowSyncExecutor } from './shallow-sync-executor';
export type { ShallowSyncResult, ShallowSyncExecutorConfig } from './shallow-sync-executor';

// Engine 2 Orchestrator
export { PublicSyncOrchestrator } from './public-sync-orchestrator';
export type { PublicSyncConfig } from './public-sync-orchestrator';
