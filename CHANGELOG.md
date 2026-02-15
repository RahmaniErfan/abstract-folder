# Changelog

## [Unreleased] - (Abstract Library Update v1.15)
### Added
- **Abstract Library System**: Integrated library management for shared knowledge structures.
  - **Physical Library Sync**: Replaced Lightning-FS with direct vault synchronization. Libraries now exist as real files in your vault, enabling native Obsidian features (Search, Graph View, Backlinks) to work out-of-the-box.
  - **Git Smart HTTP Handshake**: Custom `ObsidianHttpAdapter` with hardened header compliance and iterable body support to resolve `EmptyServerResponseError` and `401 Unauthorized` errors.
  - **Library Center**: Dedicated view for browsing, installing, and updating libraries.
  - **Abstract Bridge**: Integrates physical library files directly into the Abstract Folder graph.
  - **Contribution Engine**: Secure state machine for drafting and submitting changes to remote repositories.
  - **GitHub Device Flow**: Passwordless OAuth integration for secure library access.
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
