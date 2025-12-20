# Changelog

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

## Version 1.4.0

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