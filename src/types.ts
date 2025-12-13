import { TFile } from "obsidian";

// Extend the App interface to include the 'commands' property,
// which is available in Obsidian's internal API but might not be in default types.
declare module "obsidian" {
  interface App {
    commands: {
      executeCommandById(commandId: string): void;
    };
  }
}

export const HIDDEN_FOLDER_ID = "abstract-hidden-root"; // Unique ID for the special "Hidden" folder

export interface AbstractFolderFrontmatter {
  children?: string[];
  icon?: string;
  [key: string]: unknown; // Allow other properties
}

export interface ParentChildMap {
  [parentPath: string]: Set<string>; // Parent path -> Set of child paths
}

export interface FileGraph {
  parentToChildren: ParentChildMap;
  childToParents: Map<string, Set<string>>; // Child path -> Set of parent paths (for easier updates)
  allFiles: Set<string>; // All files encountered (parents or children)
}

export interface FolderNode {
  file: TFile | null; // The file itself, null for root "folder" nodes that don't correspond to a file
  path: string; // The path of the file or logical folder
  children: FolderNode[];
  isFolder: boolean;
  icon?: string; // Optional icon or emoji from frontmatter
  isHidden?: boolean; // Whether this node should be considered "hidden" from the main tree
}

export interface Group {
  id: string;
  name: string;
  parentFolders: string[]; // Paths of parent folders to display
}

export type Cycle = string[]; // Represents a cycle as an array of file paths