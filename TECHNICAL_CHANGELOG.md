# Technical Changelog - Abstract Folder Plugin v1.5.0

## Features

### Metrics-Based Sorting (`src/metrics-manager.ts`)

*   **Thermal Scoring**:
    *   Implemented a decay-based activity tracking system. Scores increase on `file-open` and graph updates.
    *   **Formula**: `score * (0.8 ^ days_since_last_interaction)`.
    *   **Persistence**: Activity timestamps and scores are persisted in `data.json` for consistency across restarts.
*   **Stale Rot Calculation**:
    *   Identifies neglected nodes by calculating `Inactivity (Days) * Complexity (Direct Child Count)`.
*   **Gravity Calculation**:
    *   Optimized recursive descendant counting using memoization to determine branch density in the abstract graph.

### UI & State Integration

*   **Sort Options**: Expanded `SortBy` type to include `thermal`, `rot`, and `gravity`.
*   **Toolbar Enhancements**: Integrated new sort modes into `AbstractFolderViewToolbar` with dedicated Lucide icons.

# Technical Changelog - Abstract Folder Plugin v1.4.1

## Bug Fixes

### Incremental Indexer Reliability

*   **Relationship State Synchronization**:
    *   **Problem**: In `updateFileIncremental`, the map tracking file relationships (`this.fileRelationships`) was updated *after* attempting to remove old relationships. For self-referencing links (A->A), `removeRelationshipFromGraphStructure(A, A)` would check the map, find that A still defines the relationship (using the old state), and skip removal. This left "phantom" links in the graph, preventing files from returning to a Root state when the self-reference was removed.
    *   **Solution**: Moved `this.fileRelationships.set(file.path, newRelationships)` to before the removal loops. This ensures that the safety checks in `removeRelationshipFromGraphStructure` (which verify if any file *still* defines the link) correctly use the *new* intended state of the file being updated.

### View Stability

*   **Virtual Scroll Persistence**:
    *   **Problem**: `renderColumnView` called `this.contentEl.empty()`, which destroyed the `abstract-folder-virtual-wrapper` and its associated containers (`virtualContainer`, `virtualSpacer`) created in `onOpen`. When switching back to Tree View, the renderer attempted to update these now-detached DOM elements, resulting in an empty view.
    *   **Solution**: Removed the destructive `empty()` call from `renderColumnView`. View cleanup is now centralized in `renderView`, which selectively removes only non-static elements, preserving the virtual scroll infrastructure across view transitions.

# Technical Changelog - Abstract Folder Plugin v1.4.0

## Performance Optimization & Virtualization

This release focuses on resolving critical performance bottlenecks for large vaults (35,000+ files), transforming O(N) operations into O(1) or O(log N) where possible.

### Architectural Decisions & Implementation Details:

1.  **Incremental Graph Indexing (`src/indexer.ts`)**:
    *   **Problem**: Every file modification triggered a `buildGraph()` call, which iterated over all 35k files to reconstruct the entire parent-child graph. This took ~500ms per keystroke/save, causing noticeable editor lag.
    *   **Solution**: Implemented `updateFileIncremental`. The indexer now tracks relationships defined *by* each file (`fileRelationships` map). When a file changes:
        1.  It retrieves the previous relationships defined by that file.
        2.  It calculates the new relationships from the updated frontmatter.
        3.  It removes the old links and adds the new ones in the global graph (O(1) set operations).
        4.  It updates the "Root" status only for the affected parent/child nodes.
    *   **Result**: Graph update time reduced from ~500ms to ~2ms.

2.  **Lazy Rendering & Virtualization (`src/view.ts`, `src/utils/virtualization.ts`)**:
    *   **Problem**: The `AbstractFolderView` attempted to render DOM nodes for the entire tree structure at once. With 35k files, this caused the UI to freeze for seconds or crash due to DOM overload.
    *   **Solution**:
        *   **Lazy Generation**: The full tree structure is no longer built. Instead, `generateFlatItemsFromGraph` creates a flat list of *only* the currently visible (expanded) nodes.
        *   **Virtual Scrolling**: A custom virtual scroller was implemented. It calculates which items are currently visible in the viewport and renders only those (plus a small buffer), recycling DOM nodes as the user scrolls.
        *   **Occlusion Culling**: Items outside the viewport are removed from the DOM.
    *   **Result**: Initial render and scroll performance are now independent of total vault size, handling 35k+ files smoothly.

