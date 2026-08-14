import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  SelectList,
  type SelectItem,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface PiManagedProviderStructuredMenuItem {
  value: string;
  label: string;
  details?: readonly [string, string];
  section?: "main" | "actions";
}

export interface PiManagedProviderStructuredMenuOptions {
  title: string;
  description: string;
  columns?: readonly [string, string, string];
  mainSectionTitle?: string;
  actionsSectionTitle?: string;
  items: readonly PiManagedProviderStructuredMenuItem[];
  hint: string;
}

function padManagedProviderCell(value: string, width: number): string {
  const truncated = truncateToWidth(value, width, "…");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export class PiManagedProviderStructuredMenuComponent {
  private readonly selectList: SelectList;
  private selectedIndex = 0;

  constructor(
    private readonly options: PiManagedProviderStructuredMenuOptions,
    private readonly theme: ExtensionCommandContext["ui"]["theme"],
    onSelect: (value: string) => void,
    onCancel: () => void,
  ) {
    const items: SelectItem[] = options.items.map((item) => ({ value: item.value, label: item.label }));
    this.selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", theme.bold(text)),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("muted", text),
    });
    this.selectList.onSelect = (item) => onSelect(item.value);
    this.selectList.onCancel = onCancel;
    this.selectList.onSelectionChange = (item) => {
      const index = options.items.findIndex((entry) => entry.value === item.value);
      if (index >= 0) this.selectedIndex = index;
    };
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }

  invalidate(): void {
    this.selectList.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const lines = [
      truncateToWidth(this.theme.fg("accent", this.theme.bold(this.options.title)), safeWidth, "…"),
    ];
    if (this.options.description) {
      lines.push("");
      for (const line of wrapTextWithAnsi(this.options.description, safeWidth)) {
        lines.push(this.theme.fg("muted", truncateToWidth(line, safeWidth, "…")));
      }
    }
    lines.push("");

    const wideLayout = this.getWideLayout(safeWidth);
    const maxVisible = wideLayout ? 10 : 4;
    const startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.options.items.length - maxVisible),
    );
    const endIndex = Math.min(startIndex + maxVisible, this.options.items.length);
    let lastSection: PiManagedProviderStructuredMenuItem["section"] | undefined;

    for (let index = startIndex; index < endIndex; index++) {
      const item = this.options.items[index]!;
      const section = item.section ?? "main";
      if (section !== lastSection) {
        const sectionTitle = section === "actions"
          ? this.options.actionsSectionTitle
          : this.options.mainSectionTitle;
        if (sectionTitle) lines.push(this.renderDivider(sectionTitle, safeWidth));
        if (section === "main" && wideLayout && this.options.columns) {
          lines.push(this.renderWideHeader(wideLayout, safeWidth));
        }
        lastSection = section;
      }
      lines.push(...this.renderItem(item, index === this.selectedIndex, wideLayout, safeWidth));
    }

    if (startIndex > 0 || endIndex < this.options.items.length) {
      lines.push(this.theme.fg("dim", `  (${this.selectedIndex + 1}/${this.options.items.length})`));
    }
    lines.push("");
    lines.push(this.theme.fg("dim", truncateToWidth(this.options.hint, safeWidth, "…")));
    return lines.map((line) => truncateToWidth(line, safeWidth, "…"));
  }

  private getWideLayout(width: number): { primary: number; secondary: number; tertiary: number } | undefined {
    if (!this.options.columns || width < 68) return undefined;
    const mainItems = this.options.items.filter((item) => (item.section ?? "main") === "main" && item.details);
    const secondary = Math.min(22, Math.max(
      visibleWidth(this.options.columns[1]),
      ...mainItems.map((item) => visibleWidth(item.details![0])),
    ));
    const tertiary = Math.min(18, Math.max(
      visibleWidth(this.options.columns[2]),
      ...mainItems.map((item) => visibleWidth(item.details![1])),
    ));
    const columnGaps = tertiary > 0 ? 4 : 2;
    const primary = Math.min(36, width - 2 - secondary - tertiary - columnGaps);
    return primary >= 16 ? { primary, secondary, tertiary } : undefined;
  }

  private renderDivider(label: string, width: number): string {
    const content = `${label} `;
    return this.theme.fg("dim", truncateToWidth(
      content + "─".repeat(Math.max(0, width - visibleWidth(content))),
      width,
      "",
    ));
  }

  private renderWideHeader(
    layout: { primary: number; secondary: number; tertiary: number },
    width: number,
  ): string {
    const columns = this.options.columns!;
    const secondary = `  ${padManagedProviderCell(columns[1], layout.secondary)}`;
    const tertiary = layout.tertiary > 0
      ? `  ${padManagedProviderCell(columns[2], layout.tertiary)}`
      : "";
    return this.theme.fg("dim", truncateToWidth(
      `  ${padManagedProviderCell(columns[0], layout.primary)}${secondary}${tertiary}`,
      width,
      "",
    ));
  }

  private renderItem(
    item: PiManagedProviderStructuredMenuItem,
    selected: boolean,
    wideLayout: { primary: number; secondary: number; tertiary: number } | undefined,
    width: number,
  ): string[] {
    const prefix = selected ? "› " : "  ";
    if (wideLayout && item.details) {
      const secondary = `  ${padManagedProviderCell(item.details[0], wideLayout.secondary)}`;
      const tertiary = wideLayout.tertiary > 0
        ? `  ${padManagedProviderCell(item.details[1], wideLayout.tertiary)}`
        : "";
      const line = `${prefix}${padManagedProviderCell(item.label, wideLayout.primary)}${secondary}${tertiary}`;
      return [selected
        ? this.theme.fg("accent", this.theme.bold(truncateToWidth(line, width, "…")))
        : truncateToWidth(line, width, "…")];
    }

    const primary = truncateToWidth(`${prefix}${item.label}`, width, "…");
    const lines = [selected ? this.theme.fg("accent", this.theme.bold(primary)) : primary];
    if (!item.details || !this.options.columns) return lines;
    const labelWidth = Math.max(
      visibleWidth(this.options.columns[1]),
      visibleWidth(this.options.columns[2]),
    );
    lines.push(this.theme.fg("muted", truncateToWidth(
      `    ${padManagedProviderCell(this.options.columns[1], labelWidth)}  ${item.details[0]}`,
      width,
      "…",
    )));
    if (this.options.columns[2] || item.details[1]) {
      lines.push(this.theme.fg("muted", truncateToWidth(
        `    ${padManagedProviderCell(this.options.columns[2], labelWidth)}  ${item.details[1]}`,
        width,
        "…",
      )));
    }
    return lines;
  }
}

export async function selectPiManagedProviderStructuredMenu(
  context: ExtensionCommandContext,
  options: PiManagedProviderStructuredMenuOptions,
): Promise<string | undefined> {
  return context.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const component = new PiManagedProviderStructuredMenuComponent(options, theme, done, () => done(undefined));
    return {
      render: (width) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data) => {
        component.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
