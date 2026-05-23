# opencode-voice

Voice plugin for [opencode](https://opencode.ai). Speaks agent activity through pluggable text-to-speech backends — works offline with your OS's built-in voice, or with OpenAI / ElevenLabs for higher quality.

## Quick Start

1. Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-voice"]
}
```

2. Start opencode. The plugin will use your OS's built-in voice (macOS `say`, Linux `spd-say`/`espeak`, Windows PowerShell).

3. By default you'll hear: session completions (LLM-summarized), errors, permission requests, "all todos complete", and session compactions.

## Providers

### System (default, zero-config)

```json
{ "voice": { "tts": { "provider": "system", "voice": "Samantha" } } }
```

- macOS: any installed voice. Try `say -v ?` for the list.
- Linux: requires `speech-dispatcher` (`spd-say`) or `espeak`.
- Windows: uses built-in `System.Speech.Synthesis.SpeechSynthesizer`.

### OpenAI

```json
{
  "voice": {
    "tts": {
      "provider": "openai",
      "voice": "nova"
    }
  }
}
```

Set `OPENAI_API_KEY` in your environment, or `voice.tts.openai.apiKey` in config.

### ElevenLabs

```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "elevenlabs": { "voiceId": "EXAVITQu4vr4xnSDxMaL" }
    }
  }
}
```

Set `ELEVENLABS_API_KEY` in env or config.

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
  "voice": {
    "events": {
      "tool.execute.before": { "enabled": true, "mode": "template" }
    }
  }
}
```

## Narrator Model

When `mode: "narrate"` is used, opencode-voice asks a small LLM to produce a one-sentence summary. Configure it:

```json
{
  "voice": {
    "narrator": {
      "model": "openai/gpt-4o-mini",
      "maxTokens": 60,
      "timeoutMs": 5000,
      "minIntervalMs": 3000
    }
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

Register custom providers from `opencode-voice/api` (not the main module — the
main module is reserved for the plugin loader's contract):

```ts
import { registerProvider } from "opencode-voice/api"

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

## Troubleshooting

**No audio on Linux:** install `speech-dispatcher` (`sudo apt install speech-dispatcher`) or `espeak`. For cloud-provider audio playback, install `pulseaudio-utils` (provides `paplay`) or `alsa-utils` (`aplay`) or `ffmpeg` (`ffplay`).

**Windows blocked by execution policy:** run PowerShell once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**System voice not found on macOS:** list available voices with `say -v ?`. Some voices need to be downloaded via System Settings → Spoken Content.

**Plugin self-disables silently:** check opencode's log file — `opencode-voice` errors are logged at `error` / `warn` level via opencode's logging.

## License

MIT.
