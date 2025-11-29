# Design and Implementation Plan: Folder and Plugin Format Conversion

This document outlines the architecture and plan for two key features:
1.  **Folder to Plugin:** A tool to convert an existing folder structure into the plugin's parent-child relationship format.
2.  **Plugin to Folder:** A tool to generate a folder structure based on the plugin's internal parent-child relationships.

## 1. Feature: Folder Structure to Plugin Format

### 1.1. Core Logic

The primary goal is to traverse the user's vault folder structure and create parent-child relationships in the plugin's data format.

- **Input:** A starting folder selected by the user.
- **Process:**
    1.  Recursively scan the selected folder and its subfolders.
    2.  For each folder, identify the files and subfolders it contains.
    3.  For each file (`child.md`) inside a folder (`ParentFolder`), establish a "parent-child" relationship. Since the plugin uses files to represent everything, the `ParentFolder` needs a corresponding file, likely `ParentFolder.md`. If it doesn't exist, we may need to create it or ask the user how to handle it.
    4.  Files that are not `.md` or `.canvas` (e.g., images) will be handled as children of their containing folder's corresponding note.
- **Output:** The plugin's internal data structure (e.g., modifications to `data.json` or frontmatter) will be updated to reflect these new relationships.

### 1.2. Relationship Representation

The relationship will be stored as a direct link from parent to child. Given a folder `A` containing a file `B.md`, the plugin will represent this as `A.md` is a parent of `B.md`.

For non-markdown files like `Image.png` in folder `A`, the relationship will be `A.md` -> `Image.png`. This is consistent with the "child" feature for bases and canvases.

### 1.3. Duplication and Conflict Handling

This process is relatively safe as it only reads the folder structure and modifies the plugin's data. It doesn't move or delete files.

- **Existing Relationships:** If a file already has parents defined, the user should be asked whether to **append** the new parent from the folder structure or **replace** the existing parents. Append will be the default.

---

## 2. Feature: Plugin Format to Folder Structure

### 2.1. Core Logic

This feature generates a conventional folder structure based on the parent-child relationships defined within the plugin.

- **Input:** A target root folder for the generated structure.
- **Process:**
    1.  Read the plugin's relationship data.
    2.  For each parent-child link (`A.md` -> `B.md`), translate this to a folder structure: `<target-root>/A/B.md`.
    3.  The process will be simulated first, presenting the user with a preview of the final folder structure.
    4.  Upon user confirmation, the tool will create the folders and either move or copy the files.

### 2.2. Duplication and Conflict Handling

This is the more complex scenario, as a file can have multiple parents in the plugin's format.

- **Scenario:** `FileC.md` has two parents, `ParentA.md` and `ParentB.md`.
- **User Choice:** When this conflict is detected, the user must be prompted with options:
    1.  **Duplicate the file:** Create a copy of `FileC.md` in both `ParentA/` and `ParentB/`. This is the safest default to avoid data loss and preserve both organizational contexts.
    2.  **Pick a primary parent:** Ask the user to choose one folder (`ParentA/` or `ParentB/`) to move the file into.
    3.  **(Advanced) Use symlinks/shortcuts:** Where the filesystem supports it, create a symbolic link in the second location pointing to the first. This is more complex and might be a future enhancement.

The duplication choice should be presented clearly to the user during the simulation phase.

### 2.3. Safety Mechanisms

- **Simulation First:** Never touch files without showing the user a complete preview of the changes.
- **Backup:** Strongly recommend the user back up their vault before running the generation process.
- **Atomic Operations:** Plan the file operations to be as atomic as possible to minimize risk if the process is interrupted.

---

## 3. Detailed Implementation Plan

This section breaks down the development work into modules and actionable steps. We will create a new file, `src/conversion.ts`, to house the core logic for both features.

### 3.1. Module: `src/conversion.ts`

This new file will contain the primary functions for handling the conversion logic.

- **`convertFoldersToPluginFormat(rootFolder: TFolder, options: ConversionOptions): Promise<void>`**
- **`generateFoldersFromPluginFormat(targetFolder: TFolder, options: GenerationOptions): Promise<void>`**

### 3.2. Step-by-Step: "Folder to Plugin" Conversion

1.  **Add Command:**
    - In `main.ts`, add a new command: `abstract-folder:convert-folder-to-plugin`.
    - The command will trigger a new modal for folder selection.

2.  **Create Folder Selection Modal (`src/ui/modals.ts`):**
    - This modal will extend `SuggestModal<TFolder>`.
    - It will use `this.app.vault.getAbstractFileByPath('/')` and iterate through its children to find all `TFolder` instances.
    - It will present the UI options as designed (checkbox for creating parent notes, dropdown for handling existing relationships).

3.  **Implement `convertFoldersToPluginFormat` (`src/conversion.ts`):**
    - **Get all files:** Use `this.app.vault.getFiles()` to get a flat list of all files in the vault.
    - **Recursive Traversal:**
        - Write a recursive helper function: `traverse(folder: TFolder)`.
        - Inside the loop, get the folder's children (`folder.children`).
        - For each `child` in `folder.children`:
            - If `child` is a `TFile`, it's a direct child.
            - If `child` is a `TFolder`, recurse: `traverse(child)`.
    - **Identify Parent Note:**
        - For each folder, determine its corresponding note (e.g., `ParentFolder.md`).
        - Check if a file with the same name as the folder exists at the same level.
        - If not, and the user opted in, create it using `this.app.vault.create(notePath, '')`.
    - **Update Plugin Data:**
        - For each child file found, get its path.
        - Get the parent note's path.
        - Load the plugin's data structure (e.g., from `data.json` via `loadData()`).
        - Based on the user's choice (append/replace), add the parent's path to the child's `parents` array.
        - **Key Data Structure Assumption:** The plugin stores relationships in a way that can be represented as: `{[filePath: string]: { parents: string[] }}`.
    - **Save Data:**
        - After all folders have been processed, save the updated data structure using `saveData()`.

