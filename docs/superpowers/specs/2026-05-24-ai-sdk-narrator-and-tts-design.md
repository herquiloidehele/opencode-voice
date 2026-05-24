# AI SDK for Narrator and TTS — Design

> **Historical note (2026-05-24):** This document predates the rename of the plugin package from `opencode-voice-tts` to `opencode-speaker` (see `docs/superpowers/plans/2026-05-24-rename-to-opencode-speaker.md`). Only the plugin identity changed; the `tts.voice` config field and `OPENCODE_VOICE_*` env vars referenced below are unchanged. Substitute `opencode-speaker` wherever you see the old package name.

Date: 2026-05-24
Status: Approved, ready for plan
Target version: `0.2.0` (breaking)

## Summary

Replace the narrator's hand-rolled chat-completions client and the hand-rolled
OpenAI / ElevenLabs TTS providers with Vercel AI SDK calls:

- Narrator uses `generateText` from `ai` with a curated provider map.
- TTS uses `experimental_generateSpeech` from `ai` with the same map.
- Config moves to a unified `provider/model` slug format on both sides.

The user-facing config stays JSON-only (no code-based provider construction).
API keys come from environment variables only.

## Goals

- One implementation path for narrator LLM calls and TTS calls.
- Drop the `ctx.client.chat` shape-sniffing in `src/index.ts:179-189`.
- Delete duplicated HTTP code in `src/tts/openai.ts` and `src/tts/elevenlabs.ts`.
- Make adding new providers a one-line change in the slug resolver.

## Non-goals

- Programmatic model injection (no escape hatch for users to pass pre-built
  `LanguageModel` / `SpeechModel` instances).
- AI Gateway support.
- Streaming TTS or streaming narration.
- New providers beyond what's supported today (`openai`, `anthropic` for
  narrator; `openai`, `elevenlabs`, `system` for TTS).
- Per-event narrator overrides.
- Touching `src/tts/system.ts` (macOS `say`) — stays as-is.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | String-based provider config in JSON | Keep current opencode.json UX; users don't write code. |
| 2 | Bundle `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/elevenlabs` as hard deps | Out-of-the-box experience, JSON config "just works". |
| 3 | Narrator and TTS configured independently | Anthropic narrator + OpenAI TTS is a common combo; matches current shape. |
| 4 | Strict `provider/model` slug, curated providers | Predictable, good error messages; no surprise network calls (e.g. AI Gateway). |
| 5 | Env-var-only API keys | Matches AI SDK defaults; avoids encouraging keys in `opencode.json`. |
| 6 | Single `ai-sdk` TTS provider replaces `openai.ts` and `elevenlabs.ts` | Real fulfilment of "use AI SDK for both" — no half-migration. |
| 7 | TTS config moves to slug shape (breaking) | Symmetry with narrator; eliminates per-provider sub-blocks. |
| 8 | AI SDK official mocks (`ai/test`) in tests | Test our adapter code (slug parsing, voice mapping, error handling) against real AI SDK code paths. |

## Architecture

### New module: `src/ai-sdk/models.ts`

The only place AI SDK provider packages are imported by name.

```ts
import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import { elevenlabs } from "@ai-sdk/elevenlabs"
import type { LanguageModel, SpeechModel } from "ai"

export class ConfigError extends Error {}

const SLUG_RE = /^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/

export function resolveLanguageModel(slug: string): LanguageModel {
  const [provider, modelId] = parseSlug(slug, "narrator.model")
  switch (provider) {
    case "openai":    return openai(modelId)
    case "anthropic": return anthropic(modelId)
    default:
      throw new ConfigError(
        `Unknown narrator provider '${provider}' in '${slug}'. Supported: openai, anthropic`,
      )
  }
}

export type ResolvedSpeech =
  | { provider: "openai" | "elevenlabs"; model: SpeechModel }
  | { provider: "system"; model: null }

export function resolveSpeechModel(slug: string): ResolvedSpeech {
  const [provider, modelId] = parseSlug(slug, "tts.model")
  switch (provider) {
    case "openai":     return { provider, model: openai.speech(modelId) }
    case "elevenlabs": return { provider, model: elevenlabs.speech(modelId) }
    case "system":     return { provider: "system", model: null }
    default:
      throw new ConfigError(
        `Unknown TTS provider '${provider}' in '${slug}'. Supported: openai, elevenlabs, system`,
      )
  }
}

function parseSlug(slug: string, field: string): [string, string] {
  if (!SLUG_RE.test(slug)) {
    throw new ConfigError(`${field} must be 'provider/model' (got '${slug}')`)
  }
  const idx = slug.indexOf("/")
  return [slug.slice(0, idx), slug.slice(idx + 1)]
}
```

