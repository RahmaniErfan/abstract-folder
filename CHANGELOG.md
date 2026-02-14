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
- **Read-Only Enforcement**: Disabled destructive context menu actions for community library files to prevent accidental data loss.
- **Tree Interaction Consistency**: Unified the behavior between the Main View and Library Explorer. Settings like `autoExpandChildren` now apply correctly across all tree-based views.
- **Virtualization Support**: Fixed a bug where virtualized nodes in the Main View failed to expand because they appeared to have no children. The system now uses the global Indexer as the source of truth for all interactions.

---
*For versions 1.0.0 through 1.14.0, see [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md)*
