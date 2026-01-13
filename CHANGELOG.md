# Changelog

## Version 1.13.2

**UI Customization:**
*   **Toolbar Button Toggling**: Added settings to individually show/hide any of the 10 toolbar buttons (View Style, Focus Active File, Search, Conversion, Collapse All, Expand All, Sort, Filter, Group, and Create Note).
*   **Search Bar Toggling**: Added a setting to hide the search bar at the top of the tree view.
*   **Reactive UI**: All visual toggles apply immediately to the view without requiring a plugin reload.
*   **Minimalist Layout**: The toolbar separator (bottom border) now automatically hides when all toolbar buttons are turned off.

## Version 1.13.1

**UI Improvements:**
*   **Context Menu Reorganization**: Plugin-specific actions (Focus, Hide/Unhide, Set Icon, Creation, and Delete) are now grouped together and positioned at the very top of the right-click menu.
*   **Improved Clarity**: Refined the titles of abstract child creation items to explicitly mention the parent context (e.g., "Create child note in [Parent]").
*   **Visual Consistency**: Ensured the custom DOM-based context menu is used to preserve command icons and follow Obsidian's native look and feel.
*   **Exclusive View States**: Implemented strict mutual exclusion between Search and Groups. Activating one now automatically clears the other, ensuring search results are never filtered by a group and that group titles never appear during a search.
*   **Predictable Resets**: Clearing a search now also cleanses any group state activated during that search, returning the view to a consistent, full-vault state.

## Version 1.12.0

**Features:**
*   **Jump to Search Bar**: Added a command and toolbar action to quickly focus the search bar.
*   **Clear Active Group**: New command to instantly clear the active group filter.
*   **Create Group with Active File**: New command to instantly create a virtual group using the currently active file as the root parent. It opens the group creation modal with the active file pre-filled as a root parent, allowing you to customize the name before saving.
    *   **Global Command**: Added "Focus search bar in abstract tree" to the command palette.
    *   **Toolbar Integration**: Added a search icon (🔍) to the toolbar for mouse-driven access.
    *   **Automatic View Switching**: Automatically switches from Column mode to Tree mode when searching, as search is optimized for the hierarchical tree layout.

## Version 1.11.0

**Features:**
*   **Focus Active File**: Introduced a new feature to focus on a specific file in the tree view. Focusing filters the view to show only the selected file's ancestry and/or children, integrated with existing search settings.
    *   **Toolbar Integration**: Added a "Target" icon (🎯) to the toolbar for quick toggling of focus on the active file.
    *   **Context Menu**: Added "Focus this file" option to the right-click menu for any item in the tree.
    *   **Global Command**: Added "Toggle focus on active file in abstract tree" command for keyboard accessibility.
    *   **Intelligent Switching**: Automatically switches the view from Column mode to Tree mode when focusing to ensure the focused hierarchy is clearly visible.

## Version 1.10.6

**Maintenance:**
*   **Linter Compliance**: Resolved all issues reported by the automated plugin scan, including fixing floating promises, adding required descriptions to `@ts-ignore` comments, and ensuring UI text follows sentence case guidelines.
*   **Code Refactoring**: Improved type safety in the path suggestion system and converted several async methods without `await` expressions to synchronous versions for better performance and compliance.
*   **Cleanup**: Removed redundant and non-instructive comments across the codebase to improve maintainability while keeping essential architectural documentation.

## Version 1.10.5

**Features:**
*   **Search Result Highlighting**: Search results are now temporarily highlighted to make them easier to spot. The highlight fades out smoothly after a few seconds.

**Fixes:**
*   **Search Interactions**: Disabled folder collapse/expand interactions during search to prevent view instability.
*   **Visual Polish**: Fixed minor visual issues with indent guides and duplicate entries in search mode.

## Version 1.10.4

**Fixes:**
*   **Active File Highlighting**: Fixed a critical issue where the currently active file was not being highlighted in the tree view if the folder structure was already expanded.
*   **Virtual Scroll Positioning**: Implemented precise scrolling to the active file's location within the virtual list, replacing unreliable DOM-based scrolling.
*   **Performance**: Optimized the file reveal process to avoid unnecessary full re-renders when navigating between files that are already visible.

**Features:**
*   **Scroll to Active File Setting**: Added a new setting to toggle automatic scrolling to the active file when it is opened.

## Version 1.10.3