3.  **Code Modularization (`src/utils/tree-utils.ts`)**:
    *   **Refactor**: Extracted core node creation logic (`createFolderNode`, `resolveGroupRoots`) into a shared utility to eliminate code duplication between the new Lazy Renderer and the existing Column Renderer.
    *   **Type Safety**: Fixed implicit `any` typing issues in frontmatter access during node creation.

4.  **UX Improvements**:
    *   **Loading State**: Introduced a distinct `isLoading` state in the view, triggered by a new `abstract-folder:graph-build-start` event. This prevents the "No abstract folders found" empty state from flashing during graph rebuilds.

# Synced Folder Branch (Experimental)

## Ambiguity Resolution in Synced Folders

*   **Ambiguous Link Resolution**:
    *   **Problem**: Short links (basename only) generated by `SyncManager` became ambiguous when duplicate filenames existed (e.g., `Untitled.md` in root vs `Untitled/Untitled.md`). This caused the abstract view to resolve the link to the "shortest path" (often the root file), opening the wrong file.
    *   **Solution**: The `SyncManager` now generates links using the **full vault-relative path** (e.g., `[[Folder/File.canvas]]`) for **all** files (Markdown and non-Markdown). This forces explicit resolution to the correct file regardless of duplicates elsewhere in the vault.

## UI Input Refinement

*   **Refined UI Input**: The file input suggestions (`FileInputSuggest`) in `CreateSyncedFolderModal` and `CreateEditGroupModal` were refined to display only files when selecting abstract parents, improving clarity and usability.

## Synced Folder Implementation

This release introduces the "Synced Folder" feature, allowing users to bind an abstract folder to a physical folder on the file system. This required significant additions to the indexing and event handling logic.

### Architectural Decisions & Implementation Details:

1.  **SyncManager (`src/sync-manager.ts`)**:
    *   **Decision**: A dedicated `SyncManager` class was created to handle the logic for two-way synchronization (currently primarily Physical -> Abstract).
    *   **Implementation**: This manager listens to `vault.on('create')` and `vault.on('rename')` events. When a file is created in or moved to a folder that is mapped to an abstract parent, the manager automatically links the file to that parent.
    *   **Challenge (Race Conditions)**: A critical issue arose when multiple files were moved simultaneously (e.g., drag-and-drop of multiple items) or when Obsidian renamed a file immediately after a move (e.g., `Untitled` -> `Untitled 1`). This caused concurrent `processFrontMatter` calls on the parent file, leading to overwrites where some files were lost from the `children` list.
    *   **Solution (Debounced Batching)**: Implemented a debounced queue system in `SyncManager`. Updates to the parent file's frontmatter are queued and applied in a single batch operation after a short delay (300ms). This ensures all new children are added atomically, resolving the race condition.

2.  **Ambiguous Link Resolution (Initial partial fix)**:
    *   **Challenge**: When a file was moved into a synced folder and renamed by Obsidian (due to naming collisions), the link update process sometimes became confused, leading to broken or missing links in the abstract parent.
    *   **Solution**: Initial implementation for non-markdown files used full paths. (Note: Fully standardized for all files in v1.4.1).

3.  **Folder Indexer Updates (`src/indexer.ts`)**:
    *   **Implementation**: Updated `FolderIndexer` to map physical folder paths to their corresponding abstract parent files (`physicalToAbstractMap`). This map is used by `SyncManager` to quickly look up the target abstract parent for any given file event.
    *   **Fallback Resolution**: Enhanced `resolveLinkToPath` to include a fallback mechanism. If `metadataCache` fails to resolve a link (which can happen with non-markdown files or immediately after creation), the indexer now performs a direct name search to locate the file, ensuring robust graph building.

