# Technical Changelog

## [2026-02-15] SOVM Architecture & Library Integration

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

### UI/CSS
*   **Indentation Fix**: Re-implemented hierarchical padding using `depth` tracking in the flattening algorithm.
*   **Box Model**: Corrected `.abstract-folder-item` layout to prevent visual "hover overlap" between parents and children.

### 3. Unified Interaction Controller
*   **Indexer as Source of Truth**: Refactored tree logic to use the `Indexer` as the absolute source of truth for node relationships, ensuring consistency between virtualized and recursive views.
*   **Event-Driven Synchronization**: Introduced `abstract-folder:tree-state-updated` to synchronize expansion states across all active view panes.