**Fixes:**
*   **UI Layout**: Fixed an issue where the group title would appear above the search bar, obscuring the view. The layout is now correctly ordered (Search -> Group Title) and the title flows naturally in the document.
*   **Code Cleanup**: Removed unused variables in file operation utilities.

## Version 1.10.2

- **Refactor**: Relationship resolution now uses Obsidian's native `frontmatterLinks` API.
  - Improves compatibility with all standard Obsidian link formats (WikiLinks `[[...]]`, Markdown links `[...](...)`, relative/absolute/shortest paths).
  - Removes support for undocumented/non-standard "bare paths" (plain text paths without brackets) in frontmatter properties.
  - Fixes an issue where list properties (e.g., `Parent: - [[Link]]`) were sometimes ignored.

## Version 1.10.1

**Features:**
*   **Open in New Tab**: Added support for opening files in a new tab using middle-click.

## Version 1.10.0

**Features:**
*   **Fuzzy Search**: Implemented fuzzy search functionality with typo tolerance using Obsidian's native `prepareFuzzySearch`.
    *   **Relevance Scoring**: Search results are now ranked by relevance score, prioritizing better matches.
    *   **Parent Resolution**: Added a fallback mechanism to correctly identify and display parent context for non-markdown files (e.g., images, PDFs) that are declared as children in parent notes but cannot define their own parents via frontmatter.

**Fixes:**
*   **Search**: Fixed an issue where search results within collapsed folders were hidden. The view now temporarily expands the necessary ancestry to reveal matches.
*   **Search UI**:
    *   Prevented search suggestions from appearing when the input field is empty.
    *   Ensured the "clear" button correctly resets the view state.
    *   Added context toggles (parents/children) to the search bar for better control over results.
    *   Prioritized exact matches in search results.

**Code Quality & Architecture:**
*   **CSS Modules**: Refactored the monolithic `styles.css` into modular files within `src/styles/*.css` for improved maintainability. The build pipeline now automatically bundles these into a single `styles.css` artifact.

## Version 1.9.2

**Features:**
*   **Column View Expansion**: Added a left-side chevron icon to folder items in Column View, allowing you to expand folders without opening the associated note.
*   **UI Refinement**: Removed the redundant right-side folder indicator in Column View for a cleaner, tree-consistent layout.

## Version 1.9.1

**Fixes:**
*   **Collapse/Expand Buttons**: Fixed an issue where the "Collapse all" and "Expand all" buttons in the toolbar were not working correctly. They now properly update the internal state and re-render the view to reflect the changes.

## Version 1.9.0

**Features:**
*   **Custom Display Name Priority**: You can now define a prioritized list of properties to use for the display name in the abstract view.
    *   **Flexible Fallbacks**: Set the order of priority, e.g., `title, aliases, basename`.
    *   **Custom Properties**: Use any frontmatter property (like `title` or `dogbutt`) as a display name.
    *   **Special Keywords**: Use `aliases` for the first alias and `basename` for the original filename.
*   **Organized Settings**: Reorganized the settings tab into clearer sections (Properties, Display Name, Behavior, Startup & Layout).

## Version 1.8.0

**Features:**
*   **Custom Date Properties for Sorting**: You can now specify custom frontmatter properties (comma-separated) for "Created time" and "Modified time".
    *   **Manual Control**: Override unreliable file system timestamps with your own managed properties.
    *   **Flexible Formats**: Supports Date objects, ISO strings, and Unix timestamps in frontmatter.
    *   **Fallbacks**: Automatically falls back to system `ctime`/`mtime` if custom properties are missing or invalid.
*   **New Sorting Option**: Added "Created time" as a sorting method in the toolbar and sorting modals.

**Code Quality & Architecture:**
*   **Modular Sorting**: Extracted sorting logic into a dedicated `src/utils/sorting.ts` utility for better maintainability.
*   **Cleanup**: Removed redundant code and improved type safety for sorting operations.

## Version 1.7.0

**Features:**
*   **File Type Filtering**: Introduced a new filtering system to hide specific file types (extensions) from the view.
    *   **Toolbar Integration**: Added a filter button with quick presets for hiding/showing images and canvas files.
    *   **Global & Per-Group Config**: Manage default exclusion lists or set specific filters for individual groups via the new "Manage default filtering" modal.
    *   **Multi-View Support**: Filters are applied consistently across both Tree and Column view styles.

