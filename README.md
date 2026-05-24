# opencode-voice-tts

Voice plugin for [opencode](https://opencode.ai). Speaks agent activity through pluggable text-to-speech backends — works offline with your OS's built-in voice, or with OpenAI / ElevenLabs for higher quality.

## Quick Start

1. Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-voice-tts"]
}
```

2. Start opencode. The plugin will use your OS's built-in voice (macOS `say`, Linux `spd-say`/`espeak`, Windows PowerShell).

3. By default you'll hear: session completions (LLM-summarized), errors, permission requests, "all todos complete", and session compactions.

## Configuration

opencode passes per-plugin config via the **tuple form** in the `plugin`
array — *not* as a top-level key. Don't put `"voice": { … }` at the top of
`opencode.json`; opencode's schema validator will reject it with
`Unrecognized key: voice`. Instead:

```json
{
  "plugin": [
    ["opencode-voice-tts", { "tts": { "provider": "system", "voice": "Samantha" } }]
  ]
}
```

All configuration snippets below show the **inner options object** (the
second element of that tuple). Put them inside `["opencode-voice-tts", { … }]`.

Full example:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-voice-tts",
      {
        "tts": { "provider": "system", "voice": "Samantha", "rate": 1.0 },
        "narrator": { "model": "openai/gpt-4o-mini" },
        "events": {
          "tool.execute.before": { "enabled": true }
        }
      }
    ]
  ]
}
```

## Providers

### System (default, zero-config)

```json
{ "tts": { "provider": "system", "voice": "Samantha" } }
```

- macOS: any installed voice. Try `say -v ?` for the list.
- Linux: requires `speech-dispatcher` (`spd-say`) or `espeak`.
- Windows: uses built-in `System.Speech.Synthesis.SpeechSynthesizer`.

### OpenAI

```json
{
  "tts": {
    "provider": "openai",
    "voice": "nova"
  }
}
```

Set `OPENAI_API_KEY` in your environment, or `tts.openai.apiKey` in config.

### ElevenLabs

```json
{
  "tts": {
    "provider": "elevenlabs",
    "elevenlabs": { "voiceId": "EXAVITQu4vr4xnSDxMaL" }
  }
}
```

Set `ELEVENLABS_API_KEY` in env or config.

## Startup Greeting

The plugin speaks a short greeting once after it finishes initializing. Defaults to `"opencode voice ready"`.

```json
{
  "greeting": "welcome back"
}
```

Set to an empty string to disable:

```json
{ "greeting": "" }
```

The greeting is automatically skipped when `startMuted` is `true` or `OPENCODE_VOICE_MUTE=1` is set.

## Event Configuration

Every event is independently configurable. Defaults:

| Event | Default | Mode |
|---|---|---|
| `session.idle` | on | narrate (LLM summary) |
| `session.error` | on | template, urgent |
| `session.compacted` | on | template |
| `permission.asked` | on | template, urgent |
| `todo.completed.all` | on | narrate |
| `todo.completed.item` | off | template |
| `tool.execute.before` | off | template |
| `tool.execute.after` | off | template |
| `message.updated` | off | verbatim |

Example — enable per-tool narration:

```json
{
  "events": {
    "tool.execute.before": { "enabled": true, "mode": "template" }
  }
}
```

## Narrator Model

When `mode: "narrate"` is used, opencode-voice-tts asks a small LLM to produce a one-sentence summary. Configure it:

```json
{
  "narrator": {
    "model": "openai/gpt-4o-mini",
    "maxTokens": 60,
    "timeoutMs": 5000,
    "minIntervalMs": 3000
  }
}
```

The narrator is hard-capped at 60 tokens and will fall back to a template if the call fails or is too frequent.

## Controls

Via the `voice` custom tool (the agent can invoke this; you can also call it):

- `{ "action": "mute" }` — drop the queue, stop the current utterance.
- `{ "action": "unmute" }` — re-enable.
- `{ "action": "say", "text": "hello" }` — speak arbitrary text.
- `{ "action": "test" }` — speak a canned line. Useful for verifying setup.
- `{ "action": "status" }` — JSON status (provider, voice, mute, queue size).

Environment flags:

- `OPENCODE_VOICE_MUTE=1` — start muted.
- `OPENCODE_VOICE_DISABLED=1` — load the plugin but do nothing.

## Custom Providers

Register custom providers from `opencode-voice-tts/api` (not the main module — the
main module is reserved for the plugin loader's contract):

```ts
import { registerProvider } from "opencode-voice-tts/api"

registerProvider({
  name: "my-tts",
  capabilities: { streaming: false, offline: true },
  async init() { /* … */ },
  async synthesize(text, opts, signal) {
    return { audio: Buffer.from(/* … */), contentType: "audio/wav" }
  },
})
```

Then in config:

```json
{ "voice": { "tts": { "provider": "my-tts" } } }
```

## Local Development & Validation

Five runnable demo scripts let you exercise each feature without booting opencode. All use `tsx` (no separate build step needed) and call into the source directly.

| Script | What it validates |
|---|---|
| `npm run demo:say -- "text"` | Synthesis + playback for any provider. Add `--provider=openai --voice=nova` (needs `OPENAI_API_KEY`). |
| `npm run demo:queue` | The speech queue's priority interrupt + dedup behavior. You should hear interruption mid-sentence and three deduped requests collapse to one. |
| `npm run demo:event -- <event.type>` | The full event-to-audio pipeline. Examples: `session.idle`, `session.error --message="boom"`, `permission.asked --tool=write`, `todo.completed.all`. Enable normally-off events with `--enable=tool.execute.before`. |
| `npm run demo:narrator -- --assistant-text="..." --tool=bash` | The LLM narrator handler. Needs `OPENAI_API_KEY`. Prints + speaks the generated summary. Use `--no-speak` to print only. |
| `npm run demo:config -- '{...json...}'` or `--file=path.json` or `--defaults` | Validates a config block against the Zod schema and prints the resolved (defaults-applied) result. |

Plus the standard verification commands:

```bash
npm test               # full unit + integration suite (93 tests)
npm test -- speech-queue.test.ts   # one specific suite
npm run typecheck      # TypeScript validation
npm run build          # produce dist/
```

### Recommended local validation flow

When you change something, run in this order:

1. **`npm test`** — catches regressions in the affected module.
2. **`npm run demo:<feature>`** — audibly confirms the feature still does what you expect.
3. **Restart opencode against your local plugin** (`rm -rf ~/.cache/opencode/node_modules/opencode-voice-tts && npm run build && restart opencode`).

---

## Troubleshooting

**No audio on Linux:** install `speech-dispatcher` (`sudo apt install speech-dispatcher`) or `espeak`. For cloud-provider audio playback, install `pulseaudio-utils` (provides `paplay`) or `alsa-utils` (`aplay`) or `ffmpeg` (`ffplay`).

**Windows blocked by execution policy:** run PowerShell once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**System voice not found on macOS:** list available voices with `say -v ?`. Some voices need to be downloaded via System Settings → Spoken Content.

**Plugin self-disables silently:** check opencode's log file — `opencode-voice-tts` errors are logged at `error` / `warn` level via opencode's logging.

## License

MIT.
