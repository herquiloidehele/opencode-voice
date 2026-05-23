# opencode-voice — Design Spec

**Date:** 2026-05-23
**Status:** Draft, pending implementation plan
**Package:** `opencode-voice` (npm)

---

## 1. Overview & Goals

`opencode-voice` is an [opencode](https://opencode.ai) plugin that turns agent activity into spoken audio so the user can step away from or work alongside opencode without watching the terminal.

The plugin subscribes to opencode plugin events, routes each event through a configurable handler (template-formatted or LLM-summarized), sends the resulting text to a pluggable TTS backend, and plays the audio through a priority queue that interrupts for urgent events and dedupes stale ones.

### Goals

- Zero-friction default: `npm install opencode-voice` + 2 lines of config gets a user from zero to "agent says 'done' when it finishes" on macOS, Linux, and Windows.
- Pluggable TTS: switching from OS-native TTS to OpenAI TTS is a single config field change.
- Per-event configurable behavior — every event can be toggled, retemplated, or rerouted to LLM narration.
- The plugin never blocks or delays the agent. Speech is fire-and-forget on a separate audio pipeline.
- The plugin never crashes the agent. Any failure (network, missing key, unsupported OS) is logged and silently degraded.

### Non-Goals (v1)

- Speech-to-text / voice input. Would be a separate plugin (`opencode-listen`).
- Multi-language localization beyond what each TTS backend natively supports.
- User-overridable templates or LLM prompts (templates are fixed in v1; v2 may add locale + custom-template support).
- Bundled local neural TTS models (e.g. Piper, Coqui). Users may add these via the custom-provider hook.

### Success Criteria

1. Default install on macOS, Linux, and Windows produces audible output for `session.idle`, `session.error`, and `permission.asked` events without any provider configuration.
2. Switching `voice.tts.provider` from `"system"` to `"openai"` with a valid `OPENAI_API_KEY` produces neural-quality output with no other changes.
3. All event-to-speech behavior is controllable via `opencode.json` — no code changes required to mute, narrate, or template-format any supported event.
4. End-to-end latency from event firing to speech beginning is under 250ms for template handlers + system TTS on a baseline laptop.
5. The agent's response time is unaffected by the plugin within measurement noise.

---

## 2. Architecture

### 2.1 Module Layout

```
opencode-voice/
├── src/
│   ├── index.ts                  # Plugin entry — exports OpencodeVoice plugin function
│   ├── config.ts                 # Reads & validates plugin config (Zod schema)
│   ├── dispatcher.ts             # Event router: opencode event → Handler → SpeechRequest → Queue
│   ├── handlers/
│   │   ├── index.ts              # Handler registry, maps event types to handler fns
│   │   ├── template.ts           # Template-based handler (deterministic, instant)
│   │   └── narrator.ts           # LLM-based handler (uses configured narrator model)
│   ├── queue/
│   │   ├── speech-queue.ts       # Priority queue + dedup + interruption logic
│   │   └── types.ts              # SpeechRequest, Priority enum
│   ├── tts/
│   │   ├── provider.ts           # TTSProvider interface + registry
│   │   ├── system.ts             # OS-native TTS (macOS `say`, Linux `spd-say`/`espeak`, Windows PowerShell)
│   │   ├── openai.ts             # OpenAI TTS
│   │   └── elevenlabs.ts         # ElevenLabs TTS
│   ├── audio/
│   │   └── player.ts             # Plays audio buffers; abort handle for interruption
│   ├── commands/
│   │   └── index.ts              # /mute /unmute /say /voice-test /voice-status
│   └── log.ts                    # Wrapper around client.app.log() with redaction
├── test/                         # Vitest unit tests (one per module)
├── package.json
├── tsconfig.json
└── README.md
```

### 2.2 Event Data Flow

```
opencode event
   │
   ▼
dispatcher.ts ── (config: event enabled?) ─── no ──► drop
   │
   yes
   ▼
handlers/index.ts ── pick handler by event type + configured mode
   │
   ├──► template.ts ──► returns SpeechRequest (resolves immediately)
   │
   └──► narrator.ts ──► async LLM call (with timeout, token cap)
                         │
                         └── on failure → fall back to template handler
   │
   ▼
speech-queue.ts ── push(SpeechRequest)
   │
   ├─ priority > currently speaking → abort current, prepend new
   ├─ same dedupKey already queued → replace (newer wins)
   ├─ else → append in priority order
   │
   ▼
tts/<provider>.ts ── synthesize(text, opts, signal) → audio stream/buffer
   │
   ▼
audio/player.ts ── play(audio, contentType, signal)
   │
   ▼
queue advances when both synthesizer and player resolve (or abort)
```

### 2.3 Design Invariants

- **One queue, one synthesizer in flight, one audio player in flight.** Concurrency happens via priority/interrupt logic, not parallel audio streams.
- **Handlers are async-pure**: `(event) → Promise<SpeechRequest | null>`. They never touch audio, queue, or config state. This makes them trivial to unit test.
- **Providers implement a single interface.** Adding a new provider is one file plus optional config schema.
- **The plugin never throws to the host.** All errors caught at module boundaries and routed to `log.ts`.
- **No blocking event handlers.** All opencode event subscribers return immediately; queue and audio run on independent promise chains.

---

## 3. TTS Provider Interface

### 3.1 Interface (`src/tts/provider.ts`)

```ts
export interface SynthesisOptions {
  voice?: string        // provider-specific voice ID (e.g. "Samantha", "alloy", "EXAVITQu...")
  rate?: number         // 0.5–2.0, 1.0 = normal
  pitch?: number        // 0.5–2.0, 1.0 = normal (providers may ignore)
  format?: "wav" | "mp3" | "raw"
}

export interface SynthesisResult {
  audio: ReadableStream<Uint8Array> | Buffer
  contentType: string                          // "audio/wav", "audio/mpeg", etc.
}

export interface TTSProvider {
  readonly name: string
  readonly capabilities: { streaming: boolean; offline: boolean }

  /** Throws on unrecoverable provider issues (missing key, unsupported OS, missing binary). */
  init(config: unknown): Promise<void>

  /** Resolves when audio data is ready. Cancellable via AbortSignal. */
  synthesize(
    text: string,
    opts: SynthesisOptions,
    signal: AbortSignal
  ): Promise<SynthesisResult>

  /** Optional: validate config without doing network calls. */
  validate?(config: unknown): { ok: true } | { ok: false; reason: string }
}
```

### 3.2 Built-in Providers (v1)

| Provider | Implementation | Notes |
|---|---|---|
| `system` (default) | Bun `$` shell-out. macOS: `say -v <voice>`. Linux: `spd-say` then fallback `espeak`. Windows: PowerShell `System.Speech.Synthesis.SpeechSynthesizer`. | Auto-detects OS during `init()`. If no supported binary is found, logs a one-time warning and self-disables the plugin. On all three OSes this provider produces audio itself; the audio player module is bypassed. |
| `openai` | `POST /v1/audio/speech` | Voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. Reads `OPENAI_API_KEY` from env or config. Streams MP3. |
| `elevenlabs` | `POST /v1/text-to-speech/{voice_id}` | Reads `ELEVENLABS_API_KEY` from env or config. Requires `voiceId` in config. Streams MP3. |

### 3.3 Custom Provider Registration

A user's `.opencode/plugins/my-tts.ts` may register additional providers:

```ts
import { registerProvider } from "opencode-voice"

registerProvider({
  name: "my-custom-tts",
  capabilities: { streaming: false, offline: true },
  async init() { /* … */ },
  async synthesize(text, opts, signal) { /* … */ },
})
```

Selected by name in config: `"voice.tts.provider": "my-custom-tts"`.

### 3.4 Audio Playback (`src/audio/player.ts`)

Used for any provider that does not produce its own audio output (i.e. cloud providers).

- **macOS:** pipe audio data to `afplay`.
- **Linux:** detect at startup, in order: `paplay` (PulseAudio) → `aplay` (ALSA) → `ffplay`. First available wins.
- **Windows:** pipe to a small PowerShell script using `System.Media.SoundPlayer` (WAV) or `MediaPlayer` (MP3).
- Cancellation: aborting the `AbortSignal` sends SIGTERM to the playback subprocess.

If no player is found, the plugin logs the missing dependencies and degrades to using the `system` provider only.

---

## 4. Handlers & Generation

### 4.1 Template Handler (`src/handlers/template.ts`)

Pure registry mapping event types to format functions:

```ts
const templates: Record<string, (e: Event) => string | null> = {
  "session.error":       (e) => `Session error: ${truncate(e.message, 80)}.`,
  "permission.asked":    (e) => `Permission requested for ${e.tool}.`,
  "session.compacted":   ()  => `Session compacted.`,
  "tool.execute.before": (e) => `Running ${e.tool}.`,
  "tool.execute.after":  (e) => `${e.tool} done.`,
  "todo.completed.item": (e) => `Task complete: ${truncate(e.content, 40)}.`,
  "message.updated":     (e) => truncate(stripMarkdown(e.text), 300),
}
```

Templates are not user-overridable in v1.

**Note on event names:** opencode's plugin API exposes a single `todo.updated` event. The dispatcher derives two internal sub-events from it — `todo.completed.all` (fires when every todo transitions to `completed`) and `todo.completed.item` (fires once per individual completion transition) — and these are what the handler registry and config keys reference. All other event names in this spec map directly to opencode plugin events as documented at https://opencode.ai/docs/plugins/#events.

### 4.2 Narrator Handler (`src/handlers/narrator.ts`)

Used for `session.idle` and `todo.completed.all`. Calls the configured narrator model via the opencode SDK `client`.

**Prompt:**

```
You are a brief spoken status narrator for a coding agent.
The agent just finished a turn. Summarize what happened in ONE sentence,
under 25 words, spoken style (no markdown, no code, no quotes).

Recent assistant output:
<last ~2000 chars of assistant text>

Recent tool calls:
<bullet list of last 5 tool calls>
```

**Guardrails:**

- Hard cap: 60 output tokens.
- Input context: last ~2000 chars of assistant text + last 5 tool calls.
- Timeout: 5s (configurable as `narrator.timeoutMs`).
- Minimum interval between narrations: 3s (`narrator.minIntervalMs`). Inside that window, fall back to template.
- On timeout / network error / API error: fall back to the matching template handler. Log via `client.app.log()` at `warn` level.

### 4.3 Verbatim Mode

For `message.updated` when configured `"mode": "verbatim"`: strip markdown, truncate to 300 chars, append "…and more" if truncated. Off by default — this mode is for accessibility / "screen reader" use cases.

---

## 5. Speech Queue

### 5.1 Priorities

```ts
enum Priority {
  URGENT = 3,   // permission.asked, session.error
  NORMAL = 2,   // session.idle, todos complete, session.compacted, /say
  CHATTY = 1,   // tool events, per-todo updates, message.updated
}
```

### 5.2 Contract

```ts
class SpeechQueue {
  push(req: SpeechRequest): void          // never blocks, never throws
  mute(): void                             // drops queue, aborts current
  unmute(): void
  size(): number                           // exposed for tests + /voice-status
}

interface SpeechRequest {
  id: string
  priority: Priority
  text: string
  dedupKey?: string                        // typically the event type
  enqueuedAt: number                       // ms epoch
}
```

### 5.3 Rules

Applied in order on every `push`:

1. **Muted** → drop.
2. **Higher priority than currently speaking** → abort current synth + player, prepend new at queue head, advance.
3. **Matching `dedupKey` already in queue** → replace it with the newer request. Never dedupes the request that is currently being spoken.
4. **Otherwise** → insert into queue maintaining priority order (stable within priority — FIFO among equals).

Before dequeuing the next item:

5. **Stale drop:** if the item's priority is ≤ NORMAL and it has been in queue more than `queue.staleMs` (default 8000ms), drop it and pick the next.

### 5.4 State Machine

```
IDLE ──push──► SYNTHESIZING ──ready──► PLAYING ──done──► IDLE
   ▲                │                      │
   │                └──abort──┐            │
   │                          ▼            │
   └──────────── (next item)  CANCELLED ◄──┘
```

Only one of SYNTHESIZING/PLAYING is active at a time per queue. `IDLE` is checked when `push` arrives to decide whether to start immediately.

---

## 6. Configuration

### 6.1 Schema (Zod-validated)

User config lives under `voice` in `opencode.json`:

```json
{
  "plugin": ["opencode-voice"],
  "voice": {
    "enabled": true,
    "tts": {
      "provider": "system",
      "voice": "Samantha",
      "rate": 1.0,
      "pitch": 1.0
    },
    "narrator": {
      "model": "anthropic/claude-haiku-4",
      "maxTokens": 60,
      "timeoutMs": 5000,
      "minIntervalMs": 3000
    },
    "events": {
      "session.idle":         { "enabled": true,  "mode": "narrate" },
      "session.error":        { "enabled": true,  "mode": "template", "priority": "urgent" },
      "session.compacted":    { "enabled": true,  "mode": "template" },
      "permission.asked":     { "enabled": true,  "mode": "template", "priority": "urgent" },
      "todo.completed.all":   { "enabled": true,  "mode": "narrate" },
      "todo.completed.item":  { "enabled": false, "mode": "template" },
      "tool.execute.before":  { "enabled": false, "mode": "template" },
      "tool.execute.after":   { "enabled": false, "mode": "template" },
      "message.updated":      { "enabled": false, "mode": "verbatim" }
    },
    "queue": {
      "staleMs": 8000
    }
  }
}
```

### 6.2 Provider-Specific Config

Provider-specific fields nest under the provider name:

```json
{
  "voice": {
    "tts": {
      "provider": "openai",
      "voice": "nova",
      "openai": { "apiKey": "...", "model": "tts-1" },
      "elevenlabs": { "apiKey": "...", "voiceId": "EXAVITQu4vr4xnSDxMaL" }
    }
  }
}
```

API keys fall back to environment variables (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`).

### 6.3 Validation

- Zod schema validation at startup.
- On invalid config: log an error (with the Zod issues, redacted of any key fields) and disable the plugin. The agent continues normally.
- `voice.events.<unknown-event>` is allowed (forward compat) but logged at debug level.

### 6.4 Environment Overrides

- `OPENCODE_VOICE_MUTE=1` — start muted.
- `OPENCODE_VOICE_DISABLED=1` — load the plugin but do nothing. Useful for CI.

---

## 7. Commands

Registered via opencode's command mechanism (exact API to be confirmed during implementation):

| Command | Behavior |
|---|---|
| `/mute` | Drop queue, abort current speech, set muted state. |
| `/unmute` | Clear muted state. Does **not** re-speak missed events. |
| `/say <text>` | Speak the given text immediately at NORMAL priority. Useful for testing voices. |
| `/voice-test` | Speak a short canned line through the current provider. Verifies setup. |
| `/voice-status` | Print (not speak) current config: provider, voice, mute state, queue size. |

If opencode's slash command API turns out to be unavailable for plugins, these features fall back to:

- Mute/unmute via env vars + a `voice` custom tool the agent can invoke.
- `/voice-test` as a small CLI bin shipped with the package: `npx opencode-voice test`.

---

## 8. Testing Strategy

### 8.1 Unit Tests (Vitest)

- **`template.ts`** — every template returns expected string for representative event payloads, including truncation behavior.
- **`narrator.ts`** — mocked client. Verifies prompt construction, token caps, timeout fallback to template, `minIntervalMs` fallback, error fallback. No real LLM calls.
- **`speech-queue.ts`** — highest-coverage module. Tests for: priority interrupt, dedup-by-key, stale drop, mute/unmute, FIFO-within-priority ordering, currently-speaking-not-deduped invariant.
- **`config.ts`** — Zod schema accepts good configs, rejects bad ones with clear messages, env var fallbacks work, unknown event keys log but don't crash.
- **`tts/system.ts`** — mocks Bun `$`; verifies correct command per OS, voice/rate flag formatting, abort behavior.
- **`tts/openai.ts`, `tts/elevenlabs.ts`** — mock `fetch`; verifies request shape, header redaction in logs, stream cancellation on abort.
- **`audio/player.ts`** — mocks subprocess spawn; verifies player binary selection per OS and that abort sends SIGTERM.

### 8.2 Integration Test

One end-to-end test on the host OS using the `system` provider:

- Spin up the plugin with a minimal config.
- Push a `SpeechRequest` directly to the queue.
- Assert the subprocess pipeline exits with code 0 within a 5s timeout.
- Audio output itself is not asserted (no waveform capture).

### 8.3 Manual Smoke Checklist (README)

- Run `/voice-test` on each supported OS.
- Trigger real `session.idle` and `permission.asked` events in an opencode session.
- Switch `voice.tts.provider` to `openai` and re-run `/voice-test`.

---

## 9. Distribution

- Published to npm as `opencode-voice`.
- Built with `tsup` to ESM. TypeScript types exported.
- `peerDependencies: { "@opencode-ai/plugin": "*" }` — loose while the plugin API stabilizes; pin a minimum once it's 1.0.
- Pre-1.0 semver until opencode's plugin API is stable.
- Listed in opencode's [plugin ecosystem page](https://opencode.ai/docs/ecosystem) once stable.

**README sections (planned):**

1. Quick start — 3-line install + minimal config.
2. Provider setup — `system`, `openai`, `elevenlabs` with env var examples.
3. Event reference table (matches Section 6.1).
4. Troubleshooting — Linux audio (`libnotify` / `pulseaudio`); Windows execution policy; missing `say`/`spd-say`.
5. Writing custom providers — link to `registerProvider` example.

---

## 10. Risks & Open Questions

| Risk | Mitigation / Resolution Path |
|---|---|
| **opencode plugin API instability** — events, command registration, or SDK shape may change. | Loose peer dep; thin handlers; integration smoke test on opencode upgrades. Confirm exact event payload shapes during implementation. |
| **Per-OS audio playback is finicky** — Linux audio especially fragmented. | Detect with explicit fallbacks (`paplay` → `aplay` → `ffplay`). Clear log message when no player is found. Document required packages in README. |
| **Slash command registration mechanism** — exact opencode API for plugin-registered commands not yet confirmed in our context. | Investigate during implementation plan. Fallback: env-var toggles + a `voice` custom tool the agent can invoke + a `opencode-voice` CLI bin for setup tests. |
| **LLM cost surprise** — frequent `session.idle` narrations add up. | `minIntervalMs` guard, hard 60-token output cap, cost note in README. Defaults narrate only 2 event types. |
| **Speech blocking on long verbatim text** — `message.updated` could read 5-minute outputs. | Truncate verbatim mode to 300 chars + "…and more". Off by default. |
| **API key leakage in logs** — accidental log of config or request headers. | Centralized redaction in `log.ts`; never log full config object; provider modules wrap their HTTP clients to strip Authorization headers before logging. |
| **Bun `$` availability in plugin runtime** — opencode runs plugins in Bun, but the host shell config affects subprocess behavior. | All shell-outs use explicit absolute paths where possible and quote arguments via `shescape` or Bun's parameterized `$`. No string concatenation of user input into shell commands. |

---

## 11. Out of Scope

Explicitly deferred for v2 or later:

- Speech-to-text input (separate plugin).
- Custom user templates / custom narrator prompts.
- Localization beyond TTS-provider-native language support.
- Bundled local neural TTS models.
- Audio output to non-default devices, or per-event voice/provider selection.
- "Re-speak missed events" after unmute.
- Sound effects / earcons for events (e.g. a beep before each utterance).