**Code Quality & Architecture:**
*   **Modularization**: Significantly refactored the core UI logic for better maintainability and performance.
    *   Extracted virtual scroll and tree generation into `VirtualTreeManager`.
    *   Moved view and toolbar components into dedicated `src/ui/view` and `src/ui/toolbar` directories.
    *   Improved type safety across toolbar menus and event handlers.


## Version 1.6.8

*   **UI:**
    *  Added plugin name as tab title

## Version 1.6.7

**Fixes:**
*   **Toolbar Isolation & UI Refinement**:
    *   Moved the toolbar from the shared Obsidian header into the internal view content to prevent interference from other plugins (e.g., Commander).
    *   Completely disabled the native view header for a cleaner, dedicated UI.
    *   Refined the layout hierarchy: Toolbar is now at the absolute top, followed by the group title.
    *   Improved spacing: Removed extra top padding and synchronized side/bottom padding (12px) for better visual balance.
    *   Inverted toolbar button order for improved ergonomics (Switch View Style first, Create Root Note last).

## Version 1.6.4

**Improvements:**
*   **Enhanced Group Management UI**: The active group is now significantly more visible with a primary-colored indicator dot, highlighted row, and semi-bold text.
*   **Intuitive Activation**: Removed the activation/deactivation buttons in favor of making the entire group row clickable. Added instructions in the modal to guide users.
*   **Clarity in Group Creation**: Updated the group creation/edit modal to explicitly state that "parent notes" (.md files) should be added to define roots, providing better guidance and path placeholders.
*   **Visual Refinement**: Added consistent borders and hover effects to group items in the management modal for a more "button-like" feel.

## Version 1.6.3

**Performance Optimization:**
*   **Lazy Column Rendering**: Dramatically improved view switching performance. Switching from Tree to Column view is now instantaneous even in massive vaults, thanks to a new asynchronous batch rendering strategy.
*   **Faster Drag-and-Drop**: Optimized the circular dependency check in drag-and-drop operations using an iterative BFS algorithm, eliminating UI freezes when moving items in large, complex graphs.
*   **Surgical DOM Updates**: Refined the view rendering logic to preserve stable containers and reduce layout thrashing, resulting in smoother transitions and more reliable loading states.

## Version 1.6.1

**Features:**
*   **Conversion Progress Tracking**: Added a visual progress tracker when converting large folders to the abstract structure, providing real-time feedback and preventing UI freezes.

**Fixes:**
*   **UI Stability during Conversion**: Refactored the folder conversion process to yield to the main thread, ensuring the application remains responsive even when processing thousands of files.
*   **Post-Conversion Glitches**: Fixed an issue where files would seemingly disappear or the view would turn white after conversion by robustly re-initializing virtual scroll components and allowing the indexer time to settle.

## Version 1.6.0

**Features:**
*   **Default Sorting Management**: Introduced a new "Manage default sorting" modal accessible from the sort menu. This allows you to set a persistent default sort order for the main view and for each individual group.
*   **Per-Group Sorting**: Groups can now have their own independent sort preferences, which are automatically applied when you switch to that group.

## Version 1.5.0

**Features:**
*   **Advanced Sorting (Thermal, Stale Rot, Gravity)**: Introduced a suite of smart sorting methods that reflect real-world note interaction patterns.
    *   **Thermal (Hotness)**: Surfaces active notes using an exponential decay logic (20% per day). Heat increases when notes are opened or modified.
    *   **Stale Rot**: Identifies abandoned complex ideas by multiplying inactivity duration by the number of children.
    *   **Gravity (Payload)**: Linear sorting based on recursive descendant count, highlighting the densest hubs in your vault.
*   **Smart Icons**: Added descriptive icons (flame, skull, weight) to the sort menu for better visual clarity.

## Version 1.4.1

**Fixes:**
*   **Incremental Graph Updates**: Fixed a bug where removing a recursive parent link (a file being its own parent) did not correctly restore the file to the view. This was due to the incremental update logic using cached relationship data instead of the latest state during removal checks.
*   **View Switching**: Fixed an issue where the Abstract Tree view would disappear after switching from Column View (Miller View). This was caused by the view container being incorrectly emptied, destroying stable DOM elements required for virtual scrolling.

## Version 1.4.090

