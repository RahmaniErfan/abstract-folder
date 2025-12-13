import { App, Modal, Setting, setIcon } from "obsidian";

// A more comprehensive list of common Lucide icons, including variations
const COMMON_OBSIDIAN_ICONS = [
  "a-arrow-down", "a-arrow-up", "a-large-small", "accessibility", "activity", "air-vent", "airplay",
  "alarm-clock", "alarm-clock-check", "alarm-clock-minus", "alarm-clock-off", "alarm-clock-plus",
  "alarm-smoke", "album", "align-center", "align-center-horizontal", "align-center-vertical",
  "align-end-horizontal", "align-end-vertical", "align-horizontal-distribute-center",
  "align-horizontal-distribute-end", "align-horizontal-distribute-start", "align-horizontal-justify-center",
  "align-horizontal-justify-end", "align-horizontal-justify-start", "align-horizontal-space-around",
  "align-horizontal-space-between", "align-justify", "align-left", "align-right", "align-start-horizontal",
  "align-start-vertical", "align-vertical-distribute-center", "align-vertical-distribute-end",
  "align-vertical-distribute-start", "align-vertical-justify-center", "align-vertical-justify-end",
  "align-vertical-justify-start", "align-vertical-space-around", "align-vertical-space-between",
  "ambulance", "ampersand", "ampersands", "amphora", "anchor", "angry", "annoyed", "antenna", "anvil",
  "aperture", "app-window", "app-window-mac", "apple", "archive", "archive-restore", "archive-x",
  "armchair", "arrow-big-down", "arrow-big-down-dash", "arrow-big-left", "arrow-big-left-dash",
  "arrow-big-right", "arrow-big-right-dash", "arrow-big-up", "arrow-big-up-dash", "arrow-down",
  "arrow-down-from-line", "arrow-down-left", "arrow-down-narrow-wide", "arrow-down-right",
  "arrow-down-to-dot", "arrow-down-to-line", "arrow-down-up", "arrow-down-wide-narrow", "arrow-left",
  "arrow-left-from-line", "arrow-left-right", "arrow-left-to-line", "arrow-right",
  "arrow-right-from-line", "arrow-right-left", "arrow-right-to-line", "arrow-up", "arrow-up-from-dot",
  "arrow-up-from-line", "arrow-up-left", "arrow-up-narrow-wide", "arrow-up-right", "arrow-up-to-line",
  "arrow-up-wide-narrow", "arrows-up-from-line", "asterisk", "at-sign", "atom", "audio-lines",
  "audio-waveform", "award", "axe", "axis-3d", "baby", "backpack", "badge", "badge-alert", "badge-cent",
  "badge-check", "badge-dollar-sign", "badge-euro", "badge-indian-rupee", "badge-info",
  "badge-japanese-yen", "badge-minus", "badge-percent", "badge-plus", "badge-pound-sterling",
  "badge-russian-ruble", "badge-swiss-franc", "badge-x", "baggage-claim", "ban", "banana", "bandage",
  "banknote", "barcode", "bar-chart",
  "bar-chart-big", "bar-chart-decreasing", "bar-chart-increasing", "bar-chart-stacked", "baseline", "bath",
  "battery", "battery-charging", "battery-full", "battery-low", "battery-medium", "battery-warning",
  "beaker", "bean", "bean-off", "bed", "bed-double", "bed-single", "beef", "beer",
  "beer-off", "bell", "bell-dot", "bell-electric", "bell-minus", "bell-off", "bell-plus", "bell-ring",
  "between-horizontal-end", "between-horizontal-start", "between-vertical-end", "between-vertical-start",
  "biceps-flexed", "bike", "binary", "binoculars", "biohazard", "bird", "bitcoin", "blend",
  "blinds", "blocks", "bluetooth", "bluetooth-connected", "bluetooth-off", "bluetooth-searching", "bold",
  "bolt", "bomb", "bone", "book", "book-a", "book-audio", "book-check", "book-copy",
  "book-dashed", "book-down", "book-headphones", "book-heart", "book-image", "book-key", "book-lock",
  "book-marked", "book-minus", "book-open", "book-open-check", "book-open-text", "book-plus",
  "book-text", "book-type", "book-up", "book-up-2", "book-user", "book-x", "bookmark",
  "bookmark-check", "bookmark-minus", "bookmark-plus", "bookmark-x", "boom-box", "bot",
  "bot-message-square", "bot-off", "box", "boxes", "box-select", "braces", "brackets", "brain",
  "brain-circuit", "brain-cog", "brick-wall", "briefcase",
  "briefcase-business", "briefcase-conveyor-belt", "briefcase-medical", "bring-to-front", "brush",
  "bug", "bug-off", "bug-play", "building", "building-2", "bus", "bus-front",
  "cable", "cable-car", "cake", "cake-slice", "calculator", "calendar", "calendar-arrow-down",
  "calendar-arrow-up", "calendar-check", "calendar-check-2", "calendar-clock", "calendar-cog",
  "calendar-days", "calendar-fold", "calendar-heart", "calendar-minus", "calendar-minus-2", "calendar-off",
  "calendar-plus", "calendar-plus-2", "calendar-range",
  "calendar-search", "calendar-sync", "calendar-x", "camera", "camera-off", "candy", "candy-cane",
  "candy-off", "cannabis", "captions", "captions-off", "car", "car-front", "car-taxi-front", "caravan",
  "carrot", "case-lower", "case-sensitive", "case-upper", "cassette-tape", "cast", "castle", "cat", "cctv",
  "chart-area", "chart-bar", "chart-bar-big", "chart-bar-decreasing", "chart-bar-increasing",
  "chart-bar-stacked", "chart-candlestick", "chart-column", "chart-column-big", "chart-column-decreasing",
  "chart-column-increasing", "chart-column-stacked", "chart-gantt", "chart-line", "chart-network",
  "chart-no-axes-column", "chart-no-axes-column-decreasing", "chart-no-axes-column-increasing",
  "chart-no-axes-combined", "chart-no-axes-gantt", "chart-pie", "chart-scatter", "chart-spline", "check",
  "check-check", "check-circle", "check-square", "chef-hat", "cherry", "chevron-down", "chevron-left",
  "chevron-right", "chevron-up", "chevrons-down", "chevrons-left", "chevrons-right", "chevrons-up", "circle",
  "circle-dot", "circle-off", "clipboard", "cloud", "cloud-drizzle", "cloud-fog", "cloud-lightning",
  "cloud-moon", "cloud-off", "cloud-rain", "cloud-snow", "cloud-sun", "code", "cog", "columns",
  "compass", "copy", "coffee", "cookie", "cpu", "credit-card", "crop", "crosshair", "crown", "cup-soda", "database",
  "database-backup", "database-zap", "diamond", "dice-1", "dice-2", "dice-3", "dice-4", "dice-5", "dice-6",
  "dollar-sign", "download", "droplet", "droplets", "dribbble", "edit", "eraser", "expand", "eye", "eye-off",
  "facebook", "fast-forward", "feather", "figma", "file", "file-archive", "file-audio", "file-code",
  "file-image", "file-minus", "file-plus", "file-question", "file-search", "file-text", "file-video",
  "file-warning", "filter", "fingerprint", "flask-conical", "folder", "folder-check", "folder-dot",
  "folder-minus", "folder-open", "folder-plus", "folder-symlink", "folder-tree", "folder-x", "framer",
  "fullscreen", "gear", "gem", "gift", "git-branch", "git-commit", "git-merge",
  "git-pull-request", "gitlab", "globe", "globe-lock", "grip-horizontal", "grip-vertical", "hard-drive",
  "hard-drive-download", "hard-drive-upload", "hash", "headphones", "heart", "hexagon", "home", "hourglass",
  "ice-cream", "image", "inbox", "info", "instagram", "italic", "key", "keyboard", "laptop", "layout-grid",
  "layout-list", "layout-template", "line-chart", "link", "linkedin", "list", "list-ordered", "list-todo",
  "lock", "lock-open", "log-in", "log-out", "mail", "mail-open", "map", "map-pin", "maximize",
  "message-circle", "message-square", "mic", "microscope", "minimize", "minus", "minus-circle",
  "minus-square", "monitor", "moon", "moon-star", "mouse", "mouse-pointer", "move", "navigation", "octagon",
  "package", "palette", "paperclip", "pause", "pencil", "pen-tool", "pentagon", "person-standing",
  "pie-chart", "pilcrow", "pizza", "plane", "play", "plus", "plus-circle", "plus-square", "pointer",
  "printer", "quote", "refresh-ccw", "repeat", "rewind", "rotate-ccw", "rotate-cw", "route", "rows", "ruler",
  "scatter-chart", "scissors", "search", "send", "server", "settings", "share", "shield", "shield-off",
  "shopping-bag", "shopping-cart", "shuffle", "skip-back", "skip-forward", "slack", "sliders", "smartphone",
  "sparkles", "speech", "square", "square-dot", "strikethrough", "star", "star-half", "star-off", "sun",
  "sunrise", "sunset", "syringe", "table", "tablet", "tag", "tags", "target", "terminal",
  "terminal-square", "test-tube", "thermometer-snowflake", "train", "trending-down", "trending-up",
  "triangle", "trophy", "truck", "twitch", "twitter", "type", "underline", "unlock", "upload", "user",
  "user-check", "user-circle", "user-cog", "user-minus", "user-plus", "user-square", "user-x", "users",
  "video", "volume", "volume-1", "volume-2", "volume-x", "wallet", "watch", "wifi", "wifi-off", "wind",
  "wine", "x", "x-circle", "x-square", "youtube", "zap", "zoom-in", "zoom-out"
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

    contentEl.createEl("h2", { text: "Set note icon/emoji" });

    // Combined input for search and custom icons/emojis
    new Setting(contentEl)
      .setName("Search icons or enter custom icon/emoji")
      .setDesc("Enter an Obsidian icon ID (e.g., 'star', 'lucide-file'), any emoji (e.g., '📝'), or filter the list below. The field's content will be saved as the icon.")
      .addText((text) =>
        text
          .setPlaceholder("Example: star, folder-tree, 📝")
          .setValue(this.result) // Use 'result' as the primary value for direct input
          .onChange((value) => {
            this.result = value; // Update result directly
            this.searchInput = value.toLowerCase(); // Also update search input for filtering
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
          .setButtonText("Set icon")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(this.result);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Remove icon")
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