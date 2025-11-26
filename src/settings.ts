export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key used to define parent notes
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoReveal: boolean; // Whether to automatically reveal the active file in the view
  startupOpen: boolean; // Whether to open the view on plugin load
  openSide: 'left' | 'right'; // Which side panel to open the view in
  enableRainbowIndents: boolean; // Whether to enable rainbow indentation guides
  rainbowPalette: 'classic' | 'pastel' | 'neon'; // The color palette for rainbow indents
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: 'parent',
  showAliases: true,
  autoReveal: true,
  startupOpen: false,
  openSide: 'left',
  enableRainbowIndents: true, // Default to true for a nice visual
  rainbowPalette: 'classic', // Default palette
};