**Performance Optimization (Major):**
*   **Incremental Graph Updates**: The plugin now intelligently updates only the parts of the abstract folder structure that have changed when you edit file frontmatter, rather than rebuilding the entire structure. This reduces processing time from ~500ms to ~2ms for large vaults (35k+ files), eliminating lag during editing.
*   **Lazy Loading & Virtual Scrolling**: The Abstract Folder view now uses lazy loading and virtual scrolling, enabling it to handle massive vaults with tens of thousands of files instantly without UI freezing or crashing.
*   **Optimized Rendering**: Opening and closing folders in the tree view is now near-instantaneous due to improved caching and DOM diffing.

**Improvements:**
*   **Loading State**: Added a visual "Loading abstract structure..." indicator to provide feedback during initial startup or graph rebuilds, replacing the confusing "No folders found" message.
*   **Code Cleanup**: Removed internal benchmark logging for a cleaner console experience.

## Synced Folder Branch (Experimental)

**Features:**
*   **Synced Folders**: You can now link an abstract folder to a physical folder on your disk. Files created in or moved to the physical folder will automatically be linked to the abstract folder, and vice-versa.
    *   **Auto-Linking**: Moving files into a synced physical folder automatically adds them to the abstract folder.
    *   **Non-Markdown Support**: Works with all file types, including Canvas files and images.

**Improvements:**
*   **Refined UI Input**: The file input suggestions in `CreateSyncedFolderModal` and `CreateEditGroupModal` now correctly display only files when selecting abstract parents, improving clarity and usability.

