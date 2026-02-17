# Changelog

## [Unreleased] - (V2 High-Performance Architecture)
### Added
- **Strategic Cache Ingestion**: New synchronization bridge between proactive manual scans and reactive graph updates.
- **V2 SOVM Architecture**: Complete architectural overhaul to a Service-Oriented View Model for massive vault support.
  - **GraphEngine**: High-speed, bidirectional adjacency index for link-based hierarchy.
  - **TreeBuilder**: Iterative DFS tree construction with time-slicing (AsyncGenerators) to prevent UI freezing.
  - **VirtualViewportV2**: Absolute-positioned windowed virtualization for O(1) rendering performance.
  - **ContextEngineV2**: Atomic state management for selections and expansions using the Action-Reducer pattern.
- **Scoped Highlighting**: Visual "focus" mode that highlights all descendants of the currently selected node.
- **Enhanced Search**: Time-sliced search construction with automatic parent expansion for matches.
- **Mobile Optimized**: Adaptive row heights and touch-friendly targets for iOS and Android.

### Removed
- **Legacy Components**: Removed monolithic `FolderIndexer`, `TreeCoordinator`, and all class-based `Facets`.
- **Shadow V1 Logic**: Completely purged legacy rendering paths and `useV2Engine` toggle; the V2 stack is now the sole engine.

### Improved
- **Indentation Guides**: Reddit-style vertical indentation guides for the tree view. Supports "Rainbow Indents" with multiple color palettes (Classic, Pastel, Neon) and hover highlighting.
- **Virtualized Header Sync**: Fixed overlapping issues in V2 Viewport by introducing a coordinate-aware `HEADER_OFFSET`. The "Active Group" header is now pinned at the top and correctly synced with the virtualization engine's scroll math.
- **Abstract Library System**: Integrated library management for shared knowledge structures.
  - **Physical Library Sync**: Replaced Lightning-FS with direct vault synchronization. Libraries now exist as real files in your vault, enabling native Obsidian features (Search, Graph View, Backlinks) to work out-of-the-box.
  - **Git Smart HTTP Handshake**: Custom `ObsidianHttpAdapter` with hardened header compliance and iterable body support to resolve `EmptyServerResponseError` and `401 Unauthorized` errors.
  - **Library Center**: Dedicated view for browsing, installing, and updating libraries.
  - **Abstract Bridge**: Integrates physical library files directly into the Abstract Folder graph.
  - **Contribution Engine**: Secure state machine for drafting and submitting changes to remote repositories.
  - **GitHub PAT Authentication**: Replaced the failing Device Flow with a robust Personal Access Token (PAT) system. Includes automatic validation, username detection, and secure credential handling for private repository access.
  - **Registry Service**: Support for official and custom library registries with automatic placeholder filtering.
  - **Modular Settings**: Fully refactored settings tab with specialized sections for Appearance, Library, Groups, and Debugging.

### Improved
- **Library Explorer Reliability**: Fixed "Flat Tree" issue by implementing proactive link resolution. Hierarchy now renders immediately after installation.
- **Reactive Navigation**: The Library Explorer shelf now refreshes automatically when libraries are installed or uninstalled.
- **Visual Clarity**: Parent notes in libraries now consistently display folder icons and expansion chevrons.
- **Stability**: Enforced leading-slash pathing for virtual filesystem operations.
- **Resilience**: Defensive rendering in Settings UI to prevent crashes on corrupted `data.json`.
- **Reliability**: Hardened discovery URL normalization for GitHub repositories.

### Fixed
- **Filtering Logic**: Implemented a strict Filter Priority Stack where Hard Filters (excluded extensions) now take absolute precedence over Group membership and Search queries.
- **Extension Normalization**: Resolved issues where `.PNG` vs `png` caused filtering mismatches.
- **Root Leakage**: Fixed a bug where non-markdown roots were appearing in scoped views (Library Explorer) despite global filtering settings.
- **UI Synchronization**: Filter changes now trigger an immediate tree rebuild.
- **Library Explorer Hierarchy**: Resolved "Flat Tree" issue in Library Explorer by seeding GraphEngine with pre-verified relationships from AbstractBridge.
- **Race Conditions**: Implemented async semaphore locks in tree building to prevent UI clobbering during rapid file updates.
- **Viewport Cache Leaks**: Fixed stale DOM elements in virtualized list by forcing container purges on every update.
- **Folder Arrow Rotation**: Fixed a persistent issue where folder arrows (">") failed to rotate when expanded. Implemented correct mapping for "right-triangle" SVG paths (`0deg` expanded, `-90deg` collapsed) with high-specificity CSS overrides.
- **Virtualization Sync**: Resolved a core bug in the `VirtualViewport` where recycled DOM elements failed to update upon state changes (expansion/selection). Items are now correctly replaced during re-renders.
- **Selection Visuals**: Standardized tree item height to `24px` and fixed the selection highlight color to match the user's theme while maintaining text visibility.
- **Read-Only Enforcement**: Disabled destructive context menu actions for community library files to prevent accidental data loss.
- **Tree Interaction Consistency**: Unified the behavior between the Main View and Library Explorer. Settings like `autoExpandChildren` now apply correctly across all tree-based views.
- **Virtualization Support**: Fixed a bug where virtualized nodes in the Main View failed to expand because they appeared to have no children. The system now uses the global Indexer as the source of truth for all interactions.
- **SOVM Architecture Migration**: Completed the major architectural shift to Service-Oriented View Model.
  - **High Performance Rendering**: Switched to a virtualized tree system that can handle thousands of nodes with minimal memory footprint.
  - **Modular UI (Facets)**: Decoupled Toolbar, Search, and Tree logic into independent, reactive components.
  - **Unified Resource Model**: Introduced a URI-based resource model supporting multi-source tree providers (Local Vault + Libraries).
  - **Stateless Tree Coordination**: Moved from global mutation to stateless context-passing for robust view isolation.
  - **Advanced Feature Restoration**: Fully restored and hardened advanced sorting (Gravity/Thermal), search filtering, and group-scoped views within the new architecture.

### Improved
- **View Isolation**: Guaranteed data isolation between main vault and library explorer using view-scoped contexts.
- **Performance**: Multi-layer caching in `AbstractBridge` (Discovery + Tree) with TTL logic to minimize vault scans.
- **UI Responsiveness**: Debounced refreshes (50ms) and active-view gating to eliminate redundant render cycles.
- **CSS Hardening**: Refined box model and z-indexing for tree items to fix hover/overlap regressions.

### Fixed
- **Critical Data Leakage**: Fixed bug where library files would appear in the local vault view after switching.
- **Infinite Refresh Loops**: Resolved circular triggers between `ContextEngine` and `TreeFacet`.
- **Redundant Disk Scans**: Eliminated expensive recursive vault scans during every tree expansion.

---
*For versions 1.0.0 through 1.14.0, see [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md)*
