export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key used to define parent notes (child-defined parent)
  childrenPropertyName: string; // The frontmatter property key used by a parent to define its children (parent-defined children)
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoReveal: boolean; // Whether to automatically reveal the active file in the view
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
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: 'parent',
  childrenPropertyName: 'children', // Default to 'children'
  showAliases: true,
  autoReveal: true,
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
};