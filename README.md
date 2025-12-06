# Abstract Folder

**Organize your files virtually, independent of their physical location.**

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

## Key Features

  * **Virtual Hierarchy:** Create deep nesting and folder structures entirely via metadata.
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
