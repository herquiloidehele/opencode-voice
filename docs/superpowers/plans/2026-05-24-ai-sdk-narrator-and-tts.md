# AI SDK for Narrator and TTS Implementation Plan

> **Historical note (2026-05-24):** This document predates the rename of the plugin package from `opencode-voice-tts` to `opencode-speaker` (see `docs/superpowers/plans/2026-05-24-rename-to-opencode-speaker.md`). Only the plugin identity changed; the `tts.voice` config field and `OPENCODE_VOICE_*` env vars referenced below are unchanged. Substitute `opencode-speaker` wherever you see the old package name.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrator's hand-rolled chat-completions client and the hand-rolled OpenAI/ElevenLabs TTS providers with Vercel AI SDK calls, using a unified `provider/model` slug config format.

**Architecture:** A single `src/ai-sdk/models.ts` module resolves config slugs (e.g. `"openai/gpt-4o-mini-tts"`) into AI SDK model instances. The narrator uses `generateText`. A new `src/tts/ai-sdk.ts` provider implements the existing `TTSProvider` interface via `experimental_generateSpeech`. The macOS `system` provider is untouched. Breaking config change for v0.2.

**Tech Stack:** TypeScript, Vitest, Zod, `ai@^5` (Vercel AI SDK), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/elevenlabs`. Spec: `docs/superpowers/specs/2026-05-24-ai-sdk-narrator-and-tts-design.md`.

---

## Reference: AI SDK shapes used in this plan

These are documented here so every task uses consistent types/names.

**`generateText` (v5):**
```ts
import { generateText } from "ai"
const { text } = await generateText({
  model: LanguageModel,     // from @ai-sdk/openai or @ai-sdk/anthropic
  prompt: string,
  temperature?: number,
  abortSignal?: AbortSignal,
})
```

**`experimental_generateSpeech` (v5):**
```ts
import { experimental_generateSpeech as generateSpeech } from "ai"
const result = await generateSpeech({
  model: SpeechModel,       // from <provider>.speech(modelId)
  text: string,
  voice?: string,
  outputFormat?: "mp3" | "wav" | "pcm",
  speed?: number,
  abortSignal?: AbortSignal,
})
// result.audio.uint8Array : Uint8Array
// result.audio.mediaType  : string | undefined  (e.g. "audio/mpeg")
```

**`MockLanguageModelV4` (`ai/test`):**
```ts
import { MockLanguageModelV4 } from "ai/test"
new MockLanguageModelV4({
  doGenerate: async ({ abortSignal }) => ({
    content: [{ type: "text", text: "..." }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens:  { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined },
    },
    warnings: [],
  }),
})
```

**`MockSpeechModelV3` (`ai/test`):**
```ts
import { MockSpeechModelV3 } from "ai/test"
new MockSpeechModelV3({
  doGenerate: async ({ abortSignal }) => ({
    audio: new Uint8Array([/* bytes */]),
    warnings: [],
    request: { body: undefined },
    response: { timestamp: new Date(), modelId: "test", headers: {} },
  }),
})
```

**Important:** if the actual mock-class export name differs at install time, Task 1 verifies it and Task 3 / Task 4 use the verified name.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add AI SDK deps |
| `src/ai-sdk/models.ts` | Create | Slug parser; returns `LanguageModel` / `SpeechModel` from `provider/model` strings |
| `src/handlers/narrator.ts` | Modify | Use `generateText` instead of `client.chat.completions.create` |
| `src/tts/ai-sdk.ts` | Create | `TTSProvider` impl wrapping `experimental_generateSpeech` |
| `src/tts/openai.ts` | Delete | Replaced by `ai-sdk.ts` |
| `src/tts/elevenlabs.ts` | Delete | Replaced by `ai-sdk.ts` |
| `src/tts/system.ts` | Unchanged | macOS `say` — not AI SDK |
| `src/config.ts` | Modify | New `tts.model` slug schema, migration error for old shape, drop env-key fallbacks |
| `src/index.ts` | Modify | Resolve slugs, register `ai-sdk` or `system` provider, drop `ctx.client.chat` probe |
| `test/ai-sdk-models.test.ts` | Create | Slug parser unit tests |
| `test/handlers-narrator.test.ts` | Rewrite | Uses `MockLanguageModelV4` |
| `test/tts-ai-sdk.test.ts` | Create | Uses `MockSpeechModelV3` |
| `test/tts-openai.test.ts` | Delete | Replaced |
| `test/tts-elevenlabs.test.ts` | Delete | Replaced |
| `test/config.test.ts` | Modify | New-shape defaults + migration-error cases |
| `scripts/narrator.ts` | Rewrite | Use `resolveLanguageModel` + `generateText` instead of hand-rolled fetch |
| `README.md` | Modify | v0.2 migration section, new config docs |
| `CHANGELOG.md` | Create or Modify | v0.2.0 entry |

---

## Task 1: Add AI SDK dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install AI SDK packages**

Run:
```bash
npm install ai@^5 @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/elevenlabs
```

Expected: install succeeds; `package.json` `dependencies` gains four entries.

- [ ] **Step 2: Inspect resolved versions**

Run:
```bash
npm ls ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/elevenlabs --depth=0
```

Expected: each resolves to a single concrete version. Note the `ai` version — it should be `5.x`. If it resolved to `6.x`, downgrade with `npm install ai@^5.0.0` because v6 renames mock classes (we use V4/V3).

- [ ] **Step 3: Verify mock-class export names match the plan**

Run:
```bash
node -e "const t = require('ai/test'); console.log(Object.keys(t).filter(k => k.startsWith('Mock')).sort())"
```

Expected output contains both `MockLanguageModelV4` and `MockSpeechModelV3` (or similar v5 names). If the names differ, **update this plan's task code in Tasks 3 and 4 to use the actual exported names** before proceeding.

- [ ] **Step 4: Confirm build still passes**

Run:
```bash
npm run build && npm run typecheck && npm test
```

Expected: build, typecheck, and existing tests still pass (we haven't changed any code yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add Vercel AI SDK (ai, openai, anthropic, elevenlabs)"
```

---

## Task 2: Create slug resolver — tests first

**Files:**
- Create: `test/ai-sdk-models.test.ts`
- Create: `src/ai-sdk/models.ts`

- [ ] **Step 1: Write the failing test file**

