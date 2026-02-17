# Technical Changelog

## [2026-02-17] VS Code-style Sync UI & Status Bar Implementation

### 1. Abstract Status Bar Architecture
*   **The Component**: Implemented `AbstractFolderStatusBar` as a decoupled, reactive UI component mounted directly to the bottom of the `AbstractFolderView`.
*   **Reactive Lifecycle**: The status bar is synchronized with the `refreshTree` loop, ensuring that Git status (uncommitted change counts) and identity tokens are always current without redundant disk polling.
*   **The Layout**: Adopted a classic VS Code-inspired dual-facet layout:
    *   **Identity (Left)**: Renders the active GitHub session (avatar + username) with automatic refresh logic using the `AuthService`.
    *   **Controls (Right)**: Separates the "Management" icon (Cloud) from the "Action" icon (Refresh-CW).

### 2. High-Performance Sync Animation & Badging
*   **Icon Partitioning**: Successfully separated the Backup Dashboard entry point from the Quick Sync action. This allows for a dedicated `sync` (arrows) icon that can provide a natural rotation animation without distorting the semantic `cloud` icon.
*   **Performance Optimization**: Used GPU-accelerated CSS keyframe animations for the sync rotation to prevent layout thrashing during Git operations.
*   **Notification Badge Overlays**: Implemented absolute-positioned badges with themed box-shadows to ensure high visibility of change counts against the primary background.

### 3. UI/CSS Theme Hardening
*   **Seamless Background Interp**: Enforced `var(--background-primary) !important` on the status bar and viewport scroll container to ensure a continuous visual plane, eliminating "floating" component artifacts.
*   **Strict Viewport Constraints**: Applied strict flex and overflow constraints to the viewport container to prevent the new status bar from being pushed off-screen or causing scrollbar double-nesting.

## [2026-02-16] V2 Search Experience & Poly-hierarchy Hardening

### 1. Path-Specific Poly-hierarchy Support
*   **The Challenge**: In a graph-based hierarchy, a single node (e.g., `Commands.md`) can have multiple parents (e.g., `Work` and `Personal Projects`). Standard search implementations often "de-duplicate" these, causing the node to only appear under one branch, losing vital context for the other.
*   **Synthetic URI Resolution**: Updated `TreeBuilder` and `VirtualViewportV2` to treat the **Synthetic URI** (the full path from root) as the primary identity instead of the physical `FileID`. This allows the same file to exist in multiple UI locations simultaneously, each with its own state.
*   **Path-Aware Matching**: Refactored `TreePipeline` to accept a `parentId`. The "leads to match" check is now path-specific, ensuring that a folder only appears if it leads to a match *within that specific branch*, eliminating noise from unrelated ancestors.

### 2. Search Feature Restoration (Ancestors & Descendants)
*   **Show Ancestors (Upstream Expansion)**:
    *   **ON**: Recursively identifies all folders leading to a match, preserving full context.
    *   **OFF**: Implemented "Promote to Roots" logic. Direct matches are flattened and displayed as top-level roots for high-density information discovery.
*   **Show Descendants (Downstream Expansion)**: Automatically steps into and expands the children of matching folders or files, providing immediate visibility into folder contents.
*   **Ghost Match Elimination**: Implemented strict extension-based filtering within the recursive matching logic to ensure that excluded files (PNGs, PDFs) never trigger a "folder match" if they contain the search query in their name.

### 3. Virtual Viewport & DFS Order Hardening
*   **The "Jumping Item" Bug**: Identified a critical collision where the Virtual Viewport was using `FileID` as a DOM key. Because the same ID now appeared multiple times (Poly-hierarchy), the viewport would "steal" DOM elements from one branch to render another, causing visual flickering and missing nodes.
*   **The Fix**: Standardized all Viewport caching on URIs.
*   **Stack Order Inversion**: Corrected the Depth-First Search (DFS) stack processing in `TreeBuilder`. Children are now pushed in reverse sorted order, guaranteeing that the virtualized popping matches the intended top-to-bottom visual sequence.
*   **Visual Gap Fix**: Resolved incorrect viewport heights by ensuring the build loop `continue`s immediately on filter-out without yielding or incrementing counters.

### 4. Strategic Cache Ingestion (Bridge-to-Graph Sync)
*   **The Discovery**: Using `GraphEngine: CRITICAL CACHE DUMP`, it was confirmed that Obsidian's `metadataCache` often returns `undefined` for library files (e.g. after Git sync), even when data exists on disk.
*   **The Implementation**: Added `seedRelationships()` to `IGraphEngine`. This allows the `AbstractBridge` to push high-confidence relationships parsed manually from disk directly into the `AdjacencyIndex`.
*   **Performance**: Bypasses the asynchronous metadata indexing queue, ensuring hierarchical integrity (chevrons/nesting) immediately upon library selection without redundant disk reads.

### 2. Standardized V2 Filtering Pipeline & Priority Stack
*   **The Bug**: Identified a logic leak where nodes were being included even if `MATCHED EXCLUSION` was logged. This was caused by an `OR` condition in `TreeBuilder` where `isStructural` (Group Roots) was overriding the Hard Filter.
*   **Filter Priority Stack**: Implemented a strict multi-phase validation in `TreeBuilder`:
    1.  **HARD FILTER (isExcluded)**: Extension-based exclusion (Precedence 1 - Absolute).
    2.  **STRUCTURAL (isStructural)**: Group membership (Precedence 2).
    3.  **SEARCH (matches)**: Query matching (Precedence 3).
*   **Scoped Root Hardening**: Unified "Scoped Roots" (Library Scoping) in `GraphEngine` to use the modular `RootSelectionPolicy`, removing hardcoded `.md` checks that caused root leakage.
*   **Extension Normalization**: Centralized extension extraction in `TreePipeline` to handle case-sensitivity (`.PNG` vs `png`) and edge cases for hidden files.

### 3. Concurrency & State Management
*   **Refresh Semaphore**: Implemented `isRefreshing` lock in `AbstractFolderView` to prevent interleaved async tree builds during rapid filesystem events.

### 4. Virtualization Math & Header Offset Support
*   **Coordinate Synchronization**: Updated `VirtualViewportV2` to support a `HEADER_OFFSET` (24px) for the sticky group header.
*   **Math Fixes**:
    -   `setItems`: Total spacer height now calculates as `OFFSET + (N * ITEM_HEIGHT)`.
    -   `update`: The windowing window indices now use `Math.floor((scrollTop - OFFSET) / ITEM_HEIGHT)`.
    -   `scrollToItem`: Scroll target correctly lands at `OFFSET + (INDEX * ITEM_HEIGHT)`.
*   **Active Group Binding**: Implemented `updateGroupHeader()` to reactively bind the sticky header text to the `ContextEngineV2` state, displaying either the specific active group name or "All files".
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
