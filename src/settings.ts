import { Group, SortConfig, FilterConfig } from "./types";

export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key used to define parent notes (child-defined parent)
  childrenPropertyName: string; // The frontmatter property key used by a parent to define its children (parent-defined children)
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoExpandParents: boolean; // Whether to expand parent folders when revealing the active file
  autoExpandChildren: boolean; // Whether to expand all children folders when a file is opened
  startupOpen: boolean; // Whether to open the view on plugin load
  openSide: 'left' | 'right'; // Which side panel to open the view in
  showRibbonIcon: boolean; // Whether to display the ribbon icon
  enableRainbowIndents: boolean; // Whether to enable rainbow indentation guides
  rainbowPalette: 'classic' | 'pastel' | 'neon'; // The color palette for rainbow indents
  enablePerItemRainbowColors: boolean; // Whether to use varied colors for indentation guides of sibling items
  viewStyle: 'tree' | 'column'; // New: Tree or Column view
  rememberExpanded: boolean; // Whether to remember expanded/collapsed state of folders
  expandedFolders: string[]; // List of paths of currently expanded folders
  excludedPaths: string[]; // Paths to exclude from the abstract folder view (e.g. export folders)
  groups: Group[]; // New: List of defined groups
  activeGroupId: string | null; // New: ID of the currently active group, or null if no group is active
  expandTargetFolderOnDrop: boolean; // Whether to expand the target folder after a drag-and-drop operation
  metrics: Record<string, { thermal: number; lastInteraction: number }>; // Path -> Metrics (persisted)
  defaultSort: SortConfig; // Default sort configuration for the main view
  defaultFilter: FilterConfig; // Default filter configuration for the main view
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: 'parent',
  childrenPropertyName: 'children', // Default to 'children'
  showAliases: true,
  autoExpandParents: true,
  autoExpandChildren: false,
  startupOpen: false,
  openSide: 'left',
  showRibbonIcon: true, // Default to true
  enableRainbowIndents: true,
  rainbowPalette: 'classic',
  enablePerItemRainbowColors: false, // Default to false
  viewStyle: 'tree',
  rememberExpanded: false,
  expandedFolders: [],
  excludedPaths: [],
  groups: [],
  activeGroupId: null,
  expandTargetFolderOnDrop: true, // Default to true for now
  metrics: {},
  defaultSort: { sortBy: 'name', sortOrder: 'asc' },
  defaultFilter: { excludeExtensions: [] },
};