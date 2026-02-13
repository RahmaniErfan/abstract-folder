# Changelog

## [Unreleased] - (Abstract Library Update v1.15)
### Added
- **Abstract Library System**: Integrated library management for shared knowledge structures.
  - **Virtual Filesystem**: Integrated `lightning-fs` for persistent storage of libraries without vault clutter.
  - **Git Smart HTTP Handshake**: Custom `ObsidianHttpAdapter` with hardened header compliance and iterable body support to resolve `EmptyServerResponseError` and `401 Unauthorized` errors.
  - **Library Center**: Dedicated view for browsing, installing, and updating libraries.
  - **Abstract Bridge**: Integrates virtual library files directly into the Abstract Folder graph.
  - **Contribution Engine**: Secure state machine for drafting and submitting changes to remote repositories.
  - **GitHub Device Flow**: Passwordless OAuth integration for secure library access.
  - **Registry Service**: Support for official and custom library registries with automatic placeholder filtering.
  - **Modular Settings**: Fully refactored settings tab with specialized sections for Appearance, Library, Groups, and Debugging.

### Improved
- **Stability**: Enforced leading-slash pathing for virtual filesystem operations.
- **Resilience**: Defensive rendering in Settings UI to prevent crashes on corrupted `data.json`.
- **Reliability**: Hardened discovery URL normalization for GitHub repositories.

---
*For versions 1.0.0 through 1.14.0, see [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md)*
