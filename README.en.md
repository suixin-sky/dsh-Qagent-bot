# dsh-qqbot Enhanced (English)

An enhanced build of [`@tencent-connect/dsh-qqbot`](https://github.com/tencent-connect/dsh-qqbot)
for the DeepSeek Harness (dsh) Desktop, aimed at running a QQ group bot that feels
like a real group member rather than a command dispatcher.

> Unofficial fork. Not affiliated with Tencent Connect. This repository ships
> compiled `dist/*.js`, not TypeScript sources.

## Features

- **Group gating** — reply on `@`, on a leading bot name, on a summon phrase, or on a
  model-judged conversation continuation; ignore ordinary chatter.
- **Conversation continuity** — for a few minutes after the bot speaks, a small judge
  model decides whether a new message is replying to / laughing at it.
- **Chat archive** — per-conversation `chat.md` plus `images/`, `videos/`, `files/`,
  with 20-day text and 10-day media retention.
- **Member registry** — stable openid + display-name history, so renamed users are
  still recognised.
- **Stickers** — send tagged local sticker images (image library is user-supplied).
- **Model summoning** — "call X online" switches to a local model, "call deepseek back"
  returns to the host default; idle sessions revert automatically.
- **Per-model personas** — different system prompts per model route (persona files are
  user-supplied).
- **ComfyUI generation** — text-to-image / image-to-image and short text-to-video, with
  real WebSocket progress, @-mentions at start/50%/completion, VRAM pre-checks and one
  automatic retry after a CUDA/HIP failure.
- **Path guard** — tools may only touch the workspace and DSH data directories;
  credential-like files are blocked.

## Structure

```
dist/                  compiled plugin code
lib/client.js          settings panel client
templates/chatlog/     blank archive skeleton
templates/personas/    how to add your own persona
templates/stickers/    how to add your own sticker library
源码说明.md             architecture and internals (Chinese)
部署说明.md             install / configure / verify (Chinese)
```

## Requirements

- dsh Desktop, `desktop` profile
- Node.js 20.3+
- A QQ bot AppID / AppSecret
- Optional: ComfyUI (image/video), LM Studio (local model)

## Quick start

See `部署说明.md` for the full procedure. In short:

1. Copy `dist/`, `lib/` and `package.json` into the plugin directory.
2. Edit `cordis.patch.yml` with your AppID/AppSecret and the feature config.
3. Reload and walk through the verification checklist.

Personas, stickers and workflows are intentionally **not** bundled:

- `templates/personas/README.md`
- `templates/stickers/README.md`

## Not included

| Item | Reason |
|---|---|
| Persona prompts | third-party text, no redistribution license |
| Sticker images | unclear provenance/licensing |
| ComfyUI workflows | model/GPU specific |
| Chat logs / member data | runtime data |
| AppID / AppSecret | credentials |

## License

Upstream code: MIT, Copyright (c) 2026 Tencent Connect — see `LICENSE`.
Modifications in this repository are released under the same license. See `NOTICE`.

## Disclaimer

For personal and educational use. Follow the QQ Open Platform rules and your local
laws; you are responsible for deployment, content and compliance.
