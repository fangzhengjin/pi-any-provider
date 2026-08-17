# PI Custom Provider

A minimal PI extension for managing custom model gateways from the terminal UI.

It delegates requests to PI's built-in Anthropic Messages and OpenAI Responses implementations. The extension does not implement its own streaming protocol, pricing service, model-brand detection, or competing compatibility format. Advanced options edit PI's native model overrides.

## Features

- `/providers` management UI
- Multiple custom providers
- Manual model identifiers or standard `/v1/models` discovery
- Anthropic Messages and OpenAI Responses
- Exact model protocols, ordered `*` and `?` wildcard fallbacks, and one provider fallback protocol
- Hidden API-key input stored through PI's native credential storage
- Empty URL or key input keeps the current value
- Automatic PI built-in capability reuse without cross-protocol compatibility leakage
- Complete native compatibility profiles materialized for each final request protocol
- Persistent removal and restoration of unusable discovered models
- Background `/v1/models` refresh through PI's native startup catalog lifecycle
- Automatic operating-system language detection plus English and Simplified Chinese

Chat Completions is intentionally unsupported.

## Install

From a local checkout:

```bash
pi install /absolute/path/to/pi-custom-provider
```

Or try it without installing:

```bash
pi -e /absolute/path/to/pi-custom-provider
```

## Use

Run:

```text
/providers
```

The first item adds a provider. The second changes the interface language. Configured providers appear below them.

Language defaults to automatic detection. The extension checks the operating-system UI language, terminal message locale, and JavaScript Intl in that order, with English as the final fallback. You can explicitly select English or Simplified Chinese. Language names follow the current interface language, and changes apply immediately.

Enter a provider name first. The extension creates the internal PI identifier automatically, including a numeric suffix when another provider already uses the same name-derived identifier.

Then enter a gateway root URL such as:

```text
https://gateway.example.com
```

The extension derives:

- model discovery: `/v1/models`
- Anthropic Messages: `/v1/messages`
- OpenAI Responses: `/v1/responses`

The protocol selected during setup is the final provider fallback. Routing uses this priority:

1. an exact model setting selected from the provider's model list;
2. the first matching ordered wildcard fallback containing `*` or `?`;
3. the provider fallback protocol.

Only wildcard fallbacks require typing a pattern. Exact model settings are always selected from the current model list.

When editing an existing provider:

- submit an empty URL to keep the current URL;
- submit an empty API key to keep the current key;
- select “Keep current” to keep the current request protocol;
- if every value is unchanged, nothing is written or re-registered.

The active provider can be edited or refreshed. PI automatically reselects the same model after registration changes. Switch providers only before deleting the active provider or removing the active model from its model list.

**Manage model list** shows every model's final request protocol and source. Manual models can be removed directly. Discovered models are removed and added to an ignored list so future `/v1/models` refreshes do not restore image-generation, embedding, reranking, speech, or other unusable entries. Ignored models can be restored after the gateway confirms they are still published. The active model and the provider's final remaining model cannot be removed.

On normal interactive startup, discovered providers participate in PI's native background catalog refresh. Successful responses atomically update the saved snapshot, remove obsolete exact protocol rules, and materialize profiles for new models. When the first network refresh changes a provider's final model set, PI shows one localized info notification with added and removed counts; unchanged providers, failures, and later refreshes stay quiet. The active model is retained if the gateway temporarily omits it. A failed or timed-out refresh keeps the previous models and does not interrupt startup; opening PI's model selector later may show PI's standard cached-model warning. Manual model sources never perform startup discovery. `pi --list-models` remains cache-only and shows the last successful snapshot.

## Model metadata

Exact model identifiers reuse PI's known protocol-neutral capabilities, including reasoning, supported inputs, context window, and maximum output. If PI already knows the model under the selected protocol, compatible protocol metadata is also retained.

Unknown models use conservative defaults. Costs remain zero because a custom gateway route does not establish upstream pricing.

Advanced settings appear as **Model protocol capabilities (advanced)**. The extension materializes PI's effective compatibility parameters for each final protocol into native model overrides instead of relying only on request-time fallbacks. Anthropic Messages includes adaptive thinking, temperature, strict tools, cache behavior, tool references, and related fields. OpenAI Responses includes developer messages, session-affinity format, strict and grammar tools, additional tools, cache behavior, and tool search.

The model picker shows aligned Model, Request protocol, and Settings columns on wide terminals, then switches to fixed-indentation detail rows on narrow terminals. Each capability shows `Default (value)` when it matches the protocol and known-model profile; deviations show a forced or custom value. Switching protocol removes the previous protocol's fields and materializes the new profile. For new Anthropic-compatible models, adaptive thinking defaults to enabled unless same-protocol model metadata explicitly opts out.

The extension edits `~/.pi/agent/models.json` with JSONC path-level changes, preserving comments, formatting, unrelated providers, and unknown legal settings. It keeps a 0600 rolling backup at `models.json.pi-custom-provider-backup`, refreshes only the affected provider, and reselects the active model. If refresh fails, the previous file and runtime are restored.

## Internal state

The extension maintains provider definitions, discovered-model snapshots, ignored model identifiers, and the language preference in an internal state file under PI's extension settings directory. It is not a supported user configuration interface. API keys never enter that file; PI stores them in its native credential store. Materialized protocol compatibility profiles and user exceptions remain in PI's native `models.json`.

## Development

This project uses Bun.

```bash
bun install
bun test
bun run check
```
