# Abstract Folder Structure - Design Document

## 1. Overview
A plugin that creates a virtual folder structure based on file properties rather than physical directories. This allows a file to exist in multiple "folders" simultaneously by declaring multiple parents.

## 2. Core Concepts
- **Parent Definition**: A frontmatter property (default: `parent`) containing links to other notes `[[Parent Name]]`.
- **Structure**: A Directed Acyclic Graph (DAG) where nodes are files.
- **Root Nodes**: Files that have no `parent` property defined.
- **Multi-Parent**: A file can appear under multiple parents in the view.
- **Display Name**: The tree view can show a "Virtual Name" (from `aliases` or `title`) instead of the physical filename.

## 3. Architecture

### A. Modules
1.  **`main.ts`**: Entry point. Manages plugin lifecycle, initializes the view and indexer.
2.  **`src/indexer.ts`**: Responsible for parsing the vault and building the relationship graph.
    *   Maintains a `parentToChildren` map: `Map<string, Set<string>>` (Parent Path -> Set of Child Paths).
    *   Listens to `metadataCache` events (`changed`, `deleted`, `renamed`) to keep the map updated efficiently.
3.  **`src/view.ts`**: The Custom View (`ItemView`).
    *   Renders the "Abstract Folders" in the sidebar.
    *   **New**: Supports `aliases` for display nodes.
    *   **New**: Highlights and expands to the currently active file (`file-open` event).
4.  **`src/settings.ts`**: Configuration.
    *   `propertyName`: The frontmatter key to use (default: "parent").
    *   `useAliases`: Boolean to toggle using aliases for display.
5.  **`src/commands.ts` (New)**:
    *   `Create Child Note`: Automates file creation with collision handling.

### B. Data Flow
1.  **Startup**: Plugin loads -> Indexer scans all Markdown files -> Builds initial Graph -> View renders.
2.  **Update**: User modifies a note's frontmatter -> `metadataCache` triggers -> Indexer updates specific node in Graph -> View re-renders.
3.  **Navigation**: User opens a file -> View auto-expands to show that file in the hierarchy.

## 4. Phase 2 Features (Addressing User Needs)

### A. Visibility (Solves: "Hard to know actual links")
*   **Active File Reveal**: When opening a note, the Abstract Folder View will automatically expand to show that note's location(s) in the hierarchy.

### B. Naming & Structure (Solves: "Naming Collisions")
*   **Strategy**: **Contextual Suffix Naming**.
    *   We want the filename to be as simple as possible.
    *   **Attempt 1**: `ChildName.md` (e.g. `Logs.md`)
    *   **Attempt 2 (Collision)**: `ChildName (ParentName).md` (e.g. `Logs (Work).md`)
    *   **Attempt 3 (Collision)**: `ChildName (ParentName) 1.md`
    *   **Virtual Display**: The view simply shows `aliases` (e.g., "Logs") so the user doesn't see the suffix in the tree.

### C. Search Improvements
*   The "Create Child" modal will use a fuzzy search against all Markdown files in the vault to ensure the user can find the intended parent, even if casing differs.

## 5. Implementation Plan

- [x] Scaffold project structure (src/ directories and files)
- [x] Implement Settings (settings.ts)
- [x] Implement Indexer (indexer.ts) logic
- [x] Implement Abstract Folder View (view.ts) UI
- [x] Connect Main logic (main.ts)
- [x] Update Settings (add 'Show Aliases' and 'Auto Reveal' options)
- [x] Update View (Render aliases, Implement active file reveal)
- [ ] **Refine Creation Logic**:
    - [ ] Update `commands.ts` to use **Contextual Suffix Naming**.
    - [ ] Improve Parent Search in Modal (iterate vault files instead of strict path lookup).
- [ ] Verify and Test
