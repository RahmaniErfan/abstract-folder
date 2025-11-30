# Abstract Folder
Your support is appreciated c:

[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal)](https://www.paypal.com/paypalme/airfunn)
[![Donate via Wise](https://img.shields.io/badge/Donate-Wise-00BF8D?style=for-the-badge&logo=wise)](https://wise.com/pay/me/erfanr47)

## What it does

Manages your vault with virtual folders for note organization.

## Main Features

*   Virtual Folders: Organize notes into virtual folders without changing their physical file location.
*   Multiple Parents: A note can belong to several abstract folders by defining multiple parent notes.
*   Parent-Defined Children: Include non-Markdown files (like Canvas or Excalidraw) as children by listing them in a parent note's frontmatter.
*   Conversion Tools: Convert physical folder structures to abstract folders, and vice-versa, with previews.
*   Custom Views: Navigate your abstract folder hierarchy using interactive Tree and Column views.
*   Frontmatter Organization: Manage note relationships by editing frontmatter properties.

## Detailed Features

*   Multiple Parents: Notes can have multiple parents using the `parent` frontmatter property (default: `parent`).
*   Ghost Node Display: A note appears in all its abstract folders within the plugin's UI.
*   Folder Note Function: Any note can act as an abstract "folder" for its children.
*   Custom Tree & Column Views: Replaces or extends the native Obsidian file explorer with interactive views.
*   Frontmatter Moves: Notes are moved by editing their `parent` property, no file system operations needed.
*   Right-Click Menu: Full context menu for actions like hiding notes, renaming, deleting, and creating new child notes.
*   Hide Notes: Ability to hide specific notes from the abstract folder view without deleting them.
*   Icons: Supports setting icons for notes and folders.
*   Parent-Defined Children: Children can be listed directly in a parent note's frontmatter, supporting non-Markdown files.
*   Conversion Tools: Convert physical folders to abstract folders, and vice-versa (with preview).
*   Non-Frontmatter File Support: Supports files without frontmatter (e.g., Excalidraw, Canvas) via parent-defined children.
*   Sorting: Abstract folders and notes can be sorted by name or modification time.
*   Settings: Customizable parent properties, aliases, auto-reveal active file, startup options, view styles, indentation guides, expanded folder memory, and excluded paths.

## Usage

Abstract Folder helps organize notes, allowing them to appear in multiple "virtual" folders without physical duplication.

### Linking Notes

Abstract Folder uses frontmatter properties in your notes:

*   Parent-Child Relationships (Default): To make a note a child of an abstract folder (another note), add the `parent` frontmatter property to the child note, linking it to the parent note. For example:
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
    **Tip:** To allow `parent` or `children` properties to accept multiple values, change their property type to "List" by clicking the property icon in Obsidian's Properties view.

*   Parent-Defined Children (for non-Markdown files): For files like Canvas (`.canvas`), Excalidraw (`.excalidraw`), or other file types without frontmatter, you can define their children directly within a parent Markdown note. Add the `children` frontmatter property to the parent note:
    ```yaml
    ---
    children:
      - "[[My Canvas File.canvas]]"
      - "[[Another Non-Markdown.txt|Display Name]]"
    ---
    ```

### Command Palette

All primary functions of Abstract Folder are available via the Obsidian Command Palette (Ctrl/Cmd+P). Search for "Abstract Folder" to see commands:

*   Open Abstract Folder View: Opens the plugin view in a new pane.
*   Create Abstract Child: Creates a new note or canvas file and assigns it as a child to a selected abstract folder.
*   Convert folder structure to plugin format: Transforms existing physical folder structure into abstract folders based on your settings.
*   Create folder structure from plugin format: Generates a physical folder structure from your abstract folder hierarchy, with conflict resolution options.

### Settings

To customize the plugin, go to **Settings → Abstract Folder**. Here you can:

*   Change the default `parent` and `children` property names.
*   Adjust view styles (tree or column).
*   Configure sorting options.
*   Set startup behavior (e.g., open view on startup).
*   Manage excluded paths and indentation guides.

## Installation

1.  Open **Settings → Community plugins** in Obsidian.
2.  Disable **Safe mode**.
3.  Click **Browse** and search for "Abstract Folder".
4.  Click **Install**.
5.  Once installed, **Enable** the plugin.

## Disclosures

This plugin operates locally and offline. It does not collect telemetry, make network requests, or access files outside of your Obsidian vault.

## Compatibility

Abstract Folders works with Obsidian on desktop and mobile platforms.