**Fixes:**
*   **Ambiguity Resolution**: Synced folders now use full-path links when auto-linking files. This prevents issues where duplicate filenames (e.g., in the root and a subfolder) could cause the abstract view to open the wrong file.
*   **Renaming Stability**: Fixed an issue where renaming files during a move (or Obsidian's auto-renaming) could cause them to be unlinked from the abstract folder.
*   **Reliable Linking**: Improved the way links are created for non-markdown files to ensure they persist correctly even when files are moved around.

## Version 1.3.9

**Code Quality & Maintenance:**
*   **ESLint Compliance**: Resolved all ESLint issues reported by the automated plugin scan, including fixing floating promises, removing unnecessary `eslint-disable` comments, and ensuring type safety with explicit casting and improved interfaces.
*   **UI Text Improvements**: Updated various UI labels and descriptions to strictly follow sentence case guidelines (e.g., "Sort by name (ascending)", "Example: star, folder-tree").
*   **Performance & Stability**: Fixed potential issues with unhandled promises in drag-and-drop handlers and view activation.

## Version 1.3.7

**Fixes:**
*   **Conversion adding unidirectional relationship for md files**: Fixed an issue where converted markdown files were being bi-directionally linked in both parent and child frontmatter, instead of just the child's `parent` property.
*   **Empty Group View**: Fixed a bug where creating a group using a folder path (e.g., `University`) would result in an empty view if the abstract folder was defined by a file (e.g., `University.md`). The view now correctly resolves the underlying file for the folder path.

## Version 1.3.6

**Features:**
*   **Additive Drag-and-Drop (Ctrl/Alt + Drag)**: Holding `Ctrl` or `Alt` during a drag-and-drop operation will now perform an "additive" action instead of a move.
    *   For Markdown files, the dropped file will add the target folder as an additional parent, without removing existing parent links.
    *   For non-Markdown files, the dropped file will be added to the target parent's `children` property, without being removed from its original parent. This allows a file to exist under multiple abstract folders.

## Version 1.3.0

## Version 1.3.1

**Fixes:**
*   **File creation not reflected**: Implemented a `vault.on('create')` event listener to ensure that manually added files or screenshots are immediately reflected in the abstract folder view.

## Version 1.3.0

**Features:**
*   **Drag-and-Drop File Management**: Implemented drag-and-drop functionality for abstract folders, allowing intuitive reorganization of notes.

**Fixes:**
*   **Parent Inversion during Drag**: Resolved an issue where dragging a child note could unintentionally re-parent an ancestor due to event bubbling. This was fixed by preventing event propagation during drag start.
*   **Duplicate Parent Links**: Fixed a bug where files appeared under multiple parents after drag-and-drop if the original parent link was not precisely matched. The logic now uses Obsidian's `metadataCache` to robustly resolve and remove old parent links.
*   **Persisting Drag Outline**: Corrected an issue where the drag-and-drop visual outline would remain on invalid drop targets. Cleanup logic was enhanced to ensure all drag feedback is removed reliably.
*   **UI Flicker on Drag**: Addressed visual flickering during drag operations by switching from CSS `border` to `outline` for drag feedback, preventing layout shifts.
*   **Overly Bright Invalid Drag Feedback**: Adjusted the visual feedback for invalid drop targets to use a softer, less intrusive red color.

**Improvements:**
*   **Drag-and-Drop Validation**: Enhanced validation to prevent dropping files into non-Markdown files and to disallow circular dependencies.

## Version 1.2.7
*   **Abstract Child Creation for Canvas/Bases**: Resolved an issue where creating abstract child files for Canvas (.canvas) and Bases (.base) resulted in root files or JSON parsing errors. This was fixed by no longer attempting to add frontmatter to these JSON-based files. Instead, when a parent file (which must be a Markdown note) is specified, the new Canvas or Base file is added to the parent's `children` frontmatter property, including its full filename and extension (e.g., `[[my_canvas.canvas]]`), allowing the plugin's indexer to correctly establish the parent-child relationship.

## Version 1.2.6

**Fixes:**
*   **Multi-Parent Auto-Expansion**: Resolved an issue where typing in a note with multiple abstract parents would cause all parent chains to expand simultaneously. This was fixed by modifying the `revealFile` function in `src/file-reveal-manager.ts` to ensure parent expansion is applied only to the first DOM element representing the active file, preventing unintended multiple expansions.

## Version 1.2.5

**Features:**
*   **Auto Expand Children Toggle**: Implemented toggle-like behavior for auto-expanding children. Clicking a parent file or folder when 'Auto expand children' is enabled will now expand it if collapsed, or collapse it if expanded. Files will still open regardless of expansion state.

## Version 1.2.4

**Features:**
*   **Auto Expand Children**: Added a new setting to automatically expand direct child folders when a parent file is opened in the tree view.

## Version 1.2.3

**Fixes:**
*   **Settings Duplication**: Removed duplicate "Rainbow indent - varied item colors" setting from the settings tab.

## Version 1.2.2

**Features:**
*   **Toggle Parent Folder Expansion**: Introduced a new setting to allow users to disable automatic expansion of parent folders when revealing the active file.

**Improvements:**
*   **Streamlined File Revelation**: Removed the "Auto reveal active files" setting, making highlighting the active file a default behavior.

## Version 1.2.1

**Fixes:**
*   **PDF Opening**: Resolved issue where PDFs would open in a split view instead of the current active pane.

## Version 1.2.0

**Features:**
*   **Recursive Delete**: Added "Delete children" functionality to single and batch file deletion modals, enabling recursive deletion of associated child notes and folders.

**Improvements:**
*   **Optimized Graph Updates**: Refined graph update triggers for improved robustness during file deletion operations.

## Version 1.1.1

**Fixes:**
*   **Trailing Spaces in Filenames**: Resolved issues with links to and creation of files with trailing spaces in their names.

## Version 1.1.0

**Features:**
*   **Group View**: Added a "Group View" to organize abstract folders into custom groups.
*   **Group Management**: Added commands for creating, editing, and assigning notes to groups.
*   **Cascade Delete Child References**: Automatically removes references to deleted child files from parent frontmatter.
*   **Abstract Child Management**:
    *   **Alias Quoting**: Ensures aliases in new abstract child files are quoted (e.g., `aliases: - "1"`) to prevent warnings.
    *   **Unidirectional Parent Linking**: Only the new child file is updated with a parent reference. Parent files no longer automatically link to new children.

**Improvements:**
*   **View Overhaul**: Abstract folder view refactored with a new header for better user experience.
*   **Column View Styles**: Improved styling for column view, with clearer indicators for selected items, ancestors, and abstract folders.
*   **README Refactor**: The `README.md` has been refactored to make it more straightforward and easier to understand.
*   **Multi-Parent Indicator**: Added a visual indicator for notes with multiple parents.
*   **File Type Tags**: Added subtle tags to differentiate file types in the view.
*   **Modal Styling**: Improved styling for plugin modals (e.g., conflict resolution, icon selection).

**Refactoring & Code Quality:**
*   **Modularization**: Core view logic (`src/view.ts`) split into smaller modules and UI components.
*   **File Relocation**: Utility files (`conversion.ts`, `file-operations.ts`, `tree-utils.ts`) moved to `src/utils`.
*   **CSS Management**: `styles.css` is now treated as a build artifact.