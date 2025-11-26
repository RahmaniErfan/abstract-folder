export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key used to define parent notes
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoReveal: boolean; // Whether to automatically reveal the active file in the view
  startupOpen: boolean; // Whether to open the view on plugin load
  openSide: 'left' | 'right'; // Which side panel to open the view in
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: 'parent',
  showAliases: true,
  autoReveal: true,
  startupOpen: false,
  openSide: 'left',
};