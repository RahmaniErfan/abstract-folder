export interface AbstractFolderPluginSettings {
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoReveal: boolean; // Whether to automatically reveal the active file in the view
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  showAliases: true,
  autoReveal: true,
};