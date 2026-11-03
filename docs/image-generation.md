# Image generation

Bots can create images in a chat: ask "make an image of…" and the bot calls
its `generate_image` tool, on any engine. Bot avatars use the same providers.
The image is attached to the bot's reply when its turn ends, like a voice note.

## Setup

Open **Settings → Image generation** (an AI page shown in Advanced mode; a
link from the avatar editor opens it in Simple mode too). Choose:

- **Base provider**: used first for every image.
- **Backup provider** (optional): used only when the base could not start.
- **Model** for each, or leave it blank for the provider's default.
- **Images per reply**: the most images a bot may create in one turn (1–10,
  default 4).

Bots are shown `generate_image` only while the base or the backup has what it
needs, so a bot never spends a turn finding out it cannot make images.

| Provider | Key | Default model | Endpoint |
| --- | --- | --- | --- |
| OpenAI | its own, in this section | `gpt-image-2` | `api.openai.com/v1/images/generations` |
| Grok (xAI) | the Grok key under **API keys** | `grok-imagine-image-2.0` | `api.x.ai/v1/images/generations` |
| Gemini | its own (Google AI Studio), in this section | `gemini-2.5-flash-image` | `generativelanguage.googleapis.com/v1beta/openai/images/generations` |
| OpenRouter | the OpenRouter key under **API keys** | `google/gemini-2.5-flash-image` | `openrouter.ai/api/v1/images` |
| Custom | optional, in this section | none: enter one | `<base URL>/images/generations` |

Each key goes only to its own provider; a missing key is never borrowed from
another one. Signing in to a ChatGPT, Claude, Gemini, Grok or Copilot
subscription does not give API access, so it does not configure any of these.
Bots on Codex can also use Codex's own image tool, which bills the ChatGPT
plan; that tool is separate from these settings.

## When the backup is used

The backup is tried only when the base confirmed that nothing started, the
same rule the text backups follow:

- the base has no key (or no URL and model, for Custom);
- the connection was refused or the host was not found;
- the base answered HTTP 401, 402, 403 or 429.

A timeout or an HTTP 5xx stays on the base, because the image may already have
been made and billed. A refused request (HTTP 400, including a moderation
block) also stays on the base: OpenMausBot does not retry a refused prompt
with another provider.

When the person names a provider ("make it with Grok"), the bot passes it and
only that provider is tried; it must be the base or the backup.

## Custom gateway compatibility

For a local gateway such as OmniRoute, a base URL might be
`http://127.0.0.1:20128/v1`. OpenMausBot appends `/images/generations`; pasting
that complete endpoint is also accepted. `localhost` and `127.0.0.1` refer to
the machine running the OpenMausBot server, including when you open the app
remotely. Public endpoints require HTTPS. HTTP is supported for local/private
endpoints. URLs must not contain embedded credentials, query parameters, or
fragments.

The gateway must accept a synchronous OpenAI-style Images API request with
`model`, `prompt`, `size`, `n: 1`, and `response_format: "b64_json"`. Its JSON
response must contain `data[0].b64_json` with raw base64-encoded PNG, JPEG, or
WebP bytes. Chat API compatibility alone is insufficient; URL-only responses,
redirects, and asynchronous job responses are not supported.

## Limits

Each decoded image is limited to 10 MiB, the response to 15 MiB, and
generation to two minutes. Provider error bodies are never shown or stored:
an error names only the provider and the HTTP status.
