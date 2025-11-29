# Abstract Folders

## What it does

This Obsidian plugin allows notes to appear in multiple "abstract folders" simultaneously. This avoids note copying and simplifies note placement.

## Why use it

Traditional folders limit notes to a single category, causing common issues:

*   **Single Location Limit:** Traditional folders require a single location for each note.
*   **Note Duplication:** Creating multiple copies of notes for different topics is common.
*   **Excessive Properties:** Describing notes across categories (e.g., "Work," "University") often involves adding many properties (e.g., `Subject`, `Area`). This is often redundant, as category information exists within the folder structure or note links.

Abstract Folders addresses these issues using a `parent` setting in a note's frontmatter. This enables:

*   **Multiple Associations:** A single note appears in different abstract folders ("ghost nodes") without physical duplication.
*   **Folder Notes:** Any note can serve as an abstract "folder" for its children. Parent notes can act as index pages.

Benefits:

*   **Flexible Organization:** Notes link to all relevant contexts without duplication.
*   **Streamlined Navigation:** Custom tree and column views explore notes and their relationships.
*   **Effortless Management:** Notes move by updating their `parent` setting.
*   **Less Property Clutter:** Category information is represented by the abstract folder structure, reducing the need for many descriptive frontmatter properties.

## Features

*   **Poly-Hierarchical Structure:** Notes can have multiple parents using the `parent` frontmatter setting (default: `parent`).
*   **Ghost Node Display:** The same note appears in all its abstract folders within the plugin's UI.
*   **Folder Note Function:** Any note can act as an abstract "folder" for its children.
*   **Custom Tree & Column Views:** Replaces or augments the native Obsidian file explorer with interactive views.
*   **Frontmatter Moves:** Notes are moved by editing their `parent` property; no file system operations needed.
*   **Right-Click Menu:** Full context menu, with actions like hiding notes, renaming, deleting, setting custom icons, and creating new child notes.
*   **Parent-Defined Children:** Children can also be listed directly in a parent note's frontmatter.
*   **Conversion Tools:** Tools convert physical folders to abstract folders, and vice-versa (with preview).
*   **Non-Frontmatter File Support:** Supports files without frontmatter (e.g., Excalidraw, Canvas) using parent-defined children.
*   **Dynamic Sorting:** Abstract folders and notes can be sorted by name or modification time.
*   **Settings:** Customizable parent properties, aliases, auto-reveal active file, startup options, view styles, indentation guides, expanded folder memory, and excluded paths.

## Compatibility

Abstract Folders works with Obsidian on desktop and mobile platforms.
