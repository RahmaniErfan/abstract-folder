# Abstract Folders Plugin

Tagline: Eliminate folder rigidity. Give your notes multiple homes.

## Core Value Proposition

The Abstract Folders Plugin for Obsidian transforms your note organization by moving beyond traditional, rigid folder structures. It introduces an abstract, poly-hierarchical system that allows notes to exist in multiple contexts simultaneously, preventing duplication and fostering a more intuitive, context-rich navigation experience. This plugin resolves classification paralysis and promotes a fluid, dynamic workflow.

## The Problem with Rigid Folders

Traditional file systems, and by extension Obsidian's native folder structure, enforce a rigid, single hierarchy. This creates significant challenges when a note naturally belongs to multiple contexts. For instance, a meeting log might be relevant to a specific project, a client, and a date. In a rigid system, this often leads to:

*   **Classification Paralysis:** The constant struggle to determine the single "correct" location for a note, impeding thought processes and content creation.
*   **File Duplication:** The necessity of creating multiple copies of the same note in different folders to align with various contexts, resulting in dispersed information and increased maintenance overhead.
*   **Loss of Context:** Notes isolated within a single folder can lose their broader relevance, complicating the discovery of related information.

## The Solution: Abstract Folder Notes

The Abstract Folders Plugin addresses these limitations by abstracting the folder concept. It utilizes a configurable `parent` frontmatter property in your markdown files. This mechanism enables a **Poly-Hierarchy**, where:

*   **Notes can have multiple parents:** A single note can seamlessly appear under different "abstract folders" (referred to as ghost nodes) without physical duplication.
*   **Folder Notes transform organization:** The "parent" file itself functions as a writeable folder index or dashboard, allowing for embedding context, summaries, or related information directly within your organizational structure.

This approach delivers significant benefits:

*   **Eliminates Classification Paralysis (Poly-Hierarchy, Zero Duplication):** Assign notes to all relevant contexts without the need for single categorization or redundant copies.
*   **Enhanced Context and Navigability (Folder Notes, Custom Tree Views):** Gain deeper insight into your notes through contextual "folder" pages and navigate your information space in a manner that aligns with your mental models.
*   **Focus & Fluid Workflow (Simple Frontmatter Reorganization, Fast Creation Flow):** Reorganize notes with a straightforward frontmatter edit. Create new notes and assign parents efficiently, maintaining workflow continuity.

## Key Features and Supported Functionality

The Abstract Folders Plugin provides a comprehensive suite of features for managing your abstract note hierarchy:

*   **Poly-Hierarchical Structure:** A single note can be associated with multiple parents via a configurable frontmatter property (default: `parent`). This enables notes to appear in multiple "folders" simultaneously without duplication.
*   **Ghost Node Rendering:** The same file is visibly rendered and interactable from multiple distinct locations within the custom folder tree UI, accurately reflecting its poly-hierarchical relationships.
*   **Folder Note Utilization:** Any note can serve as an abstract "folder" for its children. This transforms parent notes into dynamic, writeable index pages or dashboards for their linked notes.
*   **Custom Tree View:** The plugin replaces or augments the existing Obsidian file explorer sidebar with a custom, interactive view that renders your abstract, poly-hierarchical structure.
*   **Column View:** An alternative column-based view offers a distinct method for navigating the hierarchy, similar to column views found in other file browsers.
*   **Frontmatter-based Reorganization:** Modifying a note's `parent` frontmatter property facilitates its reorganization, bypassing traditional file system move operations.
*   **Right-Click Menu Support:** The custom view fully supports standard Obsidian right-click context menu functions, in addition to specialized actions for abstract folders:
    *   Open note in new tab, split pane, or new window.
    *   Hide/Unhide notes by setting a "hidden" parent property, placing them under a special "Hidden" root folder.
    *   Rename and Delete notes directly from the view.
    *   Set/Change custom icons for notes.
    *   Create Abstract Child Note, Canvas, or Base file types (for both parented and root items).
    *   Multi-select functionality with support for batch deletion of multiple items.
    *   Integration with native Obsidian file context menu actions.