Create `test/ai-sdk-models.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  resolveLanguageModel,
  resolveSpeechModel,
  ConfigError,
} from "../src/ai-sdk/models.js"

describe("resolveLanguageModel", () => {
  it("returns a model for openai/<model>", () => {
    const model = resolveLanguageModel("openai/gpt-5")
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it("returns a model for anthropic/<model>", () => {
    const model = resolveLanguageModel("anthropic/claude-haiku-4")
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it("throws ConfigError for unknown provider prefix", () => {
    expect(() => resolveLanguageModel("unknown/foo")).toThrow(ConfigError)
    expect(() => resolveLanguageModel("unknown/foo")).toThrow(/openai.*anthropic/)
  })

  it("throws ConfigError for malformed slug", () => {
    expect(() => resolveLanguageModel("notaslug")).toThrow(ConfigError)
    expect(() => resolveLanguageModel("notaslug")).toThrow(/provider\/model/)
  })

  it("throws ConfigError for empty model id", () => {
    expect(() => resolveLanguageModel("openai/")).toThrow(ConfigError)
  })
})

describe("resolveSpeechModel", () => {
  it("returns openai speech model with provider tag", () => {
    const r = resolveSpeechModel("openai/gpt-4o-mini-tts")
    expect(r.provider).toBe("openai")
    expect(r.model).toBeDefined()
    expect(r.model).not.toBeNull()
  })

  it("returns elevenlabs speech model with provider tag", () => {
    const r = resolveSpeechModel("elevenlabs/eleven_turbo_v2_5")
    expect(r.provider).toBe("elevenlabs")
    expect(r.model).toBeDefined()
    expect(r.model).not.toBeNull()
  })

  it("returns system provider with null model", () => {
    const r = resolveSpeechModel("system/say")
    expect(r.provider).toBe("system")
    expect(r.model).toBeNull()
  })

  it("throws ConfigError for unknown TTS prefix", () => {
    expect(() => resolveSpeechModel("unknown/foo")).toThrow(ConfigError)
    expect(() => resolveSpeechModel("unknown/foo")).toThrow(/openai.*elevenlabs.*system/)
  })

  it("throws ConfigError for malformed slug", () => {
    expect(() => resolveSpeechModel("notaslug")).toThrow(ConfigError)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/ai-sdk-models.test.ts`

Expected: FAIL — `Cannot find module '../src/ai-sdk/models.js'`.

- [ ] **Step 3: Create the module**

Create `src/ai-sdk/models.ts`:

```ts
import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import { elevenlabs } from "@ai-sdk/elevenlabs"
import type { LanguageModel, SpeechModel } from "ai"

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

const SLUG_RE = /^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/

function parseSlug(slug: string, field: string): [string, string] {
  if (!SLUG_RE.test(slug)) {
    throw new ConfigError(
      `${field} must be 'provider/model' (e.g. 'openai/gpt-5'), got '${slug}'`,
    )
  }
  const idx = slug.indexOf("/")
  return [slug.slice(0, idx), slug.slice(idx + 1)]
}

export function resolveLanguageModel(slug: string): LanguageModel {
  const [provider, modelId] = parseSlug(slug, "narrator.model")
  switch (provider) {
    case "openai":
      return openai(modelId)
    case "anthropic":
      return anthropic(modelId)
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
    case "openai":
      return { provider: "openai", model: openai.speech(modelId) }
    case "elevenlabs":
      return { provider: "elevenlabs", model: elevenlabs.speech(modelId) }
    case "system":
      return { provider: "system", model: null }
    default:
      throw new ConfigError(
        `Unknown TTS provider '${provider}' in '${slug}'. Supported: openai, elevenlabs, system`,
      )
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/ai-sdk-models.test.ts`

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: PASS. If the `SpeechModel` or `LanguageModel` type imports fail, check the actual exports of `ai` (v5 may export them under a different name like `LanguageModelV2`). Adjust the imports and the `ResolvedSpeech.model` type to match.

- [ ] **Step 6: Commit**

```bash
git add src/ai-sdk/models.ts test/ai-sdk-models.test.ts
git commit -m "feat(ai-sdk): slug resolver for narrator and TTS models"
```

---

## Task 3: Rewrite narrator tests against `MockLanguageModelV4`

**Files:**
- Rewrite: `test/handlers-narrator.test.ts`

- [ ] **Step 1: Replace the test file entirely**

The current tests mock `client.chat.completions.create`. After this rewrite they mock a `LanguageModel`. The narrator implementation hasn't changed yet — so this step **must fail** when run.

Replace `test/handlers-narrator.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest"
import { MockLanguageModelV4 } from "ai/test"
import { createNarrator } from "../src/handlers/narrator.js"

const baseConfig = { timeoutMs: 1000, minIntervalMs: 0 }

function ctx(text: string) {
  return { assistantText: text, recentTools: [] as string[] }
}

function mockModel(text: string, opts: { onCall?: (input: any) => void } = {}) {
  const doGenerate = vi.fn(async (input: any) => {
    opts.onCall?.(input)
    return {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens:  { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 0, text: 0, reasoning: undefined },
      },
      warnings: [],
    }
  })
  return { model: new MockLanguageModelV4({ doGenerate }), doGenerate }
}

describe("narrator", () => {
  it("calls model with crafted prompt and returns summary", async () => {
    let capturedPrompt = ""
    const { model, doGenerate } = mockModel("Done refactoring.", {
      onCall: (input) => {
        // AI SDK passes prompt under input.prompt (an array of messages) or input.inputFormat-specific.
        // The narrator uses { prompt: string }, which AI SDK normalizes — capture whatever shape we get.
        capturedPrompt = JSON.stringify(input)
      },
    })
    const n = createNarrator(model, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("did stuff"))
    expect(out).toBe("Done refactoring.")
    expect(doGenerate).toHaveBeenCalledOnce()
    expect(capturedPrompt).toContain("did stuff")
  })

  it("returns null when timeout elapses", async () => {
    // doGenerate that respects abortSignal: rejects with AbortError when signal fires.
    const doGenerate = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 500)
        abortSignal?.addEventListener("abort", () => {
          clearTimeout(t)
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      })
      throw new Error("should have aborted")
    })
    const model = new MockLanguageModelV4({ doGenerate })
    const n = createNarrator(model, { ...baseConfig, timeoutMs: 20 })
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("returns null when model errors", async () => {
    const doGenerate = vi.fn(async () => {
      throw new Error("500")
    })
    const model = new MockLanguageModelV4({ doGenerate })
    const n = createNarrator(model, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("returns null when response text is empty", async () => {
    const { model } = mockModel("")
    const n = createNarrator(model, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("throttles within minIntervalMs returning null", async () => {
    const { model, doGenerate } = mockModel("ok")
    const n = createNarrator(model, { ...baseConfig, minIntervalMs: 100_000 })
    const first = await n.summarize({ type: "session.idle" }, ctx("x"))
    const second = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(first).toBe("ok")
    expect(second).toBeNull()
    expect(doGenerate).toHaveBeenCalledOnce()
  })

  it("truncates very long assistant text in the prompt", async () => {
    let capturedPrompt = ""
    const { model } = mockModel("ok", {
      onCall: (input) => { capturedPrompt = JSON.stringify(input) },
    })
    const n = createNarrator(model, baseConfig)
    const long = "x".repeat(10_000)
    await n.summarize({ type: "session.idle" }, ctx(long))
    expect(capturedPrompt.length).toBeLessThan(5000)
  })

  it("does not advance throttle on error", async () => {
    let calls = 0
    const doGenerate = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error("transient")
      return {
        content: [{ type: "text", text: "second" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens:  { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      }
    })
    const model = new MockLanguageModelV4({ doGenerate })
    const n = createNarrator(model, { ...baseConfig, minIntervalMs: 100_000 })
    const first  = await n.summarize({ type: "session.idle" }, ctx("x"))
    const second = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(first).toBeNull()
    expect(second).toBe("second")
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/handlers-narrator.test.ts`

