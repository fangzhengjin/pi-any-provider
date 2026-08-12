# PI Custom Provider

A minimal PI extension for managing custom model gateways from the terminal UI.

It delegates requests to PI's built-in Anthropic Messages and OpenAI Responses implementations. The extension does not implement its own streaming protocol, pricing service, model-brand detection, or compatibility override system.

## Features

- `/providers` management UI
- Multiple custom providers
- Manual model identifiers or standard `/v1/models` discovery
- Anthropic Messages and OpenAI Responses
- One default protocol with ordered `*` and `?` model-pattern exceptions
- Hidden API-key input stored through PI's native credential storage
- Empty URL or key input keeps the current value
- Automatic PI built-in capability reuse without cross-protocol compatibility leakage

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

The first item adds a provider. Configured providers appear below it.

Enter a provider name first. The extension creates the internal PI identifier automatically, including a numeric suffix when another provider already uses the same name-derived identifier.

Then enter a gateway root URL such as:

```text
https://gateway.example.com
```

The extension derives:

- model discovery: `/v1/models`
- Anthropic Messages: `/v1/messages`
- OpenAI Responses: `/v1/responses`

When editing an existing provider:

- submit an empty URL to keep the current URL;
- submit an empty API key to keep the current key;
- select “Keep current” to keep the current request protocol;
- if every value is unchanged, nothing is written or re-registered.

Switch to a model from another provider before editing, refreshing, or deleting the currently active provider.

## Model metadata

Exact model identifiers reuse PI's known protocol-neutral capabilities, including reasoning, supported inputs, context window, and maximum output. If PI already knows the model under the selected protocol, compatible protocol metadata is also retained.

Unknown models use conservative defaults. Costs remain zero because a custom gateway route does not establish upstream pricing.

Advanced model corrections continue to use PI's native model overrides. The extension does not create a competing override format.

## Internal state

The extension maintains an internal provider state file under PI's extension settings directory. It is not a supported user configuration interface. API keys never enter that file; PI stores them in its native credential store.

## Development

This project uses Bun.

```bash
bun install
bun test
bun run check
```