### 3.3. Step-by-Step: "Plugin to Folder" Generation

1.  **Add Command:**
    - In `main.ts`, add the second command: `abstract-folder:create-folders-from-plugin`.
    - This command will open the destination selection modal.

2.  **Create Destination & Simulation Modals (`src/ui/modals.ts`):**
    - **Destination Modal:** A simple modal with a text input for the new folder name and a `SuggestModal` for existing folders.
    - **Simulation Modal:** This is the most complex UI.
        - It will take the generated file tree as input.
        - It will render a representation of the tree (a simple text-based list might suffice for v1).
        - It will prominently display files with multiple parents and provide the resolution dropdowns as designed.

3.  **Implement `generateFoldersFromPluginFormat` (`src/conversion.ts`):**
    - **Load Plugin Data:** Load the relationship data.
    - **Build Virtual File Tree:**
        - Create an in-memory tree structure, e.g., `Map<string, string[]>`, where the key is the new folder path and the value is a list of file paths that will be inside it.
        - Iterate through all files in the plugin's data. For each file with parents, determine its destination path(s).
        - **Conflict Detection:** If a file needs to go into more than one folder, flag it as a conflict.
    - **Present Simulation:**
        - Pass the virtual tree and the conflict list to the Simulation Modal.
        - Await user input and their resolution choices.
    - **Execute File Operations:**
        - Once the user confirms, iterate through the resolved virtual tree.
        - For each folder path, create it using `this.app.vault.createFolder(path)`.
        - For each file:
            - If the resolution is **move**, use `this.app.vault.renameFile(file, newPath)`.
            - If the resolution is **copy**, use `this.app.vault.copy(file, newPath)`.
        - Wrap this entire process in a `try...catch` block to handle potential file system errors.

4.  **Create File Operator Module (`src/file-operations.ts`):**
    - This existing file will be enhanced. We will add functions that wrap the vault API calls with more robust logging and error handling.
    - `async function safeCopy(file: TFile, newPath: string): Promise<void>`
    - `async function safeMove(file: TFile, newPath: string): Promise<void>`

---

## 4. UI/UX Design

The user interaction will be centered around the Command Palette and a series of modals to guide the user through the process.

### 4.1. Accessing the Features

Two new commands will be added to the Command Palette:
1.  **Abstract Folder: Convert folder structure to plugin format**
2.  **Abstract Folder: Create folder structure from plugin format**

### 4.2. "Folder to Plugin" Conversion UI

1.  **Initiation:** User runs the "Convert folder structure..." command.
2.  **Folder Selection Modal:**
    - A modal appears, prompting the user to select the root folder to import. This will be a dropdown or a fuzzy finder listing the folders in the vault.
    - **Options:**
        - A checkbox: `Create parent notes for folders if they don't exist`. (Default: checked)
        - A dropdown for handling existing parents: `How to handle existing relationships?`
            - `Append new parents from folder structure` (Default)
            - `Replace existing parents with folder structure`
3.  **Confirmation Modal:**
    - After selection, a confirmation modal will appear.
    - **Message:** "This will scan the 'XYZ' folder and create parent-child relationships in your Abstract Folder data. No files will be moved or deleted. Do you want to proceed?"
    - **Buttons:** `[Proceed]` `[Cancel]`
4.  **Completion Notice:**
    - A notice will appear upon completion: "Conversion complete. X relationships have been created/updated."

### 4.3. "Plugin to Folder" Generation UI

1.  **Initiation:** User runs the "Create folder structure..." command.
2.  **Destination Selection Modal:**
    - A modal prompts the user to select a destination folder for the generated structure. They can choose an existing folder or type a name for a new one.
    - **Message:** "Select or create a destination folder for your generated structure. Example: 'Generated Folders'."
3.  **Simulation and Conflict Resolution Modal:**
    - This is the most critical UI component. A modal will display a preview of the file and folder structure that will be created.
    - **Tree View:** A collapsible tree view shows the proposed folder hierarchy.
    - **Conflict List:** Any file with multiple parents will be listed prominently at the top.
        - For each conflicting file (`FileC.md`), the user will see its multiple proposed locations (`ParentA/FileC.md`, `ParentB/FileC.md`).
        - A dropdown next to each conflict will allow the user to choose the resolution strategy:
            - `Duplicate the file in each location` (Default)
            - `Choose a single location` (this will reveal radio buttons for each location)
    - **Global Setting:** A global setting for all conflicts can be provided at the top for convenience: `For all files with multiple parents:` with the same dropdown options.
4.  **Final Confirmation Modal:**
    - After resolving conflicts, a final confirmation appears.
    - **Warning Message:** "You are about to create X folders and move/copy Y files. It is strongly recommended to back up your vault first. This action cannot be undone. Are you sure you want to proceed?"
    - **Buttons:** `[Generate Folders]` `[Cancel]`
5.  **Completion Notice:**
    - A notice will appear upon completion: "Folder structure generated successfully in 'Generated Folders'."