Expected: FAIL — `createNarrator` still expects the old `client` argument, so type errors and runtime errors abound. This is correct: we will fix it in Task 4.

- [ ] **Step 3: Do NOT commit yet**

The narrator implementation is changed in Task 4. We commit Task 3 + Task 4 together because the tests would break the repo if committed alone.

---

## Task 4: Migrate narrator to `generateText`

**Files:**
- Modify: `src/handlers/narrator.ts`

- [ ] **Step 1: Replace the narrator implementation**

Replace `src/handlers/narrator.ts` with:

```ts
import { generateText, type LanguageModel } from "ai"
import { truncate } from "./template.js"

export interface NarrationContext {
  assistantText: string
  recentTools: string[]
}

export interface NarratorConfig {
  timeoutMs: number
  minIntervalMs: number
}

export interface Narrator {
  summarize(
    event: { type: string; [k: string]: unknown },
    ctx: NarrationContext,
  ): Promise<string | null>
}

function buildPrompt(
  event: { type: string },
  ctx: NarrationContext,
): string {
  const text = truncate(ctx.assistantText, 2000)
  const tools =
    ctx.recentTools.slice(-5).map((t) => `- ${t}`).join("\n") || "(none)"
  const occasion =
    event.type === "todo.completed.all"
      ? "all todos are now complete"
      : "just finished a turn"
  return [
    "You are a spoken status narrator for a coding agent. Your output is read aloud by a TTS engine.",
    `The agent ${occasion}. Explain what actually happened so the user can keep their eyes off the screen:`,
    "- what was attempted, what tools were used, what changed, and the outcome,",
    "- any blockers, errors, or decisions that need the user's attention,",
    "- next steps if obvious.",
    "",
    "Style rules:",
    "- spoken English only — no markdown, no code blocks, no quotes, no bullet points,",
    "- plain prose, natural sentences, no filler or restatement of these instructions,",
    "- be concise: every sentence must add information, but do not omit anything the user needs to know,",
    "- skip greetings, sign-offs, and meta commentary about being an AI.",
    "",
    "Recent assistant output:",
    text || "(none)",
    "",
    "Recent tool calls:",
    tools,
  ].join("\n")
}

export function createNarrator(
  model: LanguageModel,
  config: NarratorConfig,
): Narrator {
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
        const trimmed = text.trim()
        if (trimmed.length === 0) return null
        lastFinishedAt = Date.now()
        return trimmed
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
```

**Note:** the public `NarratorClient` interface is intentionally removed — callers now pass a `LanguageModel` directly.

- [ ] **Step 2: Run narrator tests**

Run: `npx vitest run test/handlers-narrator.test.ts`

Expected: PASS — all 7 tests green.

If the "timeout" test fails because `MockLanguageModelV4`'s `doGenerate` callback doesn't receive `abortSignal`, replace that test's mock with a raw object instead:
```ts
const model = {
  specificationVersion: "v2",
  provider: "mock",
  modelId: "mock",
  doGenerate: doGenerate,
} as any
```
The narrator only cares that `generateText` propagates `abortSignal` to the model — if it doesn't, that's an SDK regression we surface here.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: PASS — but `src/index.ts` still imports the old narrator signature and **will fail typecheck**. That's covered in Task 6. For now, narrow to the narrator file:
```bash
npx tsc --noEmit src/handlers/narrator.ts test/handlers-narrator.test.ts
```
Expected: PASS for these two files.

- [ ] **Step 4: Commit (tests + impl together)**

```bash
git add src/handlers/narrator.ts test/handlers-narrator.test.ts
git commit -m "feat(narrator): use AI SDK generateText with LanguageModel"
```

---

## Task 5: Create AI SDK TTS provider — tests first

**Files:**
- Create: `test/tts-ai-sdk.test.ts`
- Create: `src/tts/ai-sdk.ts`

- [ ] **Step 1: Write the failing test file**

