import { TFile } from "obsidian";

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
}