### Modified: `src/handlers/narrator.ts`

`NarratorClient` interface deleted. New signature:

```ts
import { generateText, type LanguageModel } from "ai"

export function createNarrator(model: LanguageModel, config: NarratorConfig): Narrator {
  let lastFinishedAt = 0
  return {
    async summarize(event, ctx) {
      const now = Date.now()
      if (now - lastFinishedAt < config.minIntervalMs) return null

      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), config.timeoutMs)
      try {
        const { text } = await generateText({
          model,
          temperature: 0.3,
          prompt: buildPrompt(event, ctx),
          abortSignal: ac.signal,
        })
        lastFinishedAt = Date.now()
        const trimmed = text.trim()
        return trimmed.length > 0 ? trimmed : null
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
```

`buildPrompt` is preserved verbatim from the current implementation.

### New module: `src/tts/ai-sdk.ts`

Implements the existing `TTSProvider` interface.

```ts
import { experimental_generateSpeech as generateSpeech, type SpeechModel } from "ai"
import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

interface AiSdkInitConfig {
  model: SpeechModel
  provider: "openai" | "elevenlabs"
  voice?: string
}

export function createAiSdkProvider(): TTSProvider {
  let model: SpeechModel | null = null
  let provider: "openai" | "elevenlabs" | null = null
  let defaultVoice: string | undefined

  return {
    get name() { return provider ?? "ai-sdk" },
    capabilities: { streaming: true, offline: false },

    async init(config: unknown) {
      const c = config as AiSdkInitConfig
      model = c.model
      provider = c.provider
      defaultVoice = c.voice
    },

    async synthesize(text, opts: SynthesisOptions, signal: AbortSignal): Promise<SynthesisResult> {
      if (!model || !provider) throw new Error("ai-sdk TTS provider not initialized")
      const voice = opts.voice ?? defaultVoice ?? (provider === "openai" ? "alloy" : undefined)
      const result = await generateSpeech({
        model,
        text,
        voice,
        outputFormat: "mp3",
        speed: opts.rate,
        abortSignal: signal,
      })
      return {
        audio: Buffer.from(result.audio.uint8Array),
        contentType: result.audio.mediaType ?? "audio/mpeg",
      }
    },
  }
}
```

The `name` getter reflects the resolved provider so logs read
`provider=openai` exactly as they do today.

### Modified: `src/index.ts`

Replaces lines 72-96 (provider registration + init) and 179-190 (narrator
client construction):

```ts
// Resolve models from config slugs.
let resolvedSpeech: ResolvedSpeech
let languageModel: LanguageModel
try {
  languageModel = resolveLanguageModel(config.narrator.model)
  resolvedSpeech = resolveSpeechModel(config.tts.model)
} catch (err) {
  await logger.error("Invalid model slug; plugin disabled", { error: String(err) })
  return {}
}

// Register TTS provider — system or ai-sdk.
if (resolvedSpeech.provider === "system") {
  registerProvider(createSystemProvider({}))
} else {
  const aiSdkProvider = createAiSdkProvider()
  await aiSdkProvider.init({
    model: resolvedSpeech.model,
    provider: resolvedSpeech.provider,
    voice: config.tts.voice,
  })
  registerProvider(aiSdkProvider)
}

const provider = getProvider(resolvedSpeech.provider)!  // just registered

// ... player setup unchanged ...

const narrator = createNarrator(languageModel, config.narrator)
```

