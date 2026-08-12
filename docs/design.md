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

Provider settings live in one internal state file in the PI agent extension settings directory. The file is not a public configuration interface and is user-readable/writable only. API keys are written through PI's native credential storage and never enter extension state. State mutations are serialized with a lock and replace the target atomically.

A configured provider contains:

- stable provider identifier derived automatically from the display name and disambiguated against PI's provider and credential namespaces;
- display name entered by the user;
- normalized gateway root URL;
- manual or discovered model source;
- manual model identifiers or the last successfully discovered identifier snapshot;
- default fallback request protocol;
- exact model protocol settings and ordered wildcard fallback rules stored in one protocol-rule list.

## URL semantics

The TUI accepts a gateway root URL. A trailing `/v1` is normalized away.

- discovery uses `<root>/v1/models`;
- Anthropic Messages models use `<root>`;
- OpenAI Responses models use `<root>/v1`.

## Model construction

Discovery accepts the standard `{ "data": [{ "id": "..." }] }` response only. Identifiers must be non-empty, unique, and free of control characters.

For an exact identifier found in PI's built-in catalog, the extension copies protocol-neutral fields: display name, reasoning flag, thinking level map, input types, context window, and maximum output. Costs remain zero because a gateway route does not prove upstream pricing. When the built-in model already uses the selected protocol, the extension also retains only that protocol's allowed compatibility fields. It never copies provider, URL, headers, or sampling parameters; cross-protocol compatibility fields are discarded.

Unknown identifiers use conservative defaults. Every model receives exactly one final protocol using three levels: an exact model setting first, the first matching ordered wildcard fallback second, and the provider default last.

## TUI flow

The `/providers` home screen has a selectable Add provider item followed by a non-selectable configured-provider divider and the provider list.

Editing an existing provider collects URL, key, and default fallback protocol before committing. Empty URL/key values retain their current values. Escape cancels the whole edit. No changed values means no write or provider registration.

The protocol-routing screen selects exact models from the provider's model list and accepts typed patterns only for wildcard fallbacks. Exact settings are not ordered; wildcard fallbacks can be moved and use first-match semantics.

The provider action screen exposes edit connection, manage model source, manage protocol routing, refresh models, and delete. Updating the active provider reselects the same model after registration. Removing the active model or deleting its provider requires switching first. Destructive actions require confirmation.

## Failure behavior

- Invalid configuration prevents the affected operation and reports the exact problem.
- Failed discovery does not publish an empty or fabricated model list.
- A failed edit leaves the previous registered provider and stored configuration active.
- API keys are never included in thrown messages.
- Non-interactive modes report that `/providers` requires TUI rather than attempting prompts.

## Explicit exclusions

No Chat Completions, OAuth, pricing endpoint, provider-brand rules, model capability probes, stale model cache policy, configuration migration framework, custom stream implementation, or compatibility editor in the first version.