# Technical Changelog - Abstract Folder Plugin v1.3.0

## Drag-and-Drop Functionality Implementation

This release introduces comprehensive drag-and-drop capabilities for abstract folders, addressing several functional and UI challenges to provide a fluid user experience.

### Architectural Decisions & Implementation Details:

1.  **Centralized Drag Management (`src/ui/dnd/drag-manager.ts`)**:
    *   **Decision**: To encapsulate all drag-and-drop event handling logic, a dedicated `DragManager` class was created. This approach promotes separation of concerns, keeping the rendering components (`TreeRenderer`, `ColumnRenderer`) focused solely on presentation.
    *   **Implementation**: `DragManager` registers and handles `dragstart`, `dragover`, `dragleave`, and `drop` DOM events. It maintains internal state (`dragData`, `currentDragTarget`) to track the ongoing drag operation and manage visual feedback.
    *   **Challenge**: Initial implementations faced issues with event bubbling, particularly `dragstart`, leading to incorrect `sourceParentPath` identification when dragging nested items.
    *   **Solution**: `event.stopPropagation()` was strategically applied in `handleDragStart` to ensure that only the intended draggable item's data is captured, preventing accidental re-parenting of ancestor folders.

2.  **Enhanced File Operations (`src/utils/file-operations.ts`)**:
    *   **Decision**: The core logic for modifying file frontmatter based on drag-and-drop operations was centralized in the `moveFiles` function. This function differentiates between Markdown and non-Markdown files, adhering to the plugin's "Child-Defined" (for Markdown) and "Parent-Defined" (for non-Markdown) parentage rules.
    *   **Implementation**:
        *   **Markdown Files**: The `moveFiles` function directly updates the `parent` frontmatter property of dragged Markdown files.
        *   **Non-Markdown Files**: For non-Markdown files (e.g., `.canvas`, images), the `children` frontmatter property of both the source and target Markdown parent files are updated.
    *   **Challenge**: Accurately removing the old parent link from a child's frontmatter proved difficult due to variations in how Obsidian links are stored (e.g., `[[Note]]`, `[[Note|Alias]]`, `[[Path/To/Note]]`). Simple string matching was insufficient and led to duplicate parent entries.
    *   **Solution**: Leveraging Obsidian's `app.metadataCache.getFirstLinkpathDest` was crucial. This API robustly resolves a link string to its corresponding file, allowing precise comparison and removal of the correct parent link, preventing "files appearing under both parents."

3.  **UI Integration and Visual Feedback**:
    *   **Decision**: Provide clear and non-disruptive visual feedback during drag operations.
    *   **Implementation**:
        *   `abstract-folder-drag-over` and `abstract-folder-drag-invalid` CSS classes were introduced.
        *   **Challenge**: Initially, using `border` for drag feedback caused layout flickering, as it altered the element's box model dimensions. Additionally, the default error red for invalid drops was too jarring.
        *   **Solution**: The CSS was refactored to use `outline` with `outline-offset: -2px` instead of `border`. `outline` does not affect layout, eliminating the flicker. The invalid drop background was softened using `rgba(var(--color-red-rgb), 0.15)` for a more subtle visual cue.
        *   **Challenge**: Ensuring drag feedback was always cleaned up, especially after invalid drops or drag cancellations.
        *   **Solution**: `DragManager` was enhanced with a `currentDragTarget` tracker and a `dragend` event listener. A `try...finally` block in `handleDrop` guarantees `dragData` and visual styles are reset irrespective of the drop outcome.

### Key Learnings:

*   **Obsidian API Nuances**: Understanding the specific behaviors of Obsidian's `metadataCache` and event system was critical for handling complex interactions like multi-parented notes and DOM events.
*   **Robustness in Data Handling**: Anticipating variations in data (e.g., link formats in frontmatter) and using platform-specific APIs for resolution significantly improves reliability.
*   **Subtle UI/UX**: Small details in visual feedback (like using `outline` over `border` and carefully chosen colors/opacities) contribute significantly to a polished user experience.