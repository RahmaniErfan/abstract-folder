import { App, Modal, Setting, setIcon } from "obsidian";

// A more comprehensive list of common Lucide icons, including variations
const COMMON_OBSIDIAN_ICONS = [
  "file", "file-text", "file-plus", "file-minus", "file-warning", "file-question", "file-search", "file-archive", "file-code", "file-video", "file-image", "file-audio",
  "folder", "folder-open", "folder-plus", "folder-minus", "folder-x", "folder-check", "folder-tree", "folder-dot", "folder-symlink",
  "circle", "square", "triangle", "octagon", "hexagon", "pentagon", "star", "heart", "sun", "moon", "cloud", "droplet",
  "tag", "tags", "hash", "at-sign", "plus", "minus", "x", "check", "info", "alert-triangle", "alert-circle", "help-circle",
  "settings", "cog", "tool", "gear", "sliders", "filter", "funnel", "calendar", "clock", "hourglass", "watch", "alarm-clock",
  "map", "map-pin", "globe", "compass", "navigation", "route", "truck", "car", "plane", "bus", "train", "bike", "walk",
  "home", "building", "briefcase", "archive", "box", "package", "shopping-bag", "shopping-cart", "credit-card", "dollar-sign", "wallet",
  "user", "users", "user-plus", "user-minus", "user-x", "user-check", "user-circle", "user-square", "user-cog", "person-standing",
  "mail", "send", "message-square", "message-circle", "speech", "bell", "bell-off", "inbox", "mail-open", "at-sign",
  "link", "external-link", "chain", "paperclip", "upload", "download", "share", "copy", "cut", "clipboard", "paste", "book", "bookmark",
  "edit", "pencil", "pen-tool", "eraser", "ruler", "scissors", "crop", "paint-brush", "palette", "feather", "image", "camera", "video", "mic",
  "play", "pause", "stop", "skip-forward", "skip-back", "fast-forward", "rewind", "volume-x", "volume-1", "volume-2", "volume", "headphones",
  "search", "zoom-in", "zoom-out", "eye", "eye-off", "maximize", "minimize", "fullscreen", "compress", "expand",
  "lock", "unlock", "key", "shield", "shield-off", "fingerprint", "lock-open", "log-in", "log-out",
  "code", "terminal", "branch", "git-commit", "git-branch", "git-merge", "git-pull-request", "bug", "terminal-square",
  "bar-chart", "pie-chart", "line-chart", "activity", "trending-up", "trending-down", "zap", "battery", "wifi", "rss",
  "monitor", "tablet", "smartphone", "laptop", "mouse", "keyboard", "printer", "hard-drive", "server", "cpu", "database",
  "chevrons-left", "chevrons-right", "chevrons-up", "chevrons-down", "chevron-left", "chevron-right", "chevron-up", "chevron-down",
  "arrow-left", "arrow-right", "arrow-up", "arrow-down", "move", "rotate-cw", "rotate-ccw", "refresh-ccw", "repeat", "shuffle",
  "align-left", "align-center", "align-right", "align-justify", "bold", "italic", "underline", "strikethrough", "type", "font", "pilcrow", "list", "list-ordered", "list-todo",
  "quote", "code-block", "info-block", "alert-block", "help-block", "comment", "message-circle", "question",
  "gift", "award", "trophy", "crown", "sparkles", "gem", "diamond", "star-half", "star-off",
  "coffee", "tea", "cake", "cookie", "pizza", "burger", "ice-cream", "wine", "beer", "cup-soda",
  "cloud-sun", "cloud-moon", "cloud-lightning", "cloud-rain", "cloud-snow", "cloud-fog", "cloud-drizzle",
  "wind", "droplets", "sunrise", "sunset", "moon-star",
  "dice-1", "dice-2", "dice-3", "dice-4", "dice-5", "dice-6", "target", "crosshair", "aperture",
  "box-select", "mouse-pointer", "pointer", "hand", "hand-up", "hand-down", "hand-left", "hand-right",
  "columns", "rows", "grip-horizontal", "grip-vertical", "table", "layout-grid", "layout-list", "layout-template",
  "pie-chart", "donut-chart", "bar-chart-big", "line-chart", "area-chart", "scatter-chart",
  "circle-dot", "circle-off", "plus-circle", "minus-circle", "x-circle", "check-circle", "alert-circle", "info-circle",
  "square-dot", "plus-square", "minus-square", "x-square", "check-square",
  "wifi-off", "bluetooth", "bluetooth-off", "globe-lock", "cloud-off",
  "microscope", "flask-conical", "atom", "dna", "test-tube", "syringe", "thermometer-snowflake",
  "bug-play", "bug-off", "database-zap", "database-backup", "hard-drive-upload", "hard-drive-download",
  "dribbble", "instagram", "facebook", "twitter", "linkedin", "youtube", "twitch", "github", "gitlab", "slack", "figma", "framer"
];

export class IconModal extends Modal {
  result: string;
  onSubmit: (result: string) => void;
  private searchInput: string;
  private iconGrid: HTMLElement;

  constructor(app: App, onSubmit: (result: string) => void, initialValue = "") {
    super(app);
    this.onSubmit = onSubmit;
    this.result = initialValue;
    this.searchInput = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("abstract-folder-icon-modal");

    contentEl.createEl("h2", { text: "Set Note Icon/Emoji" });

    // Existing text input for custom emojis or specific icon IDs
    new Setting(contentEl)
      .setName("Custom Icon or Emoji")
      .setDesc("Enter an Obsidian icon ID (e.g., 'star') or any emoji (e.g., '📝'). Leave empty to remove.")
      .addText((text) =>
        text
          .setPlaceholder("e.g., star, lucide-file, 📝")
          .setValue(this.result)
          .onChange((value) => {
            this.result = value;
            this.renderIconGrid(); // Re-render grid to show selection if it matches
          })
      );

    // Search input for built-in icons
    new Setting(contentEl)
      .setName("Search Built-in Icons")
      .addText((text) =>
        text
          .setPlaceholder("Filter icons...")
          .setValue(this.searchInput)
          .onChange((value) => {
            this.searchInput = value.toLowerCase();
            this.renderIconGrid();
          })
      );

    // Icon Grid Container
    this.iconGrid = contentEl.createDiv({ cls: "abstract-folder-icon-grid" });
    this.renderIconGrid(); // Initial render of icons

    // Action buttons
    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Set Icon")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(this.result);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Remove Icon")
          .onClick(() => {
            this.result = ""; // Clear the icon
            this.close();
            this.onSubmit(this.result);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private renderIconGrid() {
    this.iconGrid.empty();
    const filteredIcons = COMMON_OBSIDIAN_ICONS.filter(iconName =>
      iconName.includes(this.searchInput)
    );

    if (filteredIcons.length === 0) {
      this.iconGrid.createEl("div", { text: "No matching icons found.", cls: "abstract-folder-no-icons" });
      return;
    }

    filteredIcons.forEach(iconName => {
      const iconEl = this.iconGrid.createDiv({ cls: "abstract-folder-grid-item" });
      if (this.result === iconName) {
        iconEl.addClass("is-active");
      }
      setIcon(iconEl, iconName);
      // Removed: iconEl.createEl("span", { text: iconName, cls: "abstract-folder-icon-name" });
      iconEl.title = iconName; // Keep title for hover tooltip

      iconEl.addEventListener("click", () => {
        this.result = iconName;
        this.onSubmit(this.result);
        this.close();
      });
    });
  }
}