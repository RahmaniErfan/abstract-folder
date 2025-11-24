export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key for parent links
  showAliases: boolean; // Whether to show aliases instead of file names in the view
  autoReveal: boolean; // Whether to automatically reveal the active file in the view
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: "parent",
  showAliases: true,
  autoReveal: true,
};