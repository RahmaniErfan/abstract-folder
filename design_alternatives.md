# Design Alternatives & Trade-offs

## 1. The Core Architecture: Defining Hierarchy

### Option A: Child-defined (Current Plan)
The **Child** note points to the **Parent**.
*   **Mechanism**: Frontmatter `parent: [[Work]]`.
*   **Pros**:
    *   **Frictionless Filing**: You only touch the new file you are creating. You don't need to open the parent to "register" the child.
    *   **Multi-parenting**: Trivial to add `parent: [[Work]], [[Project X]]`.
*   **Cons**:
    *   The "Parent" note doesn't inherently know its children without a search/query (the plugin handles this).

### Option B: Parent-defined (Map of Content / MOC)
The **Parent** note contains links to its **Children**.
*   **Mechanism**: A list of links `[[Child 1]]`, `[[Child 2]]` in the body of the Parent note.
*   **Pros**:
    *   **Native**: Works without any plugins. The Graph view naturally shows the hierarchy.
    *   **Context**: You can describe *why* a child is in that folder (annotated links).
*   **Cons**:
    *   **High Friction**: To add a child, you must find and edit the parent note.
    *   **Fragile Ordering**: Requires manual sorting of the list in the parent note.

### Option C: Tag Hierarchy
*   **Mechanism**: `#Work/ProjectA/Logs`.
*   **Pros**: Built-in to Obsidian.
*   **Cons**: Tags are not files. You can't add metadata or text to a "folder" (the tag itself).

---

## 2. The Naming Collision Problem

Since we are flattening the physical folders, we cannot have `Work/Logs.md` and `Personal/Logs.md`. We must solve `Logs.md` vs `Logs.md`.

### Approach A: Human-Readable Prefixes + Aliases (Current Plan)
*   **Physical**: `Work - Logs.md`
*   **Virtual (View)**: `Logs` (via `aliases: [Logs]`)
*   **Pros**:
    *   Files are readable in Finder/Explorer.
    *   Autocomplete in Obsidian works well (`[[Work - Logs]]`).
*   **Cons**:
    *   Renaming the parent (virtual move) technically implies we should rename the file prefix to keep it "clean", though strictly not required.

### Approach B: Unique IDs (Zettelkasten style)
*   **Physical**: `202311240900.md` or `uuid-1234.md`.
*   **Virtual (View)**: `Logs` (via `title` or `aliases`).
*   **Pros**:
    *   **Zero Collisions**: You never have to worry about naming conflicts.
    *   **Stable Links**: You can rename the "Title" freely without breaking links or needing to rename the physical file.
*   **Cons**:
    *   **Opaque**: In Finder/Explorer, you have no idea what `202311240900.md` contains.
    *   **Dependencies**: You become heavily reliant on the plugin or Obsidian to navigate your vault.

---

## Recommendation

**Stick with Option A (Child-defined)** for the structure. It is the most robust way to build a "Database-like" folder structure where items can live in multiple places.

**For Naming**: **Approach A (Prefixes)** is usually preferred for users who want to "own their data" and be able to read it outside Obsidian. **Approach B (UIDs)** is better if you want a purely "app-centric" experience and don't care about the physical files.