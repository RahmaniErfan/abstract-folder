# Abstract Folder

## What it does

Manage your vault with dynamic, virtual folders for flexible note organization.

## Usage

Abstract Folder enhances how you organize your notes, allowing them to appear in multiple "virtual" folders without physical duplication.

### Linking Notes

The core of Abstract Folder relies on frontmatter properties in your notes:

*   **Parent-Child Relationships (Default)**: To make a note a child of an abstract folder (another note), add the `parent` frontmatter property to the child note, linking it to the parent note. For example:
    ```yaml
    ---
    parent: "[[My Parent Note]]"
    ---
    ```
    You can specify multiple parents as an array:
    ```yaml
    ---
    parent:
      - "[[My First Parent]]"
      - "[[My Second Parent]]"
    ---
    ```
*   **Parent-Defined Children (for non-Markdown files)**: For files like Canvas (`.canvas`), Excalidraw (`.excalidraw`), or other file types that do not support frontmatter, you can define their children directly within a parent Markdown note. Add the `children` frontmatter property to the parent note:
    ```yaml
    ---
    children:
      - "[[My Canvas File.canvas]]"
      - "[[Another Non-Markdown.txt|Display Name]]"
    ---
    ```

### Command Palette

All primary functions of Abstract Folder are accessible via the Obsidian Command Palette (Ctrl/Cmd+P). Search for "Abstract Folder" to see a list of available commands:

*   **Open Abstract Folder View**: Opens the main plugin view in a new pane.
*   **Create Abstract Child**: Creates a new note or canvas file and assigns it as a child to a selected abstract folder.
*   **Convert folder structure to plugin format**: Transforms an existing physical folder structure into abstract folders based on your settings.
*   **Create folder structure from plugin format**: Generates a physical folder structure from your abstract folder hierarchy, with options for conflict resolution.

### Settings

To customize the plugin's behavior, go to **Settings → Abstract Folder**. Here you can:

*   Change the default `parent` and `children` property names.
*   Adjust view styles (tree or column).
*   Configure sorting options.
*   Set startup behavior (e.g., open view on startup).
*   Manage excluded paths and indentation guides.

## Features

*   **Poly-Hierarchical Structure:** Notes can have multiple parents using the `parent` frontmatter setting (default: `parent`).
*   **Ghost Node Display:** The same note appears in all its abstract folders within the plugin's UI.
*   **Folder Note Function:** Any note can act as an abstract "folder" for its children.
*   **Custom Tree & Column Views:** Replaces or augments the native Obsidian file explorer with interactive views.
*   **Frontmatter Moves:** Notes are moved by editing their `parent` property; no file system operations needed.
*   **Right-Click Menu:** Full context menu, with actions like hiding notes, renaming, deleting, and creating new child notes.
*   **Icons:** Supports setting icons.
*   **Parent-Defined Children:** Children can also be listed directly in a parent note's frontmatter.
*   **Conversion Tools:** Tools convert physical folders to abstract folders, and vice-versa (with preview).
*   **Non-Frontmatter File Support:** Supports files without frontmatter (e.g., Excalidraw, Canvas) using parent-defined children.
*   **Dynamic Sorting:** Abstract folders and notes can be sorted by name or modification time.
*   **Settings:** Customizable parent properties, aliases, auto-reveal active file, startup options, view styles, indentation guides, expanded folder memory, and excluded paths.

## Installation

1.  Open **Settings → Community plugins** in Obsidian.
2.  Disable **Safe mode**.
3.  Click **Browse** and search for "Abstract Folder".
4.  Click **Install**.
5.  Once installed, **Enable** the plugin.

## Disclosures

This plugin operates entirely locally and offline. It does not collect any telemetry, make network requests, or access files outside of your Obsidian vault.

## Compatibility

Abstract Folders works with Obsidian on desktop and mobile platforms.
