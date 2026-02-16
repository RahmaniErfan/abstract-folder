# Technical Changelog

## [2026-02-16] V2 SOVM Architecture Enhancement (Pipeline & Scoping)

### 1. Strategic Cache Ingestion (Bridge-to-Graph Sync)
*   **The Discovery**: Using `GraphEngine: CRITICAL CACHE DUMP`, it was confirmed that Obsidian's `metadataCache` often returns `undefined` for library files (e.g. after Git sync), even when data exists on disk.
*   **The Implementation**: Added `seedRelationships()` to `IGraphEngine`. This allows the `AbstractBridge` to push high-confidence relationships parsed manually from disk directly into the `AdjacencyIndex`.
*   **Performance**: Bypasses the asynchronous metadata indexing queue, ensuring hierarchical integrity (chevrons/nesting) immediately upon library selection without redundant disk reads.

### 2. Standardized V2 Filtering Pipeline
*   **Authoritative Extension Check**: Refactored `StandardTreePipeline` to use `app.vault.getAbstractFileByPath` for extension detection, ensuring parity with the legacy filtering settings.
*   **Pipeline Simplification**: Removed redundant traversal checks in `TreeBuilder`. The `Pipeline.matches()` is now the absolute judge of visibility, separating traversal logic from visualization rules.

### 3. Concurrency & State Management
*   **Refresh Semaphore**: Implemented `isRefreshing` lock in `AbstractFolderView` to prevent interleaved async tree builds during rapid filesystem events.
*   **Viewport Cache Hardening**: Forced absolute `containerEl.empty()` and `renderedItems` cache purges in `VirtualViewportV2` to eliminate "Ghost DOM" artifacts after graph re-indexing.

### 4. Library Explorer Activation Fixes
*   **Constructor Integrity**: Fixed `TypeError` in `LibraryExplorerView` by passing plugin settings to `ContextEngineV2`.
*   **Scoped Root Discovery**: Hardened `GraphEngine.getAllRoots` to support direct path-based scoping. Improved prefix matching logic to distinguish between library roots and global orphans.

## [2026-02-15] V2 SOVM Architecture (Phase 7-9)

### 1. High-Performance Graph & View Model
*   **SOVM Implementation**: Transitioned to a Service-Oriented View Model.
    *   **GraphEngine**: Implements a real-time adjacency index for frontmatter-defined relationships.
    *   **TreeBuilder**: Uses iterative DFS with `AsyncGenerator` time-slicing (12ms chunks) to maintain 60FPS UI during tree construction.
    *   **ContextEngineV2**: Centralized reactive state for selections and expansions.
*   **Windowed Virtualization**: `VirtualViewportV2` uses absolute positioning and calculated offsets to render only visible nodes, enabling support for 10,000+ nodes with constant-time DOM updates.

### 2. The Great Purge & Feature Parity
*   **Legacy Removal**: Deleted `FolderIndexer`, `TreeCoordinator`, and recursive rendering facets.
*   **Feature Restoration**: Full parity achieved for Search, Context Menus, and Drag-and-Drop within the V2 stack.
*   **Transaction Management**: Integrated `TransactionManager` for batch file operations with suppression of graph updates.

### 3. UI Polish & Mobile Hardening
*   **Adaptive Layout**: Integrated `Platform.isMobile` checks into the virtualization engine.
*   **Touch Optimization**: Increased item height to `32px` on mobile devices via CSS variables.
*   **Scoped Highlighting**: Visual implementation of descendant-aware highlighting for improved hierarchical focus.
*   **Modular CSS**: Unified style rules into a scalable component-based architecture.

## [2026-02-15] Library Integration (V1.15)

### 1. Library Explorer Robustness & Read-Only Integrity
*   **Proactive Link Resolution (`src/library/bridge/abstract-bridge.ts`)**: Implemented a `localPathMap` built during the initial filesystem scan to resolve hierarchy links even before Obsidian finishes indexing.
*   **Read-Only Context Menus**: Introduced `isLibrary` property to `FolderNode`. The `ContextMenuHandler` now strips destructive actions (Create, Rename, Delete) for community library nodes.
*   **Reactive View Synchronization**: Created `abstract-folder:library-changed` workspace event to refresh the Explorer "Shelf" immediately after installation/uninstallation.
*   **Folder Icon Consistency**: Unified "Effective Folder" checks to ensure parent notes consistently display folder icons and chevrons.

### 2. Architectural Pivot: Stateless Coordination
*   **The Problem**: `TreeCoordinator` and `ContextEngine` were singletons holding global state (`activeProviderIds`, `selectedLibraryId`). This caused cross-pollination when multiple views (e.g., Abstract View and Library Explorer) existed in the Obsidian workspace.
*   **The Solution**: Implementation of **Stateless Coordination**. All filtering and scoping parameters are now encapsulated in a `TreeContext` object.
*   **Mechanism**: Methods in `ITreeProvider` and `TreeCoordinator` now require `TreeContext` as a parameter. `TreeFacet` instances own their specific context and pass it during data requests.

### Core Components
*   **`TreeContext`**: Interface defining `providerIds` and `libraryId` for a specific request.
*   **`TreeFacet` Hardening**:
    *   Added `isActive` flag to ignore global events while in the background.
    *   Implemented `debouncedRefresh` (50ms) to batch multiple `ContextEngine` notifications.
    *   Internalized `TreeContext` state.
*   **Multi-Layer Caching ([`src/library/bridge/abstract-bridge.ts`](src/library/bridge/abstract-bridge.ts))**:
    *   `discoveryCache`: Caches library locations (5s TTL).
    *   `treeCache`: Caches built abstract hierarchies (30s TTL).
    *   Significantly reduces `TFolder` traversal overhead.

### State Management
*   **`ContextEngine.silent()`**: Utility to perform state updates (like selection resets) without triggering a notification avalanche.
*   **View Lifecycle**: Updated `AbstractFolderView` and `LibraryExplorerView` to perform "Silent Resets" on `onOpen`.

### UI/CSS Hardening
*   **Virtualization State Sync (`src/ui/components/virtual-viewport.ts`)**: Discovered that the `renderedItems` cache was bypassing re-renders for visible items when expansion state changed. Implemented `replaceWith` logic to force DOM updates on every data refresh.
*   **URI Standardization**: Eliminated "Shadow States" caused by mixed usage of `uri.path` and serialized URIs. All state lookups in `ContextEngine` and `TreeFacet` are now strictly standardized on `URIUtils.toString()`.
*   **Rotation Mapping**: Identified that the "right-triangle" SVG path is naturally oriented at `0deg` (DOWN). Adjusted mapping to `-90deg` for collapsed (RIGHT) to match native Obsidian behavior.
*   **Indentation Fix**: Re-implemented hierarchical padding using `depth` tracking in the flattening algorithm.
*   **Reddit-style Indentation Guides**: Implemented `position: absolute` guide lines with hover highlighting and support for legacy Rainbow Indent palettes.
*   **Box Model**: Standardized row height to `24px` and refined vertical padding to prevent the "Focus Box" overlap issue.

### 3. Unified Interaction Controller
*   **Indexer as Source of Truth**: Refactored tree logic to use the `Indexer` as the absolute source of truth for node relationships, ensuring consistency between virtualized and recursive views.
*   **Event-Driven Synchronization**: Introduced `abstract-folder:tree-state-updated` to synchronize expansion states across all active view panes.
