# Changelog

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