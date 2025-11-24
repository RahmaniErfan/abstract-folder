# Abstract Folder Structure - Design Document

## 1. Overview
A plugin that creates a virtual folder structure based on file properties rather than physical directories. This allows a file to exist in multiple "folders" simultaneously by declaring multiple parents.

## 2. Core Concepts
- **Parent Definition**: A frontmatter property (default: `parent`) containing links to other notes `[[Parent Name]]`.
- **Structure**: A Directed Acyclic Graph (DAG) where nodes are files.
- **Root Nodes**: Files that have no `parent` property defined.
- **Multi-Parent**: A file can appear under multiple parents in the view.

## 3. Architecture

### A. Modules
1.  **`main.ts`**: Entry point. Manages plugin lifecycle, initializes the view and indexer.
2.  **`src/indexer.ts`**: Responsible for parsing the vault and building the relationship graph.
    *   Maintains a `parentToChildren` map: `Map<string, Set<string>>` (Parent Path -> Set of Child Paths).
    *   Listens to `metadataCache` events (`changed`, `deleted`, `renamed`) to keep the map updated efficiently.
3.  **`src/view.ts`**: The Custom View (`ItemView`).
    *   Renders the "Abstract Folders" in the sidebar.
    *   Uses a recursive rendering strategy.
    *   **Loop Detection**: Must track visited nodes in the current render path to prevent infinite recursion if users create loops (A -> B -> A).
4.  **src/settings.ts**: Configuration.
    *   `propertyName`: The frontmatter key to use (default: "parent").

### B. Data Flow
1.  **Startup**: Plugin loads -> Indexer scans all Markdown files -> Builds initial Graph -> View renders.
2.  **Update**: User modifies a note's frontmatter -> `metadataCache` triggers -> Indexer updates specific node in Graph -> View re-renders.

## 4. Technical Constraints & Trade-offs
*   **Performance**: Scanning the whole vault on load might be slow for huge vaults (10k+ notes).
    *   *Mitigation*: The `metadataCache` is already cached by Obsidian, so looking up cache entries is fast. We don't need to read file contents, just metadata.
*   **Loops**: A user might define A as parent of B, and B as parent of A.
    *   *Solution*: The recursive renderer will pass a `Set<string>` of `ancestors` down the chain. If a node is already in `ancestors`, stop rendering that branch.

## 5. Implementation Plan

- [ ] **Scaffold Project Structure**: Create `src/` directory and organize files (`indexer.ts`, `view.ts`, `settings.ts`).
- [ ] **Implement Settings**: Allow changing the property name.
- [ ] **Implement Indexer**:
    - [ ] Build the initial graph from `app.metadataCache`.
    - [ ] Handle cache updates (efficiently update graph without full rebuild).
- [ ] **Implement View (UI)**:
    - [ ] Register the custom view type.
    - [ ] Build the recursive Tree component (using standard DOM creation or a lightweight helper).
    - [ ] Handle "opening" notes when clicked.
- [ ] **Integration**: Connect Indexer to View (View refreshes when Indexer notifies of change).
- [ ] **Refinement**: Add open/close state for folders (collapsible).
