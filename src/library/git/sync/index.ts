/**
 * @file index.ts
 * @description Barrel export for the sync engine module.
 */

// Core types & interfaces
export type { ISyncEngine, SyncEvent, SyncEventType, SyncEventListener, SyncAuthor, ConflictFile, ConflictDetectionResult, NetworkErrorKind } from './types';
export { AUTO_COMMIT_DEBOUNCE_MS, NETWORK_SYNC_INTERVAL_MS, MAX_AUTO_COMMIT_FILE_SIZE, GC_INTERVAL_MS } from './types';

// Infrastructure
export { Mutex } from './mutex';
export { GitCommandRunner } from './git-command-runner';
export type { GitCommandResult, GitCommandError } from './git-command-runner';
export { toPosixPath, toPosixDir } from './path-utils';

// Components
export { AutoCommitEngine } from './auto-commit-engine';
export { NetworkSyncQueue } from './network-sync-queue';
export { ConflictDetector } from './conflict-detector';
export { MergeResolver } from './merge-resolver';

// Orchestrator
export { SyncOrchestrator } from './sync-orchestrator';
export type { SyncOrchestratorConfig } from './sync-orchestrator';