The `(ctx.client as any).chat ? ... : { chat: { completions: { create: throw } } }`
block is deleted entirely. `ctx.client` is no longer consulted for narration.

### Modified: `src/config.ts`

New schema:

```ts
const SLUG_RE = /^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/

const TTSSchema = z.object({
  model: z.string()
    .regex(SLUG_RE, "tts.model must be 'provider/model' (e.g. 'openai/gpt-4o-mini-tts')")
    .default("system/say"),
  voice: z.string().optional(),
  rate:  z.number().min(0.5).max(2.0).default(1.0),
  pitch: z.number().min(0.5).max(2.0).default(1.0),
}).default({})

const NarratorSchema = z.object({
  model: z.string()
    .regex(SLUG_RE)
    .default("anthropic/claude-haiku-4"),
  timeoutMs:     z.number().int().positive().default(5000),
  minIntervalMs: z.number().int().min(0).default(3000),
}).default({})
```

Migration detection runs before zod:

```ts
const tts = (userObj.tts as any) ?? {}
if (typeof tts.provider === "string" || tts.openai !== undefined || tts.elevenlabs !== undefined) {
  return { ok: false, errors: [{
    path: "tts",
    message:
      "v0.2 breaking change: tts.provider / tts.openai / tts.elevenlabs are no longer supported. " +
      "Use 'tts.model' as a slug (e.g. 'openai/gpt-4o-mini-tts' or " +
      "'elevenlabs/eleven_turbo_v2_5'). Move 'tts.elevenlabs.voiceId' to 'tts.voice'. " +
      "Set API keys via env vars (OPENAI_API_KEY, ELEVENLABS_API_KEY, ANTHROPIC_API_KEY). " +
      "See README v0.2 migration section.",
  }]}
}
```

Env-var fallbacks for `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` (current
`src/config.ts:124-131`) are removed — AI SDK reads them directly.

`OPENCODE_VOICE_DISABLED=1` and `OPENCODE_VOICE_MUTE=1` are preserved.

## Data flow

### Startup

1. `parseConfig(options)` — rejects old shape with a migration error.
2. `resolveLanguageModel(config.narrator.model)` — throws `ConfigError` on
   unknown prefix or malformed slug.
3. `resolveSpeechModel(config.tts.model)` — same.
4. Register TTS provider: `system` → `createSystemProvider`; otherwise →
   `createAiSdkProvider` initialized with the resolved speech model.
5. `createNarrator(languageModel, config.narrator)`.
6. Rest of init (audio player, queue, dispatcher, commands) — unchanged.

Any error in steps 1-3 is caught by the existing top-level `try` in
`initPlugin` (`src/index.ts:37-50`), which logs and returns `{}`.

### Narrator runtime

```
event → handler → narrator.summarize(event, ctx)
  → minIntervalMs throttle check → may return null without calling model
  → AbortController + setTimeout(timeoutMs)
  → generateText({ model, prompt, temperature: 0.3, abortSignal })
  → catch any error → return null
  → success: lastFinishedAt = now; return text.trim() || null
```

Returns `string | null`. Handler registry's template fallback (already in
place) handles `null`. Throttle state advances only on success — preserves
current behaviour.

### TTS runtime

```
queue → speak(req, signal) → provider.synthesize(text, opts, signal)
  → experimental_generateSpeech({
      model,
      text,
      voice: opts.voice ?? defaultVoice ?? provider-default,
      outputFormat: "mp3",
      speed: opts.rate,
      abortSignal: signal,
    })
  → { audio: Buffer.from(result.audio.uint8Array),
      contentType: result.audio.mediaType ?? "audio/mpeg" }
  → player.play(audio, contentType, signal)
```

Voice defaults per provider:

| Provider | Default voice if `tts.voice` unset |
|---|---|
| `openai` | `"alloy"` (matches current behaviour) |
| `elevenlabs` | AI SDK's `elevenlabs.speech()` default — `voice` arg omitted |

## Error handling

