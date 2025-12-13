# Abstract Folder

**Organize your files virtually, independent of their physical location.**


You can support me if you find this useful :)

[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal)](https://www.paypal.com/paypalme/airfunn)
[![Donate via Wise](https://img.shields.io/badge/Donate-Wise-00BF8D?style=for-the-badge&logo=wise)](https://wise.com/pay/me/erfanr47)

## Further Reading

*   **The Folders Fail: A PKM Solution** - [Read the article here](https://erfanrahmani.com/folders-fail-pkm-solution/)

## The Problem

Standard folders are rigid. A file usually belongs to only one folder in your system, but conceptually, it might belong to three different projects.

## The Solution

**Abstract Folder** creates a "Virtual File Explorer" inside Obsidian. You define the folder structure using links in your Frontmatter.

  * **One File, Multiple Folders:** A single file can appear in "Project A," "Team Meetings," and "Archives" simultaneously without duplicating the actual file.
  * **Files *are* Folders:** Any file can act as a parent folder for other files.
  * **No Physical Moving:** Reorganize your entire vault hierarchy by editing text. Your actual file system structure remains untouched.

-----

## Visual Demonstration

<p align="center">
    
### 1. The Conversion Command
The command palette option to automatically convert your physical folder structure into Abstract Folders, and vice versa, exporting from Abstract Folders into physical folders.
![Conversion edited](https://github.com/user-attachments/assets/2dda076f-242c-41a4-b267-b5df0877a319)

<br>

### 2. Multi-Parenting Example
A single note appears under multiple different "parent" folders in the Abstract Folder view.
![Multi Parent Edited](https://github.com/user-attachments/assets/495cfee8-e647-4725-b785-ebe1b1629d63)

<br>

### 3. Drag and Drop Functionality
Quickly move and reorganize your abstract files directly within the view.
![AF Drag n drop Edited](https://github.com/user-attachments/assets/9cb8b9f1-9ad1-41eb-b69a-91c82b706449)

<br>

### 4. Custom Groups View
Using groups to filter and manage a subset of your abstract folders.
![AF ACTIVE GROUP Edited](https://github.com/user-attachments/assets/b1b2e1c2-e0fd-41c8-966a-08bab3ee5f1d)

</p>

-----

## Quick Start

1.  **Install the plugin** (see [Installation](#installation)).
2.  **Convert existing folders (optional but recommended):** Run the command **"Abstract Folder: Convert folder structure to plugin format"** from the Command Palette (`Ctrl/Cmd + P`). This will automatically add `parent` properties to your notes, mirroring your current physical folder structure as abstract folders.
3.  **Open the Abstract Folder view:** Run the command **"Abstract Folder: Open Abstract Folder View"**.
4.  **Define relationships:**
    *   **Child points to Parent:** In any note's frontmatter, add a `parent` property as a list (e.g., `parent: ["[[Parent Note Name]]"]`). If you use the conversion command (step 2), this will be set up automatically. **Tip: You can click the property icon to change the property type to list**
    *   **Parent lists Children:** In a parent note's frontmatter, add `children: ["[[Child Note 1]]", "[[Child Note 2]]"]`.
    *   For more details and examples, see [Usage](#usage).
5.  **Explore and manage:** Use the virtual file explorer to navigate your newly defined abstract hierarchy. For available actions, refer to the [Commands](#commands) section.

-----

## Key Features

  * **Virtual Hierarchy:** Create deep nesting and folder structures entirely via metadata.
  * **Drag & Drop:** Reorganize your abstract folders naturally. Drag to move, or hold `Ctrl`/`Cmd` to copy (add to a second parent).
  * **Multi-Parenting:** Assign a file to multiple "parents" using the `parent` property. It will appear in all of them in the tree view.
  * **Parent-Defined Children:** Use the `children` property to manually list files that belong to a parent file.
  * **Non-Markdown Support:** Using the "Parent-Defined Children" feature, you can organize files that don't have frontmatter (like Canvas, Excalidraw, Images, or PDFs) into your abstract folders.
  * **Custom Views:** Browse your files using a Tree view, Column view, or Groups.
  * **Migration Tools:** One-click tools to convert your physical folder structure to Abstract Folders (and vice-versa).

-----

## Usage

### 1\. The Basic Method (Child points to Parent)

This is the most common method. Inside a file, add a `parent` link in the Frontmatter.

**File:** `My File.md`

```yaml
---
parent: "[[Project Alpha]]"
---
```

*Result:* `My File` will appear inside `Project Alpha` in the Abstract Folder view.

**Multiple Parents:**

```yaml
---
parent:
  - "[[Project Alpha]]"
  - "[[Daily Log]]"
---
```

*Result:* `My File` appears inside **both** folders.

### 2\. The Advanced Method (Parent lists Children)

Use this for files that don't have frontmatter (like Canvas, Excalidraw, or PDFs), or if you prefer to organize from the top down. You list the child files inside the parent file.

**File:** `Project Alpha.md`

```yaml
---
children:
  - "[[Brainstorming.canvas]]"
  - "[[Diagram.excalidraw]]"
  - "[[Meeting Recording.mp3]]"
---
```

### 3\. Drag and Drop

You can reorganize your structure directly in the view.

*   **Move (Default):** Dragging a file from Folder A to Folder B will *move* it (remove it from A, add it to B).
*   **Copy (Add Parent):** Holding `Ctrl` (Windows/Linux) or `Cmd` (macOS) while dragging will *copy* the file (keep it in A, and *also* add it to B). This is how you create multi-parent setups quickly.
*   **Non-Markdown Files:** Dragging images or PDFs works too! The plugin will automatically update the `children` list of the target parent folder.

-----

## Commands

Access these via the Command Palette (`Ctrl/Cmd + P`):

  * **Abstract Folder: Open Abstract Folder View**
    Opens the virtual tree view in your sidebar.
  * **Abstract Folder: Create Abstract Child**
    Creates a new file and automatically links it as a child of the currently selected abstract folder.
  * **Abstract Folder: Manage Groups**
    Opens the menu to create, edit, or delete folder groups.
  * **Abstract Folder: Clear Active Group**
    Removes the current group filter to show all abstract folders.
  * **Abstract Folder: Convert folder structure to plugin format**
    Scans your physical folders and adds `parent` frontmatter links to replicate the structure virtually.
  * **Abstract Folder: Create folder structure from plugin format**
    Reorganizes your physical file system to match your abstract hierarchy.

-----

## Settings

Customize the plugin behavior in **Settings → Abstract Folder**.

### General Configuration

  * **Property Name:** The frontmatter key used to define parents (default: `parent`). *Case-sensitive.*
  * **Children Property Name:** The frontmatter key used to define children (default: `children`).
  * **Show Aliases:** If enabled, the tree view will display the file's first alias instead of the filename.
  * **Excluded Paths:** A list of file paths to hide from the abstract view.

### View Behavior

  * **Auto Reveal:** Automatically expands the folder tree to highlight the file you are currently editing.
  * **Remember Expanded Folders:** Keeps folders open in the tree view even after restarting Obsidian (default: `false`).
  * **Open on Startup:** Automatically opens the Abstract Folder view when you launch Obsidian.
  * **Open Position:** Choose whether the view opens in the `left` or `right` sidebar.
  * **Show Ribbon Icon:** Toggles the visibility of the icon in the left ribbon.

### Visuals (Rainbow Indents)

  * **Enable Rainbow Indents:** Colors the indentation lines to visually distinguish tree depth.
  * **Rainbow Palette:** Select the color scheme for indentations (`classic`, `pastel`, or `neon`).
  * **Per-Item Colors:** If enabled, sibling items at the same depth will use different colors. If disabled, all items at the same depth share the same color.

-----

## Installation

This plugin is not yet available in the official Obsidian Community Plugins list. You must install it manually.

1.  Go to the [GitHub Repository](https://github.com/RahmaniErfan/abstract-folder) and find the latest **Release** on the right sidebar.
2.  Download these three files: `main.js`, `manifest.json`, and `styles.css`.
3.  Navigate to your Obsidian Vault folder on your computer.
4.  Open the hidden `.obsidian` folder, then open the `plugins` folder inside it.
      * *(Note: On macOS, press `Cmd + Shift + .` to toggle hidden files. On Windows, go to View -> Show -> Hidden items).*
5.  Create a new folder named `abstract-folder`.
6.  Paste the three downloaded files (`main.js`, `manifest.json`, `styles.css`) into this new folder.
7.  Restart Obsidian, go to **Settings → Community Plugins**, and enable **Abstract Folder**.

-----

### Privacy

This plugin works 100% locally. It makes no network requests and moves no physical files unless you explicitly use the "Create folder structure from plugin format" command.

-----