*   **Parent-Defined Children:** In addition to child-defined `parent` properties, parent notes can explicitly define `children` in their frontmatter, providing an alternative method for establishing relationships.
*   **Conversion Utility (Folder to Plugin):** A feature to convert existing physical folder structures into the plugin's abstract format. This utility includes options for creating parent notes and managing existing relationships, ensuring a smooth migration of your vault.
*   **Conversion Utility (Plugin to Folder):** A feature to convert the abstract structure back into physical folders. This is crucial for external compatibility, operating system compliance, or exporting vault content. It includes a simulation mode for previewing changes and resolving potential file conflicts.
*   **Non-Frontmatter File Support:** The plugin explicitly supports file types that may not have frontmatter (e.g., Excalidraw, Canvas files) by respecting parent-defined children relationships, ensuring these files remain integrated into the abstract structure.
*   **Dynamic Sorting:** Sort your abstract folders and notes directly within the view by name (ascending/descending) or modification time (oldest/newest).

## Settings and Compatibility

The Abstract Folders Plugin offers a comprehensive set of configurable options to customize your experience:

*   **Configurable Parent Properties:** Define the frontmatter property names used for `parent` and `children` relationships.
*   **Show Aliases:** Display the first alias from a note's frontmatter as its name in the view, instead of the filename.
*   **Auto-Reveal Active File:** Automatically expand the abstract folder hierarchy to reveal the currently active note.
*   **Startup Open:** Configure the plugin view to open automatically when Obsidian loads.
*   **Open Side:** Choose to open the view in either the left or right sidebar.
*   **Show Ribbon Icon:** Toggle the visibility of the plugin's ribbon icon.
*   **Rainbow Indentation Guides:** Enable visually distinctive rainbow indentation guides in the tree view with classic, pastel, or neon color palettes.
*   **View Style:** Switch between "Tree" and "Column" view styles.
*   **Remember Expanded Folders:** Persist the expanded/collapsed state of abstract folders across Obsidian sessions.
*   **Excluded Paths:** Define specific paths to exclude from the abstract folder view (e.g., export folders, attachment directories).

The Abstract Folders Plugin is designed for compatibility with Obsidian on both desktop and mobile platforms, with `isDesktopOnly` set where desktop-specific APIs are utilized.

## Future Roadmap

*   Further enhancements to navigation, potentially including contextual sibling navigation within a specific parent's children.
*   Performance optimizations for very large vaults with complex hierarchies.
*   Advanced query-based abstract folder creation.

## Installation

1.  **Disable Restricted Mode:** In Obsidian, navigate to **Settings → Community plugins** and ensure "Restricted mode" is turned off.
2.  **Browse Community Plugins:** Click "Browse" under "Community plugins" and search for "Abstract Folders".
3.  **Install and Enable:** Click "Install" and then "Enable" the plugin.
4.  **Access the View:** A folder-tree icon will appear in your ribbon sidebar (left or right, configurable in settings) to open the view. Alternatively, use the command palette (`Ctrl/Cmd+P`) and search for "Open Abstract Folder View".

---
*Features Confirmed via Code/Commit Review:*
*   Poly-Hierarchical Structure (`src/indexer.ts`)
*   Ghost Node Rendering (`src/view.ts`, `src/ui/tree/tree-renderer.ts` - indirectly by multi-parent handling in indexer)
*   Folder Note Utilization (`src/file-operations.ts` via `createAbstractChildFile`, `src/conversion.ts` via `convertFoldersToPluginFormat`)
*   Custom Tree View (`src/view.ts`)
*   Frontmatter-based Reorganization (`src/indexer.ts` processes frontmatter changes)
*   Right-Click Menu Support (`src/ui/context-menu.ts`)
*   Conversion Utility (`src/conversion.ts`, `main.ts` commands)
*   Non-Frontmatter Support (`src/indexer.ts` resolves links for non-MD files as children)
*   Settings (Expanded Folders, Visuals) (`src/settings.ts`, `src/ui/settings-tab.ts`, `src/view.ts`)

*Features Requiring Assumption due to lack of explicit detail in reviewed code/commits:*
*   Contextual Sibling Navigation (no explicit implementation found for "Next/Previous note within context" during search)