Create `test/tts-ai-sdk.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { MockSpeechModelV3 } from "ai/test"
import { createAiSdkProvider } from "../src/tts/ai-sdk.js"

function mockSpeechModel(opts: {
  onCall?: (input: any) => void
  audio?: Uint8Array
  mediaType?: string
  throwError?: Error
} = {}) {
  const doGenerate = vi.fn(async (input: any) => {
    if (opts.throwError) throw opts.throwError
    opts.onCall?.(input)
    return {
      audio: opts.audio ?? new Uint8Array([0x49, 0x44, 0x33]),
      warnings: [],
      request: { body: undefined },
      response: { timestamp: new Date(), modelId: "test", headers: {} },
      providerMetadata: undefined,
    }
  })
  return { model: new MockSpeechModelV3({ doGenerate }), doGenerate }
}

describe("ai-sdk TTS provider", () => {
  it("returns a Buffer with audio/mpeg content type", async () => {
    const { model } = mockSpeechModel()
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "openai" })
    const result = await provider.synthesize(
      "hello",
      { voice: "alloy" },
      new AbortController().signal,
    )
    expect(Buffer.isBuffer(result.audio)).toBe(true)
    expect(result.contentType).toMatch(/audio\//)
  })

  it("uses 'alloy' as default voice for openai", async () => {
    let capturedVoice: string | undefined
    const { model } = mockSpeechModel({
      onCall: (input) => { capturedVoice = input.voice },
    })
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "openai" })
    await provider.synthesize("hi", {}, new AbortController().signal)
    expect(capturedVoice).toBe("alloy")
  })

  it("does not pass a voice for elevenlabs when none configured", async () => {
    let capturedVoice: string | undefined = "untouched"
    const { model } = mockSpeechModel({
      onCall: (input) => { capturedVoice = input.voice },
    })
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "elevenlabs" })
    await provider.synthesize("hi", {}, new AbortController().signal)
    expect(capturedVoice).toBeUndefined()
  })

  it("uses init-config voice as default when opts.voice unset", async () => {
    let capturedVoice: string | undefined
    const { model } = mockSpeechModel({
      onCall: (input) => { capturedVoice = input.voice },
    })
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "openai", voice: "nova" })
    await provider.synthesize("hi", {}, new AbortController().signal)
    expect(capturedVoice).toBe("nova")
  })

  it("opts.voice wins over init-config voice", async () => {
    let capturedVoice: string | undefined
    const { model } = mockSpeechModel({
      onCall: (input) => { capturedVoice = input.voice },
    })
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "openai", voice: "nova" })
    await provider.synthesize(
      "hi",
      { voice: "shimmer" },
      new AbortController().signal,
    )
    expect(capturedVoice).toBe("shimmer")
  })

  it("propagates abort signal", async () => {
    const doGenerate = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 500)
        abortSignal?.addEventListener("abort", () => {
          clearTimeout(t)
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      })
      throw new Error("should have aborted")
    })
    const model = new MockSpeechModelV3({ doGenerate })
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "openai" })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 20)
    await expect(
      provider.synthesize("hi", {}, ac.signal),
    ).rejects.toThrow(/abort/i)
  })

  it("surfaces model errors", async () => {
    const { model } = mockSpeechModel({ throwError: new Error("rate limit") })
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "openai" })
    await expect(
      provider.synthesize("hi", {}, new AbortController().signal),
    ).rejects.toThrow(/rate limit/)
  })

  it("name reflects the resolved provider", async () => {
    const { model } = mockSpeechModel()
    const provider = createAiSdkProvider()
    await provider.init({ model, provider: "elevenlabs" })
    expect(provider.name).toBe("elevenlabs")
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run test/tts-ai-sdk.test.ts`

Expected: FAIL — `Cannot find module '../src/tts/ai-sdk.js'`.

- [ ] **Step 3: Create the provider**

Create `src/tts/ai-sdk.ts`:

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
  let providerName: "openai" | "elevenlabs" | null = null
  let defaultVoice: string | undefined

  const provider: TTSProvider = {
    get name() {
      return providerName ?? "ai-sdk"
    },
    capabilities: { streaming: true, offline: false },

    async init(config: unknown): Promise<void> {
      const c = (config ?? {}) as AiSdkInitConfig
      if (!c.model) throw new Error("ai-sdk TTS provider requires a model")
      if (c.provider !== "openai" && c.provider !== "elevenlabs") {
        throw new Error(
          `ai-sdk TTS provider supports openai or elevenlabs, got '${c.provider}'`,
        )
      }
      model = c.model
      providerName = c.provider
      defaultVoice = c.voice
    },

    async synthesize(
      text: string,
      opts: SynthesisOptions,
      signal: AbortSignal,
    ): Promise<SynthesisResult> {
      if (!model || !providerName) {
        throw new Error("ai-sdk TTS provider not initialized")
      }
      const voice =
        opts.voice ??
        defaultVoice ??
        (providerName === "openai" ? "alloy" : undefined)

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
  return provider
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run test/tts-ai-sdk.test.ts`

Expected: PASS — all 8 tests green.

If the `generateSpeech` call signature differs (e.g. `audio` shape, `mediaType` location), update the implementation against the actual `result` value seen in the failing test output. Also adjust the mock-return shape in the test if the SDK requires additional fields.

- [ ] **Step 5: Typecheck the provider in isolation**

Run: `npx tsc --noEmit src/tts/ai-sdk.ts test/tts-ai-sdk.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tts/ai-sdk.ts test/tts-ai-sdk.test.ts
git commit -m "feat(tts): AI SDK TTS provider via experimental_generateSpeech"
```

---

## Task 6: Wire models + new TTS provider into `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update imports**

Replace the imports near the top of `src/index.ts` (lines 6-12):

```ts
import { z } from "zod"
import { parseConfig } from "./config.js"
import { createLogger } from "./log.js"
import { SpeechQueue } from "./queue/speech-queue.js"
import { type SpeechRequest } from "./queue/types.js"
import { registerProvider, getProvider } from "./tts/provider.js"
import { createSystemProvider } from "./tts/system.js"
import { createAiSdkProvider } from "./tts/ai-sdk.js"
import { createPlayer, type Player } from "./audio/player.js"
import { createHandlerRegistry } from "./handlers/index.js"
import { createNarrator } from "./handlers/narrator.js"
import { resolveLanguageModel, resolveSpeechModel, ConfigError } from "./ai-sdk/models.js"
import { createDispatcher } from "./dispatcher.js"
import { createCommands } from "./commands/index.js"
```

- [ ] **Step 2: Replace the provider-registration + init block**

In `src/index.ts`, find the block at roughly lines 72-96 (starts with `// 1. Register built-in providers.` and ends after the first `provider.init(providerConfig)` try/catch).

Replace that entire block with:

```ts
  // 1. Resolve narrator + TTS models from config slugs.
  let languageModel
  let resolvedSpeech
  try {
    languageModel = resolveLanguageModel(config.narrator.model)
    resolvedSpeech = resolveSpeechModel(config.tts.model)
  } catch (err) {
    if (err instanceof ConfigError) {
      await logger.error(`Invalid model slug; plugin disabled: ${err.message}`)
    } else {
      await logger.error("Failed to resolve models; plugin disabled", {
        error: String(err),
      })
    }
    return {}
  }

  // 2. Register the right TTS provider.
  if (resolvedSpeech.provider === "system") {
    registerProvider(createSystemProvider({}))
  } else {
    const aiSdkProvider = createAiSdkProvider()
    try {
      await aiSdkProvider.init({
        model: resolvedSpeech.model,
        provider: resolvedSpeech.provider,
        voice: config.tts.voice,
      })
    } catch (err) {
      await logger.error("Failed to initialize TTS provider; plugin disabled", {
        error: String(err),
      })
      return {}
    }
    registerProvider(aiSdkProvider)
  }

  const provider = getProvider(resolvedSpeech.provider)
  if (!provider) {
    await logger.error(`TTS provider not found after registration: ${resolvedSpeech.provider}`)
    return {}
  }
```

- [ ] **Step 3: Replace the narrator client construction**

In `src/index.ts`, find the block at roughly lines 176-190 (starts with `// 6. Narrator + handler registry.` and ends at `const narrator = createNarrator(...)`).

Replace that block with:

```ts
  // 6. Narrator + handler registry.
  const narrator = createNarrator(languageModel, config.narrator)
```

This deletes the `(ctx.client as any).chat ? ... : { chat: { completions: { create: throw } } }` adapter.

- [ ] **Step 4: Remove obsolete `chat?: any` from `PluginCtx`**

Find the `type PluginCtx` block near line 23:

```ts
type PluginCtx = {
  client: {
    app: { log: (...args: any[]) => Promise<unknown> }
    chat?: any
  }
  ...
```

Remove the `chat?: any` line — narrator no longer reads it.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: PASS for `src/index.ts` and `src/handlers/narrator.ts`. May fail elsewhere if `src/config.ts` still references the old schema — that's Task 7.

If `src/config.ts` is referenced as failing (`config.tts.model` doesn't exist yet, `config.tts.provider` does), that's expected. Continue to Task 7.

- [ ] **Step 6: Do NOT commit yet — paired with Task 7**

The config schema still has the old shape, so `config.tts.model` is undefined at runtime. We commit Task 6 + Task 7 together.

---

## Task 7: Migrate config schema

**Files:**
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Update config tests**

Replace `test/config.test.ts` with:

```ts
import { describe, it, expect } from "vitest"
import { parseConfig, DEFAULT_CONFIG } from "../src/config.js"

describe("parseConfig", () => {
  it("returns defaults when given empty object", () => {
    const result = parseConfig({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enabled).toBe(true)
      expect(result.config.tts.model).toBe("system/say")
      expect(result.config.narrator.model).toBe("anthropic/claude-haiku-4")
      expect(result.config.events["session.idle"].enabled).toBe(true)
      expect(result.config.events["session.idle"].mode).toBe("narrate")
    }
  })

  it("accepts new-shape openai TTS slug", () => {
    const result = parseConfig({
      tts: { model: "openai/gpt-4o-mini-tts", voice: "alloy" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.tts.model).toBe("openai/gpt-4o-mini-tts")
      expect(result.config.tts.voice).toBe("alloy")
    }
  })

  it("accepts new-shape elevenlabs TTS slug", () => {
    const result = parseConfig({
      tts: { model: "elevenlabs/eleven_turbo_v2_5", voice: "voice-id-123" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.tts.model).toBe("elevenlabs/eleven_turbo_v2_5")
      expect(result.config.tts.voice).toBe("voice-id-123")
    }
  })

  it("rejects legacy tts.provider with migration message", () => {
    const result = parseConfig({ tts: { provider: "openai" } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join("\n")
      expect(msg).toMatch(/tts\.model/)
      expect(msg).toMatch(/breaking/i)
    }
  })

  it("rejects legacy tts.openai sub-block with migration message", () => {
    const result = parseConfig({ tts: { openai: { apiKey: "sk-1", model: "tts-1" } } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join("\n")
      expect(msg).toMatch(/tts\.model/)
    }
  })

  it("rejects legacy tts.elevenlabs sub-block with migration message", () => {
    const result = parseConfig({ tts: { elevenlabs: { voiceId: "v" } } })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join("\n")
      expect(msg).toMatch(/tts\.model/)
    }
  })

  it("rejects malformed tts.model slug", () => {
    const result = parseConfig({ tts: { model: "notaslug" } })
    expect(result.ok).toBe(false)
  })

  it("rejects malformed narrator.model slug", () => {
    const result = parseConfig({ narrator: { model: "no slash" } })
    expect(result.ok).toBe(false)
  })

  it("merges user-provided event overrides with defaults", () => {
    const result = parseConfig({
      events: { "tool.execute.before": { enabled: true } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.events["tool.execute.before"].enabled).toBe(true)
      expect(result.config.events["session.idle"].enabled).toBe(true)
    }
  })

  it("rejects rate out of bounds", () => {
    const result = parseConfig({ tts: { rate: 10 } })
    expect(result.ok).toBe(false)
  })

  it("respects OPENCODE_VOICE_MUTE env override", () => {
    const result = parseConfig({}, { OPENCODE_VOICE_MUTE: "1" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.startMuted).toBe(true)
  })

  it("disables plugin when OPENCODE_VOICE_DISABLED is set", () => {
    const result = parseConfig({}, { OPENCODE_VOICE_DISABLED: "1" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.enabled).toBe(false)
  })

  it("defaults greeting to 'opencode voice ready'", () => {
    const result = parseConfig({})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.greeting).toBe("opencode voice ready")
  })

  it("allows overriding the greeting string", () => {
    const result = parseConfig({ greeting: "hello there" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.greeting).toBe("hello there")
  })

  it("allows disabling greeting via empty string", () => {
    const result = parseConfig({ greeting: "" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.greeting).toBe("")
  })

  it("preserves unknown event keys for forward compat", () => {
    const result = parseConfig({
      events: { "future.event.type": { enabled: true, mode: "template" } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.events["future.event.type"]).toBeDefined()
    }
  })
})

describe("DEFAULT_CONFIG", () => {
  it("has all expected on-by-default events", () => {
    const enabled = Object.entries(DEFAULT_CONFIG.events)
      .filter(([, v]) => v.enabled)
      .map(([k]) => k)
      .sort()
    expect(enabled).toEqual([
      "command.executed",
      "file.edited",
      "message.reasoning.delta",
      "permission.asked",
      "permission.replied",
      "session.compacted",
      "session.created",
      "session.error",
      "session.idle",
      "todo.completed.all",
      "todo.completed.item",
      "tool.execute.after",
      "tool.execute.before",
    ])
  })

  it("leaves verbatim text streaming opt-in but reasoning narration on", () => {
    expect(DEFAULT_CONFIG.events["message.updated"].enabled).toBe(false)
    expect(DEFAULT_CONFIG.events["message.text.delta"].enabled).toBe(false)
    expect(DEFAULT_CONFIG.events["message.text.delta"].mode).toBe("verbatim")
    expect(DEFAULT_CONFIG.events["message.reasoning.delta"].enabled).toBe(true)
    expect(DEFAULT_CONFIG.events["message.reasoning.delta"].mode).toBe("verbatim")
    expect(DEFAULT_CONFIG.events["message.reasoning.delta"].priority).toBe("chatty")
  })
})
```

- [ ] **Step 2: Run config tests, verify they fail**

Run: `npx vitest run test/config.test.ts`

Expected: FAIL — old schema still expects `tts.provider`.

- [ ] **Step 3: Replace `src/config.ts`**

Replace the file contents with:

```ts
import { z } from "zod"

const PrioritySchema = z.enum(["urgent", "normal", "chatty"]).optional()
const ModeSchema = z.enum(["template", "narrate", "verbatim"])

const EventConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: ModeSchema.default("template"),
  priority: PrioritySchema,
})

const SLUG_RE = /^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/
const SLUG_MSG = "must be 'provider/model' (e.g. 'openai/gpt-4o-mini-tts')"

const TTSSchema = z.object({
  model: z.string().regex(SLUG_RE, `tts.model ${SLUG_MSG}`).default("system/say"),
  voice: z.string().optional(),
  rate:  z.number().min(0.5).max(2.0).default(1.0),
  pitch: z.number().min(0.5).max(2.0).default(1.0),
}).default({})

const NarratorSchema = z.object({
  model: z.string().regex(SLUG_RE, `narrator.model ${SLUG_MSG}`).default("anthropic/claude-haiku-4"),
  timeoutMs:     z.number().int().positive().default(5000),
  minIntervalMs: z.number().int().min(0).default(3000),
}).default({})

const QueueSchema = z.object({
  staleMs: z.number().int().min(0).default(8000),
}).default({})

const EventsSchema = z.record(z.string(), EventConfigSchema).default({})

const VoiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  startMuted: z.boolean().default(false),
  greeting: z.string().default("opencode voice ready"),
  tts: TTSSchema,
  narrator: NarratorSchema,
  events: EventsSchema,
  queue: QueueSchema,
})

export type VoiceConfig = z.infer<typeof VoiceConfigSchema>
export type EventConfig = z.infer<typeof EventConfigSchema>

// Event keys come in two flavors:
//   1. Real OpenCode plugin events as documented at
//      https://opencode.ai/docs/plugins/#events — these are dispatched by
//      opencode itself and reach us via the `event` hook in src/index.ts.
//   2. Plugin-internal synthesized events — fired by src/dispatcher.ts when
//      it derives higher-level signals from raw events. These are NOT in the
//      opencode docs but are valid configuration keys for this plugin.
//      Currently synthesized:
//        - "todo.completed.item" / "todo.completed.all" (from `todo.updated`)
//        - "message.text.delta" / "message.reasoning.delta" (from per-sentence
//          deltas of `message.part.updated` text and reasoning parts).
const DEFAULT_EVENTS: Record<
  string,
  { enabled: boolean; mode: "template" | "narrate" | "verbatim"; priority?: "urgent" | "normal" | "chatty" }
> = {
  // --- Real OpenCode events ---
  "session.idle":         { enabled: true,  mode: "narrate" },
  "session.error":        { enabled: true,  mode: "template", priority: "urgent" },
  "session.compacted":    { enabled: true,  mode: "template" },
  "session.created":      { enabled: true,  mode: "template" },
  "permission.asked":     { enabled: true,  mode: "template", priority: "urgent" },
  "permission.replied":   { enabled: true,  mode: "template" },
  "tool.execute.before":  { enabled: true,  mode: "template" },
  "tool.execute.after":   { enabled: true,  mode: "template" },
  "file.edited":          { enabled: true,  mode: "template" },
  "command.executed":     { enabled: true,  mode: "template" },
  "message.updated":      { enabled: false, mode: "verbatim" },
  "message.reasoning.delta": { enabled: true,  mode: "verbatim", priority: "chatty" },
  "message.text.delta":      { enabled: false, mode: "verbatim", priority: "chatty" },
  "todo.completed.item":     { enabled: true,  mode: "template" },
  "todo.completed.all":      { enabled: true,  mode: "narrate" },
}

export const DEFAULT_CONFIG: VoiceConfig = VoiceConfigSchema.parse({ events: DEFAULT_EVENTS })

export type ParseResult =
  | { ok: true; config: VoiceConfig }
  | { ok: false; errors: { path: string; message: string }[] }

const MIGRATION_MSG =
  "v0.2 breaking change: tts.provider / tts.openai / tts.elevenlabs are no longer supported. " +
  "Use 'tts.model' as a slug (e.g. 'openai/gpt-4o-mini-tts' or 'elevenlabs/eleven_turbo_v2_5'). " +
  "Move 'tts.elevenlabs.voiceId' to 'tts.voice'. " +
  "Set API keys via env vars (OPENAI_API_KEY, ELEVENLABS_API_KEY, ANTHROPIC_API_KEY). " +
  "See README v0.2 migration section."

export function parseConfig(
  raw: unknown,
  env: Record<string, string | undefined> = process.env,
): ParseResult {
  const userObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}

  // Migration detection — reject old shape with a clear message.
  const ttsRaw = userObj.tts as Record<string, unknown> | undefined
  if (ttsRaw && (
    typeof ttsRaw.provider === "string" ||
    ttsRaw.openai !== undefined ||
    ttsRaw.elevenlabs !== undefined
  )) {
    return { ok: false, errors: [{ path: "tts", message: MIGRATION_MSG }] }
  }

  // Merge raw user input over defaults (event-level deep merge).
  const userEvents =
    userObj.events && typeof userObj.events === "object"
      ? (userObj.events as Record<string, unknown>)
      : {}
  const mergedEvents: Record<string, unknown> = { ...DEFAULT_EVENTS }
  for (const [key, val] of Object.entries(userEvents)) {
    mergedEvents[key] = { ...(DEFAULT_EVENTS[key] ?? {}), ...(val as object) }
  }

  const merged = { ...userObj, events: mergedEvents }
  const parsed = VoiceConfigSchema.safeParse(merged)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }
  }
  const cfg = parsed.data

  // Env overrides (the only ones we still need — API keys are AI SDK's job).
  if (env.OPENCODE_VOICE_DISABLED === "1") cfg.enabled = false
  if (env.OPENCODE_VOICE_MUTE === "1") cfg.startMuted = true

  return { ok: true, config: cfg }
}
```

- [ ] **Step 4: Run config tests**

Run: `npx vitest run test/config.test.ts`

Expected: PASS — all tests green.

- [ ] **Step 5: Delete the old TTS providers and their tests**

Run:
```bash
git rm src/tts/openai.ts src/tts/elevenlabs.ts test/tts-openai.test.ts test/tts-elevenlabs.test.ts
```

Expected: four files deleted from the working tree and staged.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: all tests pass. If `test/handlers-index.test.ts` or anything else references the old narrator signature, fix it now — it should accept a `LanguageModel`, typically by importing `MockLanguageModelV4` and using the same pattern as `test/handlers-narrator.test.ts`. If a test uses a hand-rolled stub, you can also pass an `any`-typed stub that satisfies the runtime call shape — whichever is shorter.

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: both pass.

- [ ] **Step 8: Commit (config + index.ts + deletions together)**

```bash
git add -A
git commit -m "feat!: v0.2 config — slug-based tts.model, AI SDK plumbing in index.ts"
```

The `!` marks the breaking change.

---

## Task 8: Update the narrator demo script

**Files:**
- Modify: `scripts/narrator.ts`

- [ ] **Step 1: Replace the script**

Replace `scripts/narrator.ts` with:

```ts
/**
 * Test the LLM narrator handler in isolation. Sends a real request via the
 * Vercel AI SDK and prints + speaks the result.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npm run demo:narrator -- --assistant-text="I refactored the auth module" --tool=edit --tool=bash
 *   OPENAI_API_KEY=...    npm run demo:narrator -- --assistant-text="..." --model=openai/gpt-5
 *
 * Flags:
 *   --assistant-text=...   sample recent assistant output (required)
 *   --tool=...             one or more recent tool calls (repeatable)
 *   --model=provider/id    override narrator model (default: anthropic/claude-haiku-4)
 *   --no-speak             only print, don't speak
 */

import { createNarrator } from "../src/handlers/narrator.js"
import { createSystemProvider } from "../src/tts/system.js"
import { resolveLanguageModel, ConfigError } from "../src/ai-sdk/models.js"
import { spawn } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { delimiter, sep } from "node:path"

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m?.slice(name.length + 3)
}
function multi(name: string): string[] {
  return args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
}

const assistantText = flag("assistant-text")
if (!assistantText) {
  console.error('Missing required flag: --assistant-text="..."')
  process.exit(1)
}
const tools = multi("tool")
const modelSlug = flag("model") ?? "anthropic/claude-haiku-4"
const noSpeak = args.includes("--no-speak")

let model
try {
  model = resolveLanguageModel(modelSlug)
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message)
  } else {
    console.error(err)
  }
  process.exit(1)
}

const narrator = createNarrator(model, { timeoutMs: 10_000, minIntervalMs: 0 })

const t0 = Date.now()
const output = await narrator.summarize(
  { type: "session.idle" },
  { assistantText, recentTools: tools },
)
const ms = Date.now() - t0

console.log(`[narrator] model=${modelSlug} latency=${ms}ms`)
console.log(`[narrator] output: ${output ?? "(null — fell back)"}`)

if (!output) process.exit(0)
if (noSpeak) process.exit(0)

console.log("[narrator] speaking...")
const runner = {
  async has(b: string) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      try { await access(`${dir}${sep}${b}`, constants.X_OK); return true } catch {}
    }
    return false
  },
  run(cmd: string[], signal: AbortSignal) {
    return new Promise<{ exitCode: number }>((resolve, reject) => {
      const c = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" })
      const onAbort = () => c.kill("SIGTERM")
      signal.addEventListener("abort", onAbort)
      c.on("error", reject)
      c.on("exit", (code) => {
        signal.removeEventListener("abort", onAbort)
        resolve({ exitCode: code ?? 0 })
      })
    })
  },
}
const provider = createSystemProvider({ runner })
await provider.init({})
await provider.synthesize(output, {}, new AbortController().signal)
console.log("[narrator] done.")
```

- [ ] **Step 2: Verify other demo scripts don't reference old config keys**

Run:
```bash
grep -nE "tts\.provider|tts\.openai|tts\.elevenlabs|client\.chat" scripts/
```

Expected: no matches. If anything turns up, fix that script the same way: use `resolveLanguageModel`, `resolveSpeechModel`, or the new config shape.

- [ ] **Step 3: Smoke-test the narrator demo**

Run (assuming you have a key):
```bash
ANTHROPIC_API_KEY=... npm run demo:narrator -- --assistant-text="ran the tests, all green" --tool=test --no-speak
```

Expected: prints a narration line, exits 0. If `ANTHROPIC_API_KEY` is unset the AI SDK will throw an explicit message — that's correct behaviour, not a regression.

- [ ] **Step 4: Smoke-test the say demo**

Run:
```bash
npm run demo:say -- "hello from the new config"
```

Expected: macOS speaks the line (if `say` is available). If the demo script reads from the old config shape, fix it before this step passes.

- [ ] **Step 5: Smoke-test the queue and event demos**

Run:
```bash
npm run demo:queue
npm run demo:event
npm run demo:config
npm run demo:greet
```

Expected: each runs without throwing. If any references old config shape, fix it.

- [ ] **Step 6: Commit**

```bash
git add scripts/
git commit -m "demo: update scripts for AI SDK narrator and slug config"
```

---

## Task 9: Update README and CHANGELOG

**Files:**
- Modify: `README.md`
- Create or Modify: `CHANGELOG.md`

- [ ] **Step 1: Inspect current README config section**

Run:
```bash
grep -nE "tts\.|narrator\.|provider|model|apiKey" README.md | head -50
```

This identifies what to update. The exact line numbers depend on the README — adjust accordingly in step 2.

- [ ] **Step 2: Update README configuration examples**

Replace every example that uses the old `tts.provider` / `tts.openai` / `tts.elevenlabs` shape with the new slug form. Add a new "## v0.2 migration" section near the top.

The migration section must contain (verbatim text — copy exactly):

```markdown
## v0.2 migration

v0.2 replaces the bespoke `tts.provider` config with a unified `provider/model` slug, and uses the Vercel AI SDK under the hood for both narration and TTS.

### Config changes

**Before (v0.1):**
```json
{
  "tts": {
    "provider": "openai",
    "openai": { "apiKey": "sk-...", "model": "tts-1" }
  },
  "narrator": { "model": "anthropic/claude-haiku-4" }
}
```

**After (v0.2):**
```json
{
  "tts": { "model": "openai/tts-1", "voice": "alloy" },
  "narrator": { "model": "anthropic/claude-haiku-4" }
}
```

### API keys

API keys are read from environment variables only — they no longer go in `opencode.json`:

- `OPENAI_API_KEY` for `openai/*` models
- `ANTHROPIC_API_KEY` for `anthropic/*` models
- `ELEVENLABS_API_KEY` for `elevenlabs/*` models

### ElevenLabs voice IDs

What was `tts.elevenlabs.voiceId` is now `tts.voice`. Same value, new path.

### Supported providers

- Narrator: `openai/*`, `anthropic/*`
- TTS: `openai/*`, `elevenlabs/*`, `system/say` (macOS only)
```

- [ ] **Step 3: Update or create CHANGELOG.md**

If `CHANGELOG.md` does not exist, create it with:

```markdown
# Changelog

## 0.2.0

### Breaking changes

- `tts.provider`, `tts.openai`, and `tts.elevenlabs` config keys are removed. Use `tts.model` as a `provider/model` slug instead (e.g. `"openai/gpt-4o-mini-tts"`, `"elevenlabs/eleven_turbo_v2_5"`, `"system/say"`).
- ElevenLabs voice IDs move from `tts.elevenlabs.voiceId` to `tts.voice`.
- API keys must come from environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`). They are no longer read from `opencode.json`.
- The narrator no longer uses `ctx.client.chat` — set the relevant `*_API_KEY` env var instead.

### New

- Narrator and TTS are powered by the Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/elevenlabs`).
- Adding a supported provider is a one-line change in `src/ai-sdk/models.ts`.

### Internal

- Deleted `src/tts/openai.ts` and `src/tts/elevenlabs.ts` — replaced by `src/tts/ai-sdk.ts`.
- New `src/ai-sdk/models.ts` slug resolver.
- Narrator test suite migrated to `MockLanguageModelV4` from `ai/test`.
```

If `CHANGELOG.md` already exists, prepend the `## 0.2.0` block (keep older entries below).

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: v0.2 migration guide and changelog"
```

---

## Task 10: Version bump and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version**

Run:
```bash
npm version 0.2.0 --no-git-tag-version
```

Expected: `package.json` `version` field updates to `0.2.0`; no git tag is created (we control git separately).

- [ ] **Step 2: Full verification suite**

Run:
```bash
npm run typecheck && npm test && npm run build
```

Expected: all three pass.

- [ ] **Step 3: Confirm no stale references**

Run:
```bash
grep -rnE "createOpenAIProvider|createElevenLabsProvider|client\.chat\.completions|tts\.provider|NarratorClient" src/ test/ scripts/
```

Expected: no matches. If anything shows up, fix it and re-run from Step 2.

- [ ] **Step 4: Inspect what is about to be committed**

Run:
```bash
git status
git log --oneline -12
```

Expected: clean working tree apart from `package.json` and `package-lock.json`. Log shows 8 prior commits from this plan.

- [ ] **Step 5: Commit version bump**

```bash
git add package.json package-lock.json
git commit -m "chore: release 0.2.0"
```

---

## Self-Review

**Spec coverage:**
- Slug resolver (spec §Architecture/New module) → Task 2.
- Narrator AI SDK migration (spec §Architecture/Modified: narrator.ts) → Tasks 3 + 4.
- TTS AI SDK provider (spec §Architecture/New module: ai-sdk.ts) → Task 5.
- Index.ts wiring (spec §Architecture/Modified: index.ts) → Task 6.
- Config schema migration + migration error (spec §Architecture/Modified: config.ts) → Task 7.
- Removed env-var fallbacks in parseConfig → Task 7 (the new `parseConfig` body omits them).
- Demo script updates (spec §Implementation order step 7) → Task 8.
- README + CHANGELOG (spec step 8) → Task 9.
- Version bump (spec step 9) → Task 10.
- Tests using `ai/test` mocks (spec §Tests) → Tasks 2, 3, 5, 7.
- All tests preserved from spec narrator behaviour list (happy, timeout, error, empty, throttle, truncate, no-advance-on-error) → Task 3.

All spec sections have at least one task.

**Placeholder scan:** No `TBD`, `TODO`, or unreferenced symbols. Adjustment notes in Task 1 (mock-class name verification) and Task 5 (Step 4 fallback) describe concrete fixes, not deferred work.

**Type consistency:**
- `resolveLanguageModel` / `resolveSpeechModel` / `ConfigError` — defined Task 2, used Tasks 6 and 8.
- `createAiSdkProvider` — defined Task 5, used Task 6.
- `createNarrator(model, config)` — new signature defined Task 4, used Tasks 6 and 8.
- `AiSdkInitConfig` shape (`{ model, provider, voice? }`) — defined Task 5, called with matching fields in Task 6.
- `ResolvedSpeech` type — defined Task 2 with `provider: "openai" | "elevenlabs" | "system"` discriminator; consumed Task 6 with the matching switch.
- `MockLanguageModelV4` / `MockSpeechModelV3` — names verified at Task 1 Step 3; Tasks 3 and 5 use them; if the verification step found different names, those tasks already say to update accordingly.

Consistent throughout.
