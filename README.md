# Abstract Folder

**Organize your files virtually, independent of their physical location.**


You can support me if you find this useful :)

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-EA4AAA?style=for-the-badge&logo=github)](https://github.com/sponsors/RahmaniErfan)
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

  * **Multi-Parenting:** Assign a file to multiple "parents" using the `parent` property. It will appear in all of them in the tree view.
  * **Drag & Drop:** Reorganize your abstract folders naturally. Drag to move, or hold `Ctrl`/`Cmd` to copy (add to a second parent).
  * **Custom Groups & Views:** Browse your files using a Tree view, Column view, or high-level Groups to isolate project contexts.
  * **Advanced Sorting:** Organize your view using smart metrics like "Thermal" (Hotness), "Stale Rot" (Neglect), and "Gravity" (Recursive Density).
  * **Non-Markdown Support:** Using the "Parent-Defined Children" feature, you can organize files that don't have frontmatter (like Canvas, Excalidraw, Images, or PDFs) into your abstract folders.
  * **Migration Tools:** One-click tools to convert your physical folder structure to Abstract Folders (and vice-versa).
  * **Focus & Isolate:** Instantly focus on a file's ancestry or use the search bar to isolate project branches.

## Flexibility & Power

  * **Virtual Hierarchy:** Create deep nesting and folder structures entirely via metadata.
  * **Conflict Resolution**: Automatically resolve file name collisions in flat structures using parent or ancestor names (e.g., `[Parent] Name` or `Name - Parent`).
  * **Flexible Properties**: Define multiple property names (e.g., `parent`, `up`, `category`) to build your hierarchy.
  * **Hotness (Thermal):** Surface notes you are actively working on using exponential decay logic.

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

### 4\. Advanced Sorting

Organize your knowledge map using abstract logic that mirrors how you actually interact with your notes. Unlike simple alphabetical sorting, these metrics help you surface what matters right now.

#### The Metrics

*   **The "Thermal" Sort (Focus Logic):** Identifies which part of your vault is currently "active" (The "Hotness"). It uses an exponential decay formula (20% every 24 hours) based on recency and interaction frequency. Scores increase when a note is opened or when its abstract structure changes.
*   **The "Stale Rot" Sort (Cleanup Logic):** Identifies abandoned ideas. It calculates a score by multiplying the inactivity period (days since last edit) by the total number of abstract children (complexity). High scores represent large, complex structures you haven't touched in months.
*   **The "Gravity" Sort (Recursive Density):** Identifies the biggest hubs in your vault. It recursively counts all descendants for each abstract folder, placing the "heaviest" branches at the top.

#### Understanding Thermal (Hotness) vs. Rot

While both involve "recency," they measure different aspects of your knowledge map:

*   **Thermal (Hotness) rewards *Activity*:** A single note you just opened is "Hot," even if it has no children. It's about what you are thinking about *right now*.
*   **Rot highlights *Neglect*:** A massive project folder with 50 notes that you haven't touched in 3 months has high "Rot." It's about large structures you've *forgotten about*.

Sorting by **Thermal (Descending)** shows your current focus. Sorting by **Stale Rot (Descending)** shows you where it's time to clean up or archive.

-----

## Commands

Access these via the Command Palette (`Ctrl/Cmd + P`):

  * **Abstract Folder: Open Abstract Folder View**
    Opens the virtual tree view in your sidebar.
  * **Abstract Folder: Focus Search Bar**
    Activates the view and focuses the search input.
  * **Abstract Folder: Clear Active Group**
    Removes the current group filter to show all abstract folders.
  * **Abstract Folder: Focus Active File**
    Highlights and centers the current file in the abstract tree, switching to tree view if necessary.
  * **Abstract Folder: Create Group with Active File**
    Opens the group creation modal with the current file pre-filled as a root parent.
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

  * **Property Name:** The frontmatter key(s) used to define parents (default: `parent`). You can specify multiple names separated by commas. *Case-sensitive.*
  * **Children Property Name:** The frontmatter key(s) used to define children (default: `children`).
  * **Show Aliases:** If enabled, the tree view will display the file's first alias instead of the filename.
  * **Conflict Resolution**: Settings to control how conflicting filenames are displayed, including naming logic (parent vs ancestor) and formatting (separators and order).
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

### Advanced & Maintenance

  * **Factory Reset Settings**: Reset all plugin configuration to factory defaults without touching your vault content.
  * **Debug Privacy**: Control the anonymization levels for diagnostic exports.

-----

## Installation

### Method 1: BRAT (Recommended for Beta Testing)
The easiest way to install and stay up-to-date with the latest features is using the **Beta Reviewers Auto-update Tool (BRAT)**.

1. Install the **BRAT** plugin from the Obsidian Community Plugins store.
2. Open **Settings → BRAT**.
3. Click **Add Beta plugin**.
4. Enter the repository URL: `https://github.com/RahmaniErfan/abstract-folder`
5. Click **Add Plugin**.
6. Enable **Abstract Folder** in **Settings → Community plugins**.

### Method 2: Manual Installation
1. Go to the [GitHub Repository](https://github.com/RahmaniErfan/abstract-folder) and find the latest **Release** on the right sidebar.
2. Download these three files: `main.js`, `manifest.json`, and `styles.css`.
3. Navigate to your Obsidian Vault folder on your computer.
4. Open the hidden `.obsidian` folder, then open the `plugins` folder inside it.
      * *(Note: On macOS, press `Cmd + Shift + .` to toggle hidden files. On Windows, go to View -> Show -> Hidden items).*
5. Create a new folder named `abstract-folder`.
6. Paste the three downloaded files (`main.js`, `manifest.json`, `styles.css`) into this new folder.
7. Refresh plugins and enable `abstract folder`.

-----

### Privacy

This plugin works 100% locally. It makes no network requests and moves no physical files unless you explicitly use the "Create folder structure from plugin format" command.

-----
