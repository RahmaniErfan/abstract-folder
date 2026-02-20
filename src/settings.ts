import { Group, SortConfig, FilterConfig, ScopeConfig } from "./types";
import { LibrarySettings } from "./library/types";

export interface VisibilitySettings {
	[key: string]: boolean;
	showFocusActiveFileButton: boolean;
	showConversionButton: boolean;
	showCollapseAllButton: boolean;
	showExpandAllButton: boolean;
	showSortButton: boolean;
	showFilterButton: boolean;
	showGroupButton: boolean;
	showCreateNoteButton: boolean;
	showSearchHeader: boolean;
}

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
  rememberExpanded: boolean; // Whether to remember expanded/collapsed state of folders
  expandedFolders: string[]; // List of paths of currently expanded folders
  excludedPaths: string[]; // Paths to exclude from the abstract folder view (e.g. export folders)
  groups: Group[]; // New: List of defined groups
  scopes: Record<string, ScopeConfig>; // New: Scoped configurations
  
  /** @deprecated Migration to scopes['global'] will happen */
  activeGroupId: string | null; 
  /** @deprecated Migration to scopes['global'] will happen */
  defaultSort: SortConfig; 
  /** @deprecated Migration to scopes['global'] will happen */
  defaultFilter: FilterConfig; 

  expandTargetFolderOnDrop: boolean; // Whether to expand the target folder after a drag-and-drop operation 
  metrics: Record<string, { thermal: number; lastInteraction: number }>; // Path -> Metrics (persisted)

  customCreatedDateProperties: string; // Comma-separated frontmatter property names for created date
  customModifiedDateProperties: string; // Comma-separated frontmatter property names for modified date
  displayNameOrder: string[]; // Ordered list of properties to check for display name
  searchShowDescendants: boolean; // Whether to show descendants in search results
  searchShowAncestors: boolean; // Whether to show ancestors in search results
  lastInteractionContextId: string | null; // The contextual ID of the most recently interacted folder/file
  showFocusActiveFileButton: boolean; // Whether to show the focus active file button
  showConversionButton: boolean; // Whether to show the conversion button
  showCollapseAllButton: boolean; // Whether to show the collapse all button
  showExpandAllButton: boolean; // Whether to show the expand all button
  showSortButton: boolean; // Whether to show the sort button
  showFilterButton: boolean; // Whether to show the filter button
  showGroupButton: boolean; // Whether to show the group button
  showCreateNoteButton: boolean; // Whether to show the create note button
  showBackupButton: boolean; // Whether to show the backup button
  showSearchHeader: boolean; // Whether to show the search bar header
  maxMenuNameLength: number; // Maximum length of file names shown in menus/dropdowns
  visibility: {
    default: VisibilitySettings;
    spaces: VisibilitySettings;
    libraries: VisibilitySettings;
  };
  namingConflictStrategy: 'parent' | 'ancestor' | 'none'; // Strategy to resolve name conflicts in flat structure
  namingConflictSeparator: '-' | 'brackets'; // Separator to use for naming conflicts
  namingConflictOrder: 'parent-first' | 'name-first'; // Order of parent and name
  defaultNewNotePath: string; // Default path for new notes
  anonymizeDebugExport: boolean;
  hideNonMarkdownOrphans: boolean; // Whether to hide non-markdown files that have no parents
  showFileIcon: boolean; // Whether to show file icons
  showFolderIcon: boolean; // Whether to show folder icons
  librarySettings: LibrarySettings;
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
  rememberExpanded: false,
  expandedFolders: [],
  excludedPaths: [],
  groups: [],
  scopes: {}, // Initial empty scopes
  activeGroupId: null,
  expandTargetFolderOnDrop: true, // Default to true for now
  metrics: {},
  defaultSort: { sortBy: 'name', sortOrder: 'asc' },
  defaultFilter: { excludeExtensions: [] },
  customCreatedDateProperties: '',
  customModifiedDateProperties: '',
  displayNameOrder: ['title', 'aliases', 'basename'],
  searchShowDescendants: false,
  searchShowAncestors: false,
  lastInteractionContextId: null,
  showFocusActiveFileButton: true,
  showConversionButton: true,
  showCollapseAllButton: true,
  showExpandAllButton: true,
  showSortButton: true,
  showFilterButton: true,
  showGroupButton: true,
  showCreateNoteButton: true,
  showBackupButton: true,
  showSearchHeader: true,
  maxMenuNameLength: 10,
  visibility: {
    default: {
      showFocusActiveFileButton: true,
      showConversionButton: true,
      showCollapseAllButton: true,
      showExpandAllButton: true,
      showSortButton: true,
      showFilterButton: true,
      showGroupButton: true,
      showCreateNoteButton: true,
      showSearchHeader: true,
    },
    spaces: {
      showFocusActiveFileButton: false,
      showConversionButton: true,
      showCollapseAllButton: true,
      showExpandAllButton: true,
      showSortButton: true,
      showFilterButton: true,
      showGroupButton: true,
      showCreateNoteButton: true,
      showSearchHeader: true,
    },
    libraries: {
      showFocusActiveFileButton: false,
      showConversionButton: false,
      showCollapseAllButton: true,
      showExpandAllButton: true,
      showSortButton: true,
      showFilterButton: true,
      showGroupButton: true,
      showCreateNoteButton: false,
      showSearchHeader: true,
    },
  },
  namingConflictStrategy: 'parent',
  namingConflictSeparator: '-',
  namingConflictOrder: 'parent-first',
  defaultNewNotePath: '',
  anonymizeDebugExport: true,
  hideNonMarkdownOrphans: true,
  showFileIcon: false,
  showFolderIcon: false,
  librarySettings: {
    librariesPath: "Abstract Library",
    sharedSpacesRoot: "Abstract Spaces",
    registries: ["https://raw.githubusercontent.com/RahmaniErfan/abstract-registry/main/directory.json"],
    standaloneLibraries: [],
    sharedSpaces: [],
    spaceConfigs: {},
    personalBackups: [],
    githubToken: "",
    githubUsername: "",
    githubAvatar: "",
    gitName: "",
    gitEmail: "",
    deviceId: "",
    enableScheduledSync: false,
    syncIntervalValue: 1,
    syncIntervalUnit: 'hours',
    securityExclusions: ['.obsidian/', '.trash/', 'node_modules/', '*.log'],
  },
};