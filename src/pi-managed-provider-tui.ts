import {
  DynamicBorder,
  type ExtensionCommandContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  CURSOR_MARKER,
  decodeKittyPrintable,
  type Component,
  type Focusable,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ManagedProviderDefinition, SupportedProviderApi } from "./pi-managed-provider-contracts.js";
import type { ManagedProviderTranslator } from "./pi-managed-provider-localization.js";
import { formatProviderRootUrlForDisplay } from "./pi-managed-provider-routing.js";

export type PiManagedProviderHomeChoice =
  | { type: "add" }
  | { type: "language" }
  | { type: "provider"; providerId: string };

export function formatManagedProviderApi(api: SupportedProviderApi): string {
  return api === "anthropic-messages" ? "Anthropic Messages · /v1/messages" : "OpenAI Responses · /v1/responses";
}

export class PiManagedProviderHomeComponent implements Component {
  private selectedIndex = 0;

  constructor(
    private readonly translator: ManagedProviderTranslator,
    private readonly languageLabel: string,
    private readonly providers: readonly ManagedProviderDefinition[],
    private readonly configuredKeys: ReadonlySet<string>,
    private readonly keybindings: KeybindingsManager,
    private readonly theme: ExtensionCommandContext["ui"]["theme"],
    private readonly onSelect: (choice: PiManagedProviderHomeChoice) => void,
    private readonly onCancel: () => void,
  ) {}

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex = Math.min(this.providers.length + 1, this.selectedIndex + 1);
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      if (this.selectedIndex === 0) this.onSelect({ type: "add" });
      else if (this.selectedIndex === 1) this.onSelect({ type: "language" });
      else {
        const provider = this.providers[this.selectedIndex - 2];
        if (provider) this.onSelect({ type: "provider", providerId: provider.id });
      }
    } else if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.onCancel();
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines = [this.theme.fg("accent", this.theme.bold(this.translator.t("providersTitle"))), ""];
    lines.push(this.renderSelectableLine(this.translator.t("addProvider"), this.selectedIndex === 0, width));
    lines.push(this.renderSelectableLine(
      `${this.translator.t("language")} · ${this.languageLabel}`,
      this.selectedIndex === 1,
      width,
    ));
    lines.push("");
    const dividerLabel = this.translator.t("configuredProviders", { count: this.providers.length });
    const divider = dividerLabel + "─".repeat(Math.max(0, width - visibleWidth(dividerLabel)));
    lines.push(this.theme.fg("dim", truncateToWidth(divider, width, "")));
    if (this.providers.length === 0) {
      lines.push(this.theme.fg("muted", this.translator.t("noProviders")));
    } else {
      for (let index = 0; index < this.providers.length; index++) {
        const provider = this.providers[index]!;
        const selected = this.selectedIndex === index + 2;
        const keyStatus = this.translator.t(this.configuredKeys.has(provider.id) ? "keyConfigured" : "keyMissing");
        const description = this.translator.t("providerDescription", {
          count: provider.modelSource.modelIds.length,
          keyStatus,
          protocol: formatManagedProviderApi(provider.defaultApi),
        });
        lines.push(this.renderSelectableLine(provider.name, selected, width));
        lines.push(truncateToWidth(`    ${formatProviderRootUrlForDisplay(provider.rootUrl)} · ${description}`, width, "…"));
      }
    }
    lines.push("");
    lines.push(this.theme.fg("dim", this.translator.t("homeHint")));
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  private renderSelectableLine(label: string, selected: boolean, width: number): string {
    const prefix = selected ? this.theme.fg("accent", "› ") : "  ";
    const content = selected ? this.theme.bold(label) : label;
    return truncateToWidth(`${prefix}${content}`, width, "…");
  }
}

class PiManagedProviderSecretInput implements Component, Focusable {
  focused = false;
  private value = "";
  private cursor = 0;
  private pasteBuffer = "";
  private pasting = false;

  constructor(
    private readonly keybindings: KeybindingsManager,
    private readonly onSubmit: (value: string) => void,
    private readonly onCancel: () => void,
  ) {}

  handleInput(data: string): void {
    if (data.includes("\x1b[200~")) {
      this.pasting = true;
      this.pasteBuffer = "";
      data = data.replace("\x1b[200~", "");
    }
    if (this.pasting) {
      this.pasteBuffer += data;
      const end = this.pasteBuffer.indexOf("\x1b[201~");
      if (end >= 0) {
        this.insert(this.pasteBuffer.slice(0, end).replace(/[\r\n\t]/gu, ""));
        const remaining = this.pasteBuffer.slice(end + 6);
        this.pasting = false;
        this.pasteBuffer = "";
        if (remaining) this.handleInput(remaining);
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) return this.onCancel();
    if (this.keybindings.matches(data, "tui.input.submit") || data === "\n") return this.onSubmit(this.value);
    if (this.keybindings.matches(data, "tui.editor.deleteCharBackward")) {
      if (this.cursor > 0) {
        this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
        this.cursor--;
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.deleteCharForward")) {
      this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorLeft")) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorRight")) {
      this.cursor = Math.min(this.value.length, this.cursor + 1);
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorLineStart")) {
      this.cursor = 0;
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorLineEnd")) {
      this.cursor = this.value.length;
      return;
    }
    const printable = decodeKittyPrintable(data) ?? data;
    if ([...printable].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return;
    this.insert(printable);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const available = Math.max(1, width - 2);
    const masked = "•".repeat(this.value.length);
    const start = Math.max(0, Math.min(this.cursor - Math.floor(available / 2), masked.length - available + 1));
    const visible = masked.slice(start, start + available);
    const cursor = Math.max(0, this.cursor - start);
    const before = visible.slice(0, cursor);
    const at = visible[cursor] ?? " ";
    const after = visible.slice(cursor + 1);
    const marker = this.focused ? CURSOR_MARKER : "";
    return [truncateToWidth(`> ${before}${marker}\x1b[7m${at}\x1b[27m${after}`, width, "")];
  }

  private insert(value: string): void {
    this.value = this.value.slice(0, this.cursor) + value + this.value.slice(this.cursor);
    this.cursor += value.length;
  }
}

export async function selectPiManagedProviderHome(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  languageLabel: string,
  providers: readonly ManagedProviderDefinition[],
  configuredKeys: ReadonlySet<string>,
): Promise<PiManagedProviderHomeChoice | undefined> {
  return context.ui.custom<PiManagedProviderHomeChoice | undefined>((tui, theme, keybindings, done) => {
    const component = new PiManagedProviderHomeComponent(
      translator,
      languageLabel,
      providers,
      configuredKeys,
      keybindings,
      theme,
      done,
      () => done(undefined),
    );
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

export async function promptPiManagedProviderSecret(
  context: ExtensionCommandContext,
  translator: ManagedProviderTranslator,
  title: string,
  status: string,
): Promise<string | undefined> {
  return context.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    const container = new Container();
    const input = new PiManagedProviderSecretInput(keybindings, done, () => done(undefined));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    container.addChild(new Text(theme.fg("muted", status), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(input);
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", translator.t("secretHint")), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    return {
      get focused() {
        return input.focused;
      },
      set focused(value: boolean) {
        input.focused = value;
      },
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        input.handleInput(data);
        tui.requestRender();
      },
    } as Component & Focusable;
  });
}