| Error | Detected at | Behaviour |
|---|---|---|
| Old-shape config (`tts.provider`, `tts.openai`, `tts.elevenlabs`) | `parseConfig` | Plugin returns `{}`, logs migration message. |
| Unknown narrator slug prefix | `resolveLanguageModel` | Plugin returns `{}`, logs `ConfigError` message. |
| Unknown TTS slug prefix | `resolveSpeechModel` | Same. |
| Malformed slug (regex miss) | `resolveX` | Same. |
| Missing API key | AI SDK throws on first call | Narrator → returns `null` (template fallback); TTS → queue's existing `onError` logs and drops request. |
| Network / 5xx / model error | AI SDK throws | Same as above. |
| Narrator timeout | `AbortSignal.timeout` fires | `generateText` throws `AbortError` → narrator returns `null`. |
| TTS abort (user mutes mid-speech) | Queue's signal | `experimental_generateSpeech` aborts; existing queue handling unchanged. |

No new try/catch sites compared to today.

## Config schema (concrete examples)

OpenAI narrator + OpenAI TTS:
```json
{
  "tts":      { "model": "openai/gpt-4o-mini-tts", "voice": "alloy" },
  "narrator": { "model": "openai/gpt-5" }
}
```

Anthropic narrator + ElevenLabs TTS:
```json
{
  "tts":      { "model": "elevenlabs/eleven_turbo_v2_5", "voice": "21m00Tcm4TlvDq8ikWAM" },
  "narrator": { "model": "anthropic/claude-haiku-4" }
}
```

macOS `say` (no API keys needed):
```json
{ "tts": { "model": "system/say" } }
```

Deleted from current schema: `tts.provider`, `tts.openai.*`, `tts.elevenlabs.*`.

## Dependencies

Added to `dependencies` in `package.json`:

- `ai` — pinned to `^5.0.0 <6` (locks against the upcoming v6 mock-class rename).
- `@ai-sdk/openai`
- `@ai-sdk/anthropic`
- `@ai-sdk/elevenlabs`

`zod` stays as today.

## Tests

| File | Action |
|---|---|
| `test/ai-sdk-models.test.ts` | New — slug parser unit tests |
| `test/handlers-narrator.test.ts` | Rewrite — uses `MockLanguageModelV4` |
| `test/tts-ai-sdk.test.ts` | New — uses `MockSpeechModelV3` |
| `test/tts-openai.test.ts` | Delete |
| `test/tts-elevenlabs.test.ts` | Delete |
| `test/config.test.ts` | Add migration-error cases and new-shape default cases |
| `test/integration.test.ts` | Review for old-config references; update if needed |

### Slug parser tests (`test/ai-sdk-models.test.ts`)

- `resolveLanguageModel("openai/gpt-5")` returns non-null.
- `resolveLanguageModel("anthropic/claude-haiku-4")` returns non-null.
- `resolveLanguageModel("unknown/foo")` throws `ConfigError`, message names supported providers.
- `resolveLanguageModel("notaslug")` throws `ConfigError`.
- `resolveSpeechModel("openai/gpt-4o-mini-tts")` returns `{ provider: "openai", model: <non-null> }`.
- `resolveSpeechModel("elevenlabs/eleven_turbo_v2_5")` returns `{ provider: "elevenlabs", model: <non-null> }`.
- `resolveSpeechModel("system/say")` returns `{ provider: "system", model: null }`.
- `resolveSpeechModel("unknown/foo")` throws `ConfigError`.

### Narrator tests (rewrite)

All five existing behaviours preserved:

