export interface AbstractFolderPluginSettings {
  propertyName: string; // The frontmatter property key for parent links
}

export const DEFAULT_SETTINGS: AbstractFolderPluginSettings = {
  propertyName: "parent",
};