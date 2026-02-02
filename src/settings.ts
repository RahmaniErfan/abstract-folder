import { Group, SortConfig, FilterConfig } from "./types";

export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key used to define parent notes (child-defined parent)
  parentPropertyNames: string[]; // Support for multiple parent property names
  childrenPropertyName: string; // The frontmatter property key used by a parent to define its children (parent-defined children)
  childrenPropertyNames: string[]; // Support for multiple children property names
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoExpandParents: boolean; // Whether to expand parent folders when revealing the active file
  autoScrollToActiveFile: boolean; // Whether to scroll to the active file when opening it
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
  customCreatedDateProperties: string; // Comma-separated frontmatter property names for created date
  customModifiedDateProperties: string; // Comma-separated frontmatter property names for modified date
  displayNameOrder: string[]; // Ordered list of properties to check for display name
  searchShowChildren: boolean; // Whether to show children in search results
  searchShowParents: boolean; // Whether to show parents in search results
  lastInteractionContextId: string | null; // The contextual ID of the most recently interacted folder/file
  showViewStyleToggle: boolean; // Whether to show the view style toggle button
  showFocusActiveFileButton: boolean; // Whether to show the focus active file button
  showSearchButton: boolean; // Whether to show the search button in toolbar
  showConversionButton: boolean; // Whether to show the conversion button
  showCollapseAllButton: boolean; // Whether to show the collapse all button
  showExpandAllButton: boolean; // Whether to show the expand all button
  showSortButton: boolean; // Whether to show the sort button
  showFilterButton: boolean; // Whether to show the filter button
  showGroupButton: boolean; // Whether to show the group button
  showCreateNoteButton: boolean; // Whether to show the create note button
  showSearchHeader: boolean; // Whether to show the search bar header
  maxMenuNameLength: number; // Maximum length of file names shown in menus/dropdowns
  namingConflictStrategy: 'parent' | 'ancestor' | 'none'; // Strategy to resolve name conflicts in flat structure
  namingConflictSeparator: '-' | 'brackets'; // Separator to use for naming conflicts
  namingConflictOrder: 'parent-first' | 'name-first'; // Order of parent and name
  defaultNewNotePath: string; // Default path for new notes
  anonymizeDebugExport: boolean;
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: 'parent',
  parentPropertyNames: ['parent'],
  childrenPropertyName: 'children', // Default to 'children'
  childrenPropertyNames: ['children'],
  showAliases: true,
  autoExpandParents: true,
  autoScrollToActiveFile: true,
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
  customCreatedDateProperties: '',
  customModifiedDateProperties: '',
  displayNameOrder: ['title', 'aliases', 'basename'],
  searchShowChildren: false,
  searchShowParents: false,
  lastInteractionContextId: null,
  showViewStyleToggle: true,
  showFocusActiveFileButton: true,
  showSearchButton: true,
  showConversionButton: true,
  showCollapseAllButton: true,
  showExpandAllButton: true,
  showSortButton: true,
  showFilterButton: true,
  showGroupButton: true,
  showCreateNoteButton: true,
  showSearchHeader: true,
  maxMenuNameLength: 10,
  namingConflictStrategy: 'parent',
  namingConflictSeparator: '-',
  namingConflictOrder: 'parent-first',
  defaultNewNotePath: '',
  anonymizeDebugExport: true,
};