1. Happy path — `MockLanguageModelV4.doGenerate` returns text; `summarize` returns the trimmed text.
2. Timeout — `doGenerate` sleeps 500ms with `timeoutMs: 20`; `summarize` returns `null`. (If `MockLanguageModelV4` doesn't honour `abortSignal`, use a hand-rolled mock for this case.)
3. Empty response — `doGenerate` returns `content: [{ type: "text", text: "" }]`; `summarize` returns `null`.
4. Throttle — first call succeeds; second call within `minIntervalMs` returns `null` and asserts `doGenerate` was called exactly once.
5. Throttle advances on success only — failure does not advance `lastFinishedAt`.

### TTS provider tests (`test/tts-ai-sdk.test.ts`)

- Happy path: returns `{ audio: Buffer, contentType: "audio/mpeg" }`.
- Voice fallback `openai`: `opts.voice` unset → `"alloy"` is passed to model.
- Voice fallback `elevenlabs`: `opts.voice` unset → no `voice` arg passed.
- Voice override: `opts.voice` set → wins over default.
- Abort: caller's signal aborts → `synthesize` rejects with `AbortError`.
- Model error: `doGenerate` throws → `synthesize` rejects with same error.

### Config migration tests

- Old config with `tts.provider: "openai"` → `parseConfig` returns
  `{ ok: false }`, error message includes `"tts.model"`.
- Old config with `tts.elevenlabs.voiceId` → same.
- Old config with `tts.openai.apiKey` → same.
- New config with `tts.model: "openai/gpt-4o-mini-tts"` → parses cleanly.
- Default config (no `tts` key) → `tts.model === "system/say"`.
- Default config (no `narrator` key) → `narrator.model === "anthropic/claude-haiku-4"`.

### Not tested

- Real network calls to OpenAI / Anthropic / ElevenLabs.
- AI SDK's internal abort propagation — covered by fallback to hand-rolled mock if needed.
- Whole-plugin integration via `OpencodeVoice(ctx, options)` — no such test exists today; out of scope.

## Implementation order

Each step ships green tests before the next starts.

1. **Add deps.** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/elevenlabs`. `npm install`. Build still passes.
2. **Slug resolver.** `test/ai-sdk-models.test.ts` (TDD). Then `src/ai-sdk/models.ts`. Tests pass.
3. **Narrator migration.** Rewrite `test/handlers-narrator.test.ts` against `MockLanguageModelV4`. Change `src/handlers/narrator.ts` signature. Update `src/index.ts`. Tests pass.
4. **AI SDK TTS provider.** `test/tts-ai-sdk.test.ts` (TDD). Then `src/tts/ai-sdk.ts`. Tests pass.
5. **Wire TTS into `src/index.ts`.** Replace old provider registrations with resolver-driven `createAiSdkProvider`. Delete `src/tts/openai.ts`, `src/tts/elevenlabs.ts`, `test/tts-openai.test.ts`, `test/tts-elevenlabs.test.ts`.
6. **Config migration.** Update schema. Add migration-error detection. Add config tests. Tests pass.
7. **Smoke-test demos.** Run all `demo:*` scripts in `package.json` (`say`, `queue`, `event`, `narrator`, `config`, `greet`) against real API keys where applicable. Update any `scripts/*` that reference old config keys.
8. **README + CHANGELOG.** Document new config shape, v0.2 migration section, env-var-only API keys, removal of provider sub-blocks.
9. **Version bump.** `0.1.4` → `0.2.0`.

## Risks

| Risk | Mitigation |
|---|---|
| `experimental_generateSpeech` signature changes in a future `ai` minor | Pin `ai` to `^5.0.0 <6`; CI catches on bump; surface area is one file. |
| `MockLanguageModelV4` doesn't honour `abortSignal` | Hand-rolled mock for the timeout test only. |
| ElevenLabs voice/format defaults differ from current hand-rolled behaviour | Smoke test in step 7. If material, add `providerOptions.elevenlabs` passthrough. |
| `tts-1` vs `gpt-4o-mini-tts` behave differently for `instructions` | We don't expose `instructions` (out of scope). Default voice works for both. |
| Provider packages bloat install size | Measure at step 1; revisit if total install > 10MB before merge. |
| User silently loses voice after upgrade | `parseConfig` migration error is explicit — plugin self-disables and logs. README has migration section. |
| Some user setup relied on `ctx.client.chat` | Was best-effort already (`src/index.ts:179-189` throws if absent). Migration message points at env vars. |

## Definition of done

- `npm test` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
- All `demo:*` scripts run end-to-end (with real API keys where applicable).
- README updated; CHANGELOG entry; version bumped to `0.2.0`.
