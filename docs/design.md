# Minimal Generic Provider Extension Design

## Scope

The package registers providers configured through `/providers`. It delegates model requests to PI's built-in Anthropic Messages and OpenAI Responses implementations.

## Single call path

```text
PI custom provider extension entry
  → provider management orchestrator
      → provider configuration store
      → provider secret store
      → model catalog service
      → PI provider registration
```

The orchestrator owns sequencing only. Each leaf owns its validation and file operations. No leaf calls another leaf.

## Stored state

Provider settings and the interface-language preference live in one internal state file in the PI agent extension settings directory. The file is not a public configuration interface and is user-readable/writable only. API keys are written through PI's native credential storage and never enter extension state. State mutations are serialized with a lock and replace the target atomically.

A configured provider contains:

- stable provider identifier derived automatically from the display name and disambiguated against PI's provider and credential namespaces;
- display name entered by the user;
- normalized gateway root URL;
- manual or discovered model source;
- manual model identifiers or the last successfully discovered identifier snapshot;
- default fallback request protocol;
- exact model protocol settings and ordered wildcard fallback rules stored in one protocol-rule list;
- interface language preference: automatic, English, or Simplified Chinese.

## URL semantics

The TUI accepts a gateway root URL. A trailing `/v1` is normalized away.

- discovery uses `<root>/v1/models`;
- Anthropic Messages models use `<root>`;
- OpenAI Responses models use `<root>/v1`.

## Model construction

Discovery accepts the standard `{ "data": [{ "id": "..." }] }` response only. Identifiers must be non-empty, unique, and free of control characters.

For an exact identifier found in PI's built-in catalog, the extension copies protocol-neutral fields: display name, reasoning flag, thinking level map, input types, context window, and maximum output. Costs remain zero because a gateway route does not prove upstream pricing. When the built-in model already uses the selected protocol, the extension also retains only that protocol's allowed compatibility fields. It never copies provider, URL, headers, or sampling parameters; cross-protocol compatibility fields are discarded.

Unknown identifiers use conservative defaults. Every model receives exactly one final protocol using three levels: an exact model setting first, the first matching ordered wildcard fallback second, and the provider default last.

## Native model overrides

Advanced boolean compatibility options remain in PI's native `models.json` `modelOverrides` layer. The extension never stores a second copy in its provider state. Users select a configured model, then choose `Inherit`, `Enabled`, or `Disabled` for options allowed by that model's final protocol.

The override store reads JSONC, changes only the selected property path, preserves comments and unrelated providers, serializes plugin writers with a lock, keeps a 0600 rolling backup, fsyncs a temporary file, and atomically replaces `models.json`. The command then calls PI's existing model-registry refresh for the affected provider and rebinds the active model. Refresh or rebind failure restores the previous file and refreshes the previous runtime state.

## TUI flow

The `/providers` home screen has selectable Add provider and Language items followed by a non-selectable configured-provider divider and the provider list. Language labels are rendered in the current language: Chinese shows `中文（简体）` and `英文`; English shows `Chinese (Simplified)` and `English`.

Editing an existing provider collects URL, key, and default fallback protocol before committing. Empty URL/key values retain their current values. Escape cancels the whole edit. No changed values means no write or provider registration.

The protocol-routing screen selects exact models from the provider's model list and accepts typed patterns only for wildcard fallbacks. Exact settings are not ordered; wildcard fallbacks can be moved and use first-match semantics.

The provider action screen exposes edit connection, manage model source, manage protocol routing, manage native model overrides, refresh models, and delete. Updating the active provider or its model overrides reselects the same model after registration or refresh. Removing the active model or deleting its provider requires switching first. Destructive actions require confirmation.

Automatic language selection first checks the operating-system UI language list, then terminal message locales, JavaScript Intl, and finally English. macOS, Windows, and Linux/Unix use platform-specific sources. Explicit language selection is persisted and takes precedence immediately without reload.

## Failure behavior

- Invalid configuration prevents the affected operation and reports the exact problem.
- Failed discovery does not publish an empty or fabricated model list.
- A failed edit leaves the previous registered provider and stored configuration active.
- API keys are never included in thrown messages.
- Native model override writes keep a backup and restore the previous file and runtime if refresh fails.
- Known user-facing errors are translated at the command boundary; unknown PI, filesystem, and network causes retain their original diagnostic text.
- Non-interactive modes report that `/providers` requires interactive mode rather than attempting prompts.

## Explicit exclusions

No Chat Completions, OAuth, pricing endpoint, provider-brand rules, model capability probes, stale model cache policy, configuration migration framework, or custom stream implementation. The model override editor is intentionally limited to protocol-allowlisted boolean compatibility fields and writes PI's native format rather than introducing a plugin-specific compatibility schema.
