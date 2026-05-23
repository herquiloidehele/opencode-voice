# opencode-voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `opencode-voice` v0.1 — an npm-distributed opencode plugin that speaks agent events through pluggable TTS backends, with per-event configuration, priority-based speech queue, and graceful degradation across macOS / Linux / Windows.

**Architecture:** A single opencode plugin exported from `src/index.ts` that wires together (1) a Zod-validated config layer, (2) a dispatcher that routes opencode events to handlers, (3) template + LLM-narrator handlers that produce `SpeechRequest`s, (4) a priority queue with interrupt and dedup, and (5) pluggable TTS providers (`system`, `openai`, `elevenlabs`). All modules are thin and unit-tested in isolation; the plugin never throws to the host.

**Tech Stack:** TypeScript (ESM), Bun (host runtime, `$` shell API), Vitest (test runner), Zod (config validation), `tsup` (build), `@opencode-ai/plugin` (peer dep, plugin types).

**Reference:** See `docs/superpowers/specs/2026-05-23-opencode-voice-plugin-design.md` for the design spec this plan implements.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` | Build, types, tests |
| `src/index.ts` | Plugin entry; wires modules; subscribes to opencode events |
| `src/log.ts` | Logging wrapper with redaction of API keys |
| `src/config.ts` | Zod schema, validation, env var fallbacks |
| `src/queue/types.ts` | `Priority` enum, `SpeechRequest` interface |
| `src/queue/speech-queue.ts` | Priority queue, dedup, interrupt, stale drop |
| `src/tts/provider.ts` | `TTSProvider` interface, `registerProvider`, registry |
| `src/tts/system.ts` | OS-native TTS (macOS `say`, Linux `spd-say`/`espeak`, Windows PowerShell) |
| `src/tts/openai.ts` | OpenAI TTS via fetch |
| `src/tts/elevenlabs.ts` | ElevenLabs TTS via fetch |
| `src/audio/player.ts` | Plays audio buffers from cloud providers; abortable |
| `src/handlers/template.ts` | Pure event → string templates |
| `src/handlers/narrator.ts` | LLM-summary handler with guardrails |
| `src/handlers/index.ts` | Handler registry + routing by event/mode |
| `src/dispatcher.ts` | Event subscriber + derived-event detection (e.g. `todo.completed.all`) |
| `src/commands/index.ts` | `/mute` `/unmute` `/say` `/voice-test` `/voice-status` |
| `test/*.test.ts` | One spec per module |
| `README.md` | User-facing docs |

Build order follows dependencies: scaffolding → log → types → config → queue → provider interface → providers → handlers → dispatcher → commands → entry → integration test → README.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Initialize npm package**

```bash
bun init -y
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "opencode-voice",
  "version": "0.1.0",
  "description": "Voice plugin for opencode — speaks agent events through pluggable TTS backends.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "bin": { "opencode-voice": "./dist/cli.js" },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "peerDependencies": { "@opencode-ai/plugin": "*" },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
})
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
})
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
.opencode/
*.log
```

- [ ] **Step 7: Install dependencies**

Run: `bun install`
Expected: completes without errors. `node_modules/` populated.

- [ ] **Step 8: Verify typecheck and test runner work on empty project**

Run: `bun run typecheck && bun run test`
Expected: typecheck passes (no source files yet); vitest reports "No test files found" and exits 0 (or non-zero — that's OK, we'll have tests next).

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: scaffold opencode-voice package (ts, vitest, tsup)"
```

---

## Task 2: Logging Module with Redaction

**Files:**
- Create: `src/log.ts`
- Test: `test/log.test.ts`

Centralized logger that wraps `client.app.log()` from the opencode SDK and redacts known sensitive fields before logging.

- [ ] **Step 1: Write the failing test**

`test/log.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createLogger, redact } from "../src/log.js"

describe("redact", () => {
  it("masks apiKey-like fields recursively", () => {
    const input = {
      provider: "openai",
      openai: { apiKey: "sk-secret-123", model: "tts-1" },
      elevenlabs: { apiKey: "el-456", voiceId: "abc" },
      narrator: { model: "haiku" },
    }
    expect(redact(input)).toEqual({
      provider: "openai",
      openai: { apiKey: "***", model: "tts-1" },
      elevenlabs: { apiKey: "***", voiceId: "abc" },
      narrator: { model: "haiku" },
    })
  })

  it("masks Authorization headers", () => {
    expect(redact({ headers: { Authorization: "Bearer xyz" } })).toEqual({
      headers: { Authorization: "***" },
    })
  })

  it("returns primitives unchanged", () => {
    expect(redact("hello")).toBe("hello")
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
  })
})

describe("createLogger", () => {
  it("forwards info to client.app.log with redacted extras", async () => {
    const log = vi.fn().mockResolvedValue(undefined)
    const client = { app: { log } } as any
    const logger = createLogger(client, "test-service")
    await logger.info("hello", { apiKey: "secret" })
    expect(log).toHaveBeenCalledWith({
      body: {
        service: "test-service",
        level: "info",
        message: "hello",
        extra: { apiKey: "***" },
      },
    })
  })

  it("never throws when client.app.log fails", async () => {
    const log = vi.fn().mockRejectedValue(new Error("network"))
    const client = { app: { log } } as any
    const logger = createLogger(client, "test-service")
    await expect(logger.warn("oops")).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/log.test.ts`
Expected: FAIL — `src/log.js` does not exist.

- [ ] **Step 3: Implement `src/log.ts`**

```ts
const SENSITIVE_KEYS = new Set([
  "apiKey", "api_key", "apikey",
  "authorization", "Authorization",
  "secret", "token", "password",
])

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redact)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "***" : redact(v)
  }
  return out
}

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface Logger {
  debug(msg: string, extra?: unknown): Promise<void>
  info(msg: string, extra?: unknown): Promise<void>
  warn(msg: string, extra?: unknown): Promise<void>
  error(msg: string, extra?: unknown): Promise<void>
}

interface OpencodeClient {
  app: { log: (req: { body: { service: string; level: LogLevel; message: string; extra?: unknown } }) => Promise<unknown> }
}

export function createLogger(client: OpencodeClient, service: string): Logger {
  async function emit(level: LogLevel, message: string, extra?: unknown): Promise<void> {
    try {
      await client.app.log({
        body: { service, level, message, ...(extra !== undefined ? { extra: redact(extra) } : {}) },
      })
    } catch {
      // Swallow — logger must never throw.
    }
  }
  return {
    debug: (m, e) => emit("debug", m, e),
    info:  (m, e) => emit("info",  m, e),
    warn:  (m, e) => emit("warn",  m, e),
    error: (m, e) => emit("error", m, e),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/log.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/log.ts test/log.test.ts
git commit -m "feat(log): add logger wrapper with key redaction"
```

---

## Task 3: Queue Types

**Files:**
- Create: `src/queue/types.ts`

No tests — pure type declarations. Compiler check verifies correctness.

- [ ] **Step 1: Write `src/queue/types.ts`**

```ts
export enum Priority {
  URGENT = 3,   // permission.asked, session.error
  NORMAL = 2,   // session.idle, todo.completed.all, session.compacted, /say
  CHATTY = 1,   // tool.execute.*, todo.completed.item, message.updated
}

export interface SpeechRequest {
  /** Unique id for tracing. */
  id: string
  priority: Priority
  /** The text to speak. */
  text: string
  /** Optional key; same-keyed requests in the queue collapse to the newest. Typically the event type. */
  dedupKey?: string
  /** ms epoch when the request entered the queue. Used for stale drop. */
  enqueuedAt: number
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: passes (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/queue/types.ts
git commit -m "feat(queue): add Priority enum and SpeechRequest type"
```

---

## Task 4: Configuration Module

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

Zod schema for the `voice` config block with sensible defaults. Validates the user's `opencode.json` config. Supports environment overrides.

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parseConfig, DEFAULT_CONFIG } from "../src/config.js"

describe("parseConfig", () => {
  it("returns defaults when given empty object", () => {
    const result = parseConfig({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enabled).toBe(true)
      expect(result.config.tts.provider).toBe("system")
      expect(result.config.events["session.idle"].enabled).toBe(true)
      expect(result.config.events["session.idle"].mode).toBe("narrate")
    }
  })

  it("merges user-provided event overrides with defaults", () => {
    const result = parseConfig({
      events: { "tool.execute.before": { enabled: true } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.events["tool.execute.before"].enabled).toBe(true)
      // session.idle still uses default
      expect(result.config.events["session.idle"].enabled).toBe(true)
    }
  })

  it("rejects invalid provider name", () => {
    const result = parseConfig({ tts: { provider: 123 } })
    expect(result.ok).toBe(false)
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

  it("falls back to env var for OpenAI api key when not in config", () => {
    const result = parseConfig(
      { tts: { provider: "openai" } },
      { OPENAI_API_KEY: "sk-env" }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.tts.openai?.apiKey).toBe("sk-env")
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
    expect(enabled).toEqual([
      "session.idle",
      "session.error",
      "session.compacted",
      "permission.asked",
      "todo.completed.all",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/config.test.ts`
Expected: FAIL — `src/config.js` does not exist.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { z } from "zod"

const PrioritySchema = z.enum(["urgent", "normal", "chatty"]).optional()
const ModeSchema = z.enum(["template", "narrate", "verbatim"])

const EventConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: ModeSchema.default("template"),
  priority: PrioritySchema,
})

const TTSSchema = z.object({
  provider: z.string().default("system"),
  voice: z.string().optional(),
  rate: z.number().min(0.5).max(2.0).default(1.0),
  pitch: z.number().min(0.5).max(2.0).default(1.0),
  openai: z.object({
    apiKey: z.string().optional(),
    model: z.string().default("tts-1"),
  }).optional(),
  elevenlabs: z.object({
    apiKey: z.string().optional(),
    voiceId: z.string().optional(),
  }).optional(),
}).default({})

const NarratorSchema = z.object({
  model: z.string().default("anthropic/claude-haiku-4"),
  maxTokens: z.number().int().positive().default(60),
  timeoutMs: z.number().int().positive().default(5000),
  minIntervalMs: z.number().int().min(0).default(3000),
}).default({})

const QueueSchema = z.object({
  staleMs: z.number().int().min(0).default(8000),
}).default({})

const EventsSchema = z.record(z.string(), EventConfigSchema).default({})

const VoiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  startMuted: z.boolean().default(false),
  tts: TTSSchema,
  narrator: NarratorSchema,
  events: EventsSchema,
  queue: QueueSchema,
})

export type VoiceConfig = z.infer<typeof VoiceConfigSchema>
export type EventConfig = z.infer<typeof EventConfigSchema>

const DEFAULT_EVENTS: Record<string, { enabled: boolean; mode: "template" | "narrate" | "verbatim"; priority?: "urgent" | "normal" | "chatty" }> = {
  "session.idle":         { enabled: true,  mode: "narrate" },
  "session.error":        { enabled: true,  mode: "template", priority: "urgent" },
  "session.compacted":    { enabled: true,  mode: "template" },
  "permission.asked":     { enabled: true,  mode: "template", priority: "urgent" },
  "todo.completed.all":   { enabled: true,  mode: "narrate" },
  "todo.completed.item":  { enabled: false, mode: "template" },
  "tool.execute.before":  { enabled: false, mode: "template" },
  "tool.execute.after":   { enabled: false, mode: "template" },
  "message.updated":      { enabled: false, mode: "verbatim" },
}

export const DEFAULT_CONFIG: VoiceConfig = VoiceConfigSchema.parse({ events: DEFAULT_EVENTS })

export type ParseResult =
  | { ok: true; config: VoiceConfig }
  | { ok: false; errors: { path: string; message: string }[] }

export function parseConfig(raw: unknown, env: Record<string, string | undefined> = process.env): ParseResult {
  // Merge raw user input over defaults (event-level deep merge).
  const userObj = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {}
  const userEvents = (userObj.events && typeof userObj.events === "object") ? userObj.events as Record<string, unknown> : {}
  const mergedEvents: Record<string, unknown> = { ...DEFAULT_EVENTS }
  for (const [key, val] of Object.entries(userEvents)) {
    mergedEvents[key] = { ...(DEFAULT_EVENTS[key] ?? {}), ...(val as object) }
  }

  const merged = { ...userObj, events: mergedEvents }
  const parsed = VoiceConfigSchema.safeParse(merged)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    }
  }
  const cfg = parsed.data

  // Env overrides.
  if (env.OPENCODE_VOICE_DISABLED === "1") cfg.enabled = false
  if (env.OPENCODE_VOICE_MUTE === "1") cfg.startMuted = true

  // API key env fallbacks.
  if (cfg.tts.provider === "openai") {
    cfg.tts.openai = cfg.tts.openai ?? { model: "tts-1" }
    cfg.tts.openai.apiKey = cfg.tts.openai.apiKey ?? env.OPENAI_API_KEY
  }
  if (cfg.tts.provider === "elevenlabs") {
    cfg.tts.elevenlabs = cfg.tts.elevenlabs ?? {}
    cfg.tts.elevenlabs.apiKey = cfg.tts.elevenlabs.apiKey ?? env.ELEVENLABS_API_KEY
  }

  return { ok: true, config: cfg }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/config.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): add Zod schema with defaults and env overrides"
```

---

## Task 5: Speech Queue

**Files:**
- Create: `src/queue/speech-queue.ts`
- Test: `test/speech-queue.test.ts`

The most important stateful module. Must obey all the rules from spec §5.3 exactly.

- [ ] **Step 1: Write the failing tests**

`test/speech-queue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SpeechQueue } from "../src/queue/speech-queue.js"
import { Priority, type SpeechRequest } from "../src/queue/types.js"

type CallLog = string[]

function makeSpeaker(log: CallLog, delayMs = 10) {
  return async (req: SpeechRequest, signal: AbortSignal): Promise<void> => {
    log.push(`start:${req.id}`)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { log.push(`done:${req.id}`); resolve() }, delayMs)
      signal.addEventListener("abort", () => { clearTimeout(t); log.push(`abort:${req.id}`); reject(new DOMException("aborted","AbortError")) })
    })
  }
}

const req = (over: Partial<SpeechRequest>): SpeechRequest => ({
  id: "x", priority: Priority.NORMAL, text: "hi", enqueuedAt: Date.now(), ...over,
})

describe("SpeechQueue", () => {
  beforeEach(() => { vi.useRealTimers() })

  it("speaks a single pushed request", async () => {
    const log: CallLog = []
    const q = new SpeechQueue({ speak: makeSpeaker(log), staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "a" }))
    await q.idle()
    expect(log).toEqual(["start:a", "done:a"])
  })

  it("queues a second request behind the first (FIFO at same priority)", async () => {
    const log: CallLog = []
    const q = new SpeechQueue({ speak: makeSpeaker(log), staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "a" }))
    q.push(req({ id: "b" }))
    await q.idle()
    expect(log).toEqual(["start:a", "done:a", "start:b", "done:b"])
  })

  it("higher priority interrupts the currently speaking lower-priority request", async () => {
    const log: CallLog = []
    const q = new SpeechQueue({ speak: makeSpeaker(log, 50), staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "low", priority: Priority.CHATTY }))
    await new Promise((r) => setTimeout(r, 5))  // let "low" start
    q.push(req({ id: "urgent", priority: Priority.URGENT }))
    await q.idle()
    expect(log[0]).toBe("start:low")
    expect(log).toContain("abort:low")
    expect(log).toContain("start:urgent")
    expect(log[log.length - 1]).toBe("done:urgent")
  })

  it("dedupes queued requests by dedupKey, keeping the newest text", async () => {
    const log: CallLog = []
    const speakLog: string[] = []
    const speak = async (r: SpeechRequest) => { speakLog.push(`${r.id}:${r.text}`) }
    const q = new SpeechQueue({ speak, staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "block", priority: Priority.URGENT, text: "blocker" }))
    q.push(req({ id: "v1", text: "first",  dedupKey: "tool.execute.before", priority: Priority.CHATTY }))
    q.push(req({ id: "v2", text: "second", dedupKey: "tool.execute.before", priority: Priority.CHATTY }))
    q.push(req({ id: "v3", text: "third",  dedupKey: "tool.execute.before", priority: Priority.CHATTY }))
    await q.idle()
    expect(speakLog).toEqual(["block:blocker", "v3:third"])
  })

  it("never dedupes the currently speaking request", async () => {
    const log: CallLog = []
    const q = new SpeechQueue({ speak: makeSpeaker(log, 30), staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "current", dedupKey: "k" }))
    await new Promise((r) => setTimeout(r, 5))
    q.push(req({ id: "next", dedupKey: "k" }))
    await q.idle()
    expect(log).toEqual(["start:current", "done:current", "start:next", "done:next"])
  })

  it("drops stale items before speaking them", async () => {
    const speakLog: string[] = []
    const speak = async (r: SpeechRequest) => { speakLog.push(r.id) }
    let t = 1000
    const q = new SpeechQueue({ speak, staleMs: 100, now: () => t })
    q.push(req({ id: "blocker", priority: Priority.URGENT, enqueuedAt: t }))
    q.push(req({ id: "stale",   priority: Priority.CHATTY, enqueuedAt: t }))
    q.push(req({ id: "fresh",   priority: Priority.CHATTY, enqueuedAt: t }))
    // Advance time past staleMs before queue gets to chatty items.
    t = 2000
    await q.idle()
    expect(speakLog).toEqual(["blocker"])  // both chatty items dropped as stale at dequeue time
  })

  it("mute drops queue and aborts current", async () => {
    const log: CallLog = []
    const q = new SpeechQueue({ speak: makeSpeaker(log, 50), staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "a" }))
    q.push(req({ id: "b" }))
    await new Promise((r) => setTimeout(r, 5))
    q.mute()
    await q.idle()
    expect(log).toContain("abort:a")
    expect(log).not.toContain("start:b")
    expect(q.size()).toBe(0)
  })

  it("unmute does not re-speak missed events", async () => {
    const log: CallLog = []
    const q = new SpeechQueue({ speak: makeSpeaker(log), staleMs: 8000, now: () => Date.now() })
    q.mute()
    q.push(req({ id: "muted" }))
    q.unmute()
    await q.idle()
    expect(log).toEqual([])
  })

  it("never throws when speak rejects", async () => {
    const speak = async () => { throw new Error("synth failed") }
    const q = new SpeechQueue({ speak, staleMs: 8000, now: () => Date.now() })
    q.push(req({ id: "broken" }))
    await expect(q.idle()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/speech-queue.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/queue/speech-queue.ts`**

```ts
import { Priority, type SpeechRequest } from "./types.js"

export type SpeakFn = (req: SpeechRequest, signal: AbortSignal) => Promise<void>

export interface SpeechQueueOptions {
  speak: SpeakFn
  staleMs: number
  now: () => number
  onError?: (err: unknown, req: SpeechRequest) => void
}

export class SpeechQueue {
  private queue: SpeechRequest[] = []
  private current: { req: SpeechRequest; abort: AbortController } | null = null
  private muted = false
  private idleResolvers: Array<() => void> = []
  private pumpRunning = false

  constructor(private readonly opts: SpeechQueueOptions) {}

  push(req: SpeechRequest): void {
    if (this.muted) return

    // Rule 2: interrupt if higher priority than current.
    if (this.current && req.priority > this.current.req.priority) {
      this.queue.unshift(req)
      this.current.abort.abort()
      return
    }

    // Rule 3: dedup by key against queued (not current) items.
    if (req.dedupKey) {
      const idx = this.queue.findIndex((q) => q.dedupKey === req.dedupKey)
      if (idx >= 0) {
        this.queue[idx] = req  // newer wins
        return
      }
    }

    // Rule 4: insert by priority (stable FIFO within priority).
    let i = 0
    while (i < this.queue.length && this.queue[i].priority >= req.priority) i++
    this.queue.splice(i, 0, req)

    void this.pump()
  }

  mute(): void {
    this.muted = true
    this.queue = []
    if (this.current) this.current.abort.abort()
  }

  unmute(): void {
    this.muted = false
  }

  size(): number {
    return this.queue.length + (this.current ? 1 : 0)
  }

  /** Resolves when queue is empty and nothing is speaking. */
  async idle(): Promise<void> {
    if (!this.current && this.queue.length === 0) return
    return new Promise<void>((resolve) => { this.idleResolvers.push(resolve) })
  }

  private async pump(): Promise<void> {
    if (this.pumpRunning || this.current) return
    this.pumpRunning = true
    try {
      while (this.queue.length > 0 && !this.muted) {
        const next = this.queue.shift()!
        // Rule 5: stale drop for non-urgent items.
        if (next.priority <= Priority.NORMAL && this.opts.now() - next.enqueuedAt > this.opts.staleMs) {
          continue
        }
        const abort = new AbortController()
        this.current = { req: next, abort }
        try {
          await this.opts.speak(next, abort.signal)
        } catch (err) {
          this.opts.onError?.(err, next)
        } finally {
          this.current = null
        }
      }
    } finally {
      this.pumpRunning = false
      if (!this.current && this.queue.length === 0) {
        const resolvers = this.idleResolvers
        this.idleResolvers = []
        for (const r of resolvers) r()
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/speech-queue.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/queue/speech-queue.ts test/speech-queue.test.ts
git commit -m "feat(queue): add priority speech queue with interrupt, dedup, stale drop"
```

---

## Task 6: TTS Provider Interface & Registry

**Files:**
- Create: `src/tts/provider.ts`
- Test: `test/provider-registry.test.ts`

- [ ] **Step 1: Write the failing test**

`test/provider-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { registerProvider, getProvider, listProviders, _resetRegistry, type TTSProvider } from "../src/tts/provider.js"

const stub: TTSProvider = {
  name: "stub",
  capabilities: { streaming: false, offline: true },
  async init() {},
  async synthesize() { return { audio: Buffer.from([]), contentType: "audio/wav" } },
}

describe("provider registry", () => {
  beforeEach(() => _resetRegistry())

  it("registers and retrieves a provider by name", () => {
    registerProvider(stub)
    expect(getProvider("stub")).toBe(stub)
  })

  it("lists all registered providers", () => {
    registerProvider(stub)
    registerProvider({ ...stub, name: "stub2" })
    expect(listProviders().map((p) => p.name).sort()).toEqual(["stub", "stub2"])
  })

  it("returns undefined for unknown provider", () => {
    expect(getProvider("nope")).toBeUndefined()
  })

  it("overwrites on duplicate registration (last wins) with a warning hook", () => {
    const a = { ...stub, name: "dup", capabilities: { streaming: true, offline: false } }
    const b = { ...stub, name: "dup", capabilities: { streaming: false, offline: true } }
    registerProvider(a)
    registerProvider(b)
    expect(getProvider("dup")?.capabilities.offline).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/provider-registry.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tts/provider.ts`**

```ts
export interface SynthesisOptions {
  voice?: string
  rate?: number
  pitch?: number
  format?: "wav" | "mp3" | "raw"
}

export interface SynthesisResult {
  audio: ReadableStream<Uint8Array> | Buffer
  contentType: string
}

export interface TTSProvider {
  readonly name: string
  readonly capabilities: { streaming: boolean; offline: boolean }
  init(config: unknown): Promise<void>
  synthesize(text: string, opts: SynthesisOptions, signal: AbortSignal): Promise<SynthesisResult>
  validate?(config: unknown): { ok: true } | { ok: false; reason: string }
}

const registry = new Map<string, TTSProvider>()

export function registerProvider(p: TTSProvider): void {
  registry.set(p.name, p)
}

export function getProvider(name: string): TTSProvider | undefined {
  return registry.get(name)
}

export function listProviders(): TTSProvider[] {
  return Array.from(registry.values())
}

/** For tests only. */
export function _resetRegistry(): void {
  registry.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/provider-registry.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tts/provider.ts test/provider-registry.test.ts
git commit -m "feat(tts): add provider interface and registry"
```

---

## Task 7: System TTS Provider

**Files:**
- Create: `src/tts/system.ts`
- Test: `test/tts-system.test.ts`

OS-native TTS via subprocess. Detects platform during `init()`. Produces its own audio (no audio player needed).

We abstract subprocess spawning via a `Runner` interface so tests can mock it.

- [ ] **Step 1: Write the failing test**

`test/tts-system.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createSystemProvider } from "../src/tts/system.js"

function fakeRunner(opts: { hasBinary: Record<string, boolean>; commands: string[][]; failOnRun?: boolean }) {
  return {
    has: async (bin: string) => opts.hasBinary[bin] ?? false,
    run: async (cmd: string[], signal: AbortSignal) => {
      opts.commands.push(cmd)
      if (opts.failOnRun) throw new Error("run failed")
      return { exitCode: 0 }
    },
  }
}

describe("system TTS provider", () => {
  it("uses `say` on macOS", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({ hasBinary: { say: true }, commands: cmds })
    const p = createSystemProvider({ platform: "darwin", runner })
    await p.init({})
    const ac = new AbortController()
    await p.synthesize("hello world", { voice: "Samantha", rate: 1.0 }, ac.signal)
    expect(cmds[0][0]).toBe("say")
    expect(cmds[0]).toContain("-v")
    expect(cmds[0]).toContain("Samantha")
    expect(cmds[0]).toContain("hello world")
  })

  it("uses `spd-say` on Linux when available", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({ hasBinary: { "spd-say": true, espeak: true }, commands: cmds })
    const p = createSystemProvider({ platform: "linux", runner })
    await p.init({})
    await p.synthesize("hi", {}, new AbortController().signal)
    expect(cmds[0][0]).toBe("spd-say")
  })

  it("falls back to `espeak` on Linux when spd-say missing", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({ hasBinary: { "spd-say": false, espeak: true }, commands: cmds })
    const p = createSystemProvider({ platform: "linux", runner })
    await p.init({})
    await p.synthesize("hi", {}, new AbortController().signal)
    expect(cmds[0][0]).toBe("espeak")
  })

  it("uses powershell on Windows", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({ hasBinary: { powershell: true }, commands: cmds })
    const p = createSystemProvider({ platform: "win32", runner })
    await p.init({})
    await p.synthesize("hi", {}, new AbortController().signal)
    expect(cmds[0][0]).toBe("powershell")
    expect(cmds[0].join(" ")).toContain("SpeechSynthesizer")
  })

  it("init throws when no binary available", async () => {
    const runner = fakeRunner({ hasBinary: {}, commands: [] })
    const p = createSystemProvider({ platform: "linux", runner })
    await expect(p.init({})).rejects.toThrow(/no supported.*tts/i)
  })

  it("synthesize rejects on aborted signal", async () => {
    const runner = fakeRunner({ hasBinary: { say: true }, commands: [] })
    const p = createSystemProvider({ platform: "darwin", runner })
    await p.init({})
    const ac = new AbortController()
    ac.abort()
    await expect(p.synthesize("hi", {}, ac.signal)).rejects.toThrow()
  })

})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/tts-system.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/tts/system.ts`**

```ts
import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

export interface Runner {
  has(binary: string): Promise<boolean>
  run(cmd: string[], signal: AbortSignal): Promise<{ exitCode: number }>
}

export interface SystemProviderOptions {
  platform?: NodeJS.Platform
  runner?: Runner
}

/** Default runner: uses Bun's $ if available, else Node's child_process. */
async function defaultRunner(): Promise<Runner> {
  // Lazy-load to avoid breaking environments where bun is not present.
  // @ts-ignore - bun global
  const bunShell = (globalThis as any).Bun?.$
  const { spawn } = await import("node:child_process")
  const { access, constants } = await import("node:fs/promises")
  const { delimiter, sep } = await import("node:path")

  async function has(binary: string): Promise<boolean> {
    const PATH = process.env.PATH ?? ""
    const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
    for (const dir of PATH.split(delimiter)) {
      for (const ext of exts) {
        try {
          await access(`${dir}${sep}${binary}${ext}`, constants.X_OK)
          return true
        } catch {}
      }
    }
    return false
  }

  async function run(cmd: string[], signal: AbortSignal): Promise<{ exitCode: number }> {
    if (signal.aborted) throw new DOMException("aborted", "AbortError")
    return await new Promise((resolve, reject) => {
      const child = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" })
      const onAbort = () => { child.kill("SIGTERM") }
      signal.addEventListener("abort", onAbort)
      child.on("error", (e) => { signal.removeEventListener("abort", onAbort); reject(e) })
      child.on("exit", (code) => {
        signal.removeEventListener("abort", onAbort)
        if (signal.aborted) reject(new DOMException("aborted", "AbortError"))
        else resolve({ exitCode: code ?? 0 })
      })
    })
  }

  return { has, run }
}

export function createSystemProvider(options: SystemProviderOptions = {}): TTSProvider {
  const platform = options.platform ?? process.platform
  let runner: Runner | null = options.runner ?? null
  let command: ((text: string, opts: SynthesisOptions) => string[]) | null = null

  async function ensureRunner(): Promise<Runner> {
    if (!runner) runner = await defaultRunner()
    return runner
  }

  return {
    name: "system",
    capabilities: { streaming: false, offline: true },

    async init(): Promise<void> {
      const r = await ensureRunner()
      if (platform === "darwin") {
        if (!(await r.has("say"))) throw new Error("No supported system TTS binary found (expected `say`)")
        command = (text, opts) => {
          const args = ["say"]
          if (opts.voice) args.push("-v", opts.voice)
          if (opts.rate && opts.rate !== 1.0) args.push("-r", String(Math.round(180 * opts.rate)))
          args.push(text)
          return args
        }
      } else if (platform === "linux") {
        if (await r.has("spd-say")) {
          command = (text, opts) => {
            const args = ["spd-say"]
            if (opts.rate && opts.rate !== 1.0) args.push("-r", String(Math.round((opts.rate - 1.0) * 100)))
            args.push(text)
            return args
          }
        } else if (await r.has("espeak")) {
          command = (text, opts) => {
            const args = ["espeak"]
            if (opts.voice) args.push("-v", opts.voice)
            if (opts.rate && opts.rate !== 1.0) args.push("-s", String(Math.round(175 * opts.rate)))
            args.push(text)
            return args
          }
        } else {
          throw new Error("No supported system TTS binary found (expected `spd-say` or `espeak`)")
        }
      } else if (platform === "win32") {
        if (!(await r.has("powershell"))) throw new Error("No supported system TTS binary found (expected `powershell`)")
        command = (text, opts) => {
          const escaped = text.replace(/'/g, "''")
          const rate = opts.rate ? Math.round(((opts.rate - 1.0) * 10)) : 0  // -10..10
          const script = `Add-Type -AssemblyName System.Speech; ` +
            `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
            `$s.Rate = ${rate}; ` +
            (opts.voice ? `$s.SelectVoice('${opts.voice.replace(/'/g, "''")}'); ` : "") +
            `$s.Speak('${escaped}')`
          return ["powershell", "-NoProfile", "-Command", script]
        }
      } else {
        throw new Error(`Unsupported platform for system TTS: ${platform}`)
      }
    },

    async synthesize(text: string, opts: SynthesisOptions, signal: AbortSignal): Promise<SynthesisResult> {
      if (!command) throw new Error("System provider not initialized")
      if (signal.aborted) throw new DOMException("aborted", "AbortError")
      const r = await ensureRunner()
      const cmd = command(text, opts)
      const result = await r.run(cmd, signal)
      if (result.exitCode !== 0) throw new Error(`system TTS exited ${result.exitCode}`)
      // System provider self-plays; return an empty buffer so the queue layer doesn't try to play anything.
      return { audio: Buffer.alloc(0), contentType: "audio/none" }
    },

    validate(): { ok: true } | { ok: false; reason: string } {
      const r = options.runner
      if (!r) return { ok: true }  // can't validate without a runner; defer to init()
      // synchronous-ish check: we can't await here; skip detailed validation.
      return { ok: true }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/tts-system.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tts/system.ts test/tts-system.test.ts
git commit -m "feat(tts/system): add OS-native TTS provider (mac/linux/windows)"
```

---

## Task 8: Audio Player (for cloud providers)

**Files:**
- Create: `src/audio/player.ts`
- Test: `test/audio-player.test.ts`

Plays audio buffers produced by cloud TTS providers. Subprocess-based, abortable. Selects player binary per OS.

- [ ] **Step 1: Write the failing test**

`test/audio-player.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createPlayer } from "../src/audio/player.js"

const fakeRunner = (hasBin: Record<string, boolean>, log: string[][]) => ({
  has: async (b: string) => hasBin[b] ?? false,
  run: async (cmd: string[]) => { log.push(cmd); return { exitCode: 0 } },
})

describe("audio player", () => {
  it("uses afplay on macOS", async () => {
    const cmds: string[][] = []
    const p = createPlayer({ platform: "darwin", runner: fakeRunner({ afplay: true }, cmds) })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("afplay")
  })

  it("prefers paplay over aplay over ffplay on linux", async () => {
    const cmds: string[][] = []
    const p = createPlayer({ platform: "linux", runner: fakeRunner({ paplay: true, aplay: true, ffplay: true }, cmds) })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("paplay")
  })

  it("falls through to ffplay when paplay/aplay missing", async () => {
    const cmds: string[][] = []
    const p = createPlayer({ platform: "linux", runner: fakeRunner({ ffplay: true }, cmds) })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("ffplay")
  })

  it("init throws when no player binary on the host", async () => {
    const p = createPlayer({ platform: "linux", runner: fakeRunner({}, []) })
    await expect(p.init()).rejects.toThrow(/no audio player/i)
  })

  it("uses powershell on windows", async () => {
    const cmds: string[][] = []
    const p = createPlayer({ platform: "win32", runner: fakeRunner({ powershell: true }, cmds) })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("powershell")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/audio-player.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/audio/player.ts`**

```ts
import type { Runner } from "../tts/system.js"
import { writeFile, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface PlayerOptions {
  platform?: NodeJS.Platform
  runner: Runner
}

export interface Player {
  init(): Promise<void>
  play(audio: Buffer | ReadableStream<Uint8Array>, contentType: string, signal: AbortSignal): Promise<void>
}

const LINUX_PLAYERS = ["paplay", "aplay", "ffplay"] as const

export function createPlayer(opts: PlayerOptions): Player {
  const platform = opts.platform ?? process.platform
  let binary: string | null = null

  async function buffer(stream: Buffer | ReadableStream<Uint8Array>): Promise<Buffer> {
    if (Buffer.isBuffer(stream)) return stream
    const chunks: Uint8Array[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)))
  }

  async function writeTemp(buf: Buffer, contentType: string): Promise<string> {
    const ext = contentType.includes("mpeg") ? "mp3" : contentType.includes("wav") ? "wav" : "bin"
    const dir = await mkdtemp(join(tmpdir(), "opencode-voice-"))
    const path = join(dir, `audio.${ext}`)
    await writeFile(path, buf)
    return path
  }

  return {
    async init() {
      if (platform === "darwin") {
        if (!(await opts.runner.has("afplay"))) throw new Error("No audio player available (need `afplay`)")
        binary = "afplay"
      } else if (platform === "linux") {
        for (const b of LINUX_PLAYERS) {
          if (await opts.runner.has(b)) { binary = b; break }
        }
        if (!binary) throw new Error("No audio player available (need one of: paplay, aplay, ffplay)")
      } else if (platform === "win32") {
        if (!(await opts.runner.has("powershell"))) throw new Error("No audio player available (need `powershell`)")
        binary = "powershell"
      } else {
        throw new Error(`Unsupported platform for audio playback: ${platform}`)
      }
    },

    async play(audio, contentType, signal) {
      if (!binary) throw new Error("Audio player not initialized")
      if (signal.aborted) throw new DOMException("aborted", "AbortError")
      const buf = await buffer(audio)
      const tmpPath = await writeTemp(buf, contentType)
      let cmd: string[]
      if (binary === "powershell") {
        cmd = ["powershell", "-NoProfile", "-Command",
          `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${tmpPath.replace(/\\/g, "/")}'); $p.Play(); Start-Sleep -Seconds 30`]
      } else if (binary === "ffplay") {
        cmd = ["ffplay", "-autoexit", "-nodisp", "-loglevel", "quiet", tmpPath]
      } else {
        cmd = [binary, tmpPath]
      }
      await opts.runner.run(cmd, signal)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/audio-player.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/audio/player.ts test/audio-player.test.ts
git commit -m "feat(audio): add subprocess audio player with per-OS binary selection"
```

---

## Task 9: OpenAI TTS Provider

**Files:**
- Create: `src/tts/openai.ts`
- Test: `test/tts-openai.test.ts`

- [ ] **Step 1: Write the failing test**

`test/tts-openai.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createOpenAIProvider } from "../src/tts/openai.js"

describe("openai TTS provider", () => {
  it("posts to /v1/audio/speech with bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      body: new ReadableStream(),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const p = createOpenAIProvider({ fetch: fetchMock })
    await p.init({ apiKey: "sk-test", model: "tts-1" })
    await p.synthesize("hello", { voice: "alloy" }, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/v1/audio/speech")
    expect(init.headers.Authorization).toBe("Bearer sk-test")
    const body = JSON.parse(init.body)
    expect(body.input).toBe("hello")
    expect(body.voice).toBe("alloy")
    expect(body.model).toBe("tts-1")
  })

  it("init throws when apiKey missing", async () => {
    const p = createOpenAIProvider({ fetch: vi.fn() })
    await expect(p.init({})).rejects.toThrow(/api key/i)
  })

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" })
    const p = createOpenAIProvider({ fetch: fetchMock })
    await p.init({ apiKey: "sk-test" })
    await expect(p.synthesize("hi", {}, new AbortController().signal)).rejects.toThrow(/401/)
  })

  it("forwards AbortSignal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: new Headers({ "content-type": "audio/mpeg" }),
      body: new ReadableStream(), arrayBuffer: async () => new ArrayBuffer(0),
    })
    const p = createOpenAIProvider({ fetch: fetchMock })
    await p.init({ apiKey: "sk-test" })
    const ac = new AbortController()
    await p.synthesize("hi", {}, ac.signal)
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/tts-openai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/tts/openai.ts`**

```ts
import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

type FetchLike = typeof fetch

export interface OpenAIProviderOptions {
  fetch?: FetchLike
  endpoint?: string
}

interface OpenAIConfig {
  apiKey?: string
  model?: string
}

export function createOpenAIProvider(opts: OpenAIProviderOptions = {}): TTSProvider {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const endpoint = opts.endpoint ?? "https://api.openai.com/v1/audio/speech"
  let apiKey: string | null = null
  let model = "tts-1"

  return {
    name: "openai",
    capabilities: { streaming: true, offline: false },

    async init(config: unknown): Promise<void> {
      const cfg = (config ?? {}) as OpenAIConfig
      if (!cfg.apiKey) throw new Error("OpenAI provider requires an API key (config.apiKey or OPENAI_API_KEY env)")
      apiKey = cfg.apiKey
      if (cfg.model) model = cfg.model
    },

    async synthesize(text: string, opts: SynthesisOptions, signal: AbortSignal): Promise<SynthesisResult> {
      if (!apiKey) throw new Error("OpenAI provider not initialized")
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: text,
          model,
          voice: opts.voice ?? "alloy",
          response_format: "mp3",
          speed: opts.rate ?? 1.0,
        }),
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`OpenAI TTS request failed: ${res.status} ${body.slice(0, 200)}`)
      }
      const contentType = res.headers.get("content-type") ?? "audio/mpeg"
      const audio = res.body ?? Buffer.from(await res.arrayBuffer())
      return { audio, contentType }
    },

    validate(config: unknown): { ok: true } | { ok: false; reason: string } {
      const cfg = (config ?? {}) as OpenAIConfig
      if (!cfg.apiKey) return { ok: false, reason: "Missing apiKey" }
      return { ok: true }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/tts-openai.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tts/openai.ts test/tts-openai.test.ts
git commit -m "feat(tts/openai): add OpenAI TTS provider"
```

---

## Task 10: ElevenLabs TTS Provider

**Files:**
- Create: `src/tts/elevenlabs.ts`
- Test: `test/tts-elevenlabs.test.ts`

- [ ] **Step 1: Write the failing test**

`test/tts-elevenlabs.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createElevenLabsProvider } from "../src/tts/elevenlabs.js"

describe("elevenlabs TTS provider", () => {
  it("posts to /v1/text-to-speech/{voiceId} with xi-api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: new Headers({ "content-type": "audio/mpeg" }),
      body: new ReadableStream(), arrayBuffer: async () => new ArrayBuffer(0),
    })
    const p = createElevenLabsProvider({ fetch: fetchMock })
    await p.init({ apiKey: "el-test", voiceId: "voice-1" })
    await p.synthesize("hello", {}, new AbortController().signal)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/v1/text-to-speech/voice-1")
    expect(init.headers["xi-api-key"]).toBe("el-test")
    const body = JSON.parse(init.body)
    expect(body.text).toBe("hello")
  })

  it("init throws when apiKey missing", async () => {
    const p = createElevenLabsProvider({ fetch: vi.fn() })
    await expect(p.init({ voiceId: "v" })).rejects.toThrow(/api key/i)
  })

  it("init throws when voiceId missing", async () => {
    const p = createElevenLabsProvider({ fetch: vi.fn() })
    await expect(p.init({ apiKey: "k" })).rejects.toThrow(/voiceId/i)
  })

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" })
    const p = createElevenLabsProvider({ fetch: fetchMock })
    await p.init({ apiKey: "k", voiceId: "v" })
    await expect(p.synthesize("hi", {}, new AbortController().signal)).rejects.toThrow(/429/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/tts-elevenlabs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/tts/elevenlabs.ts`**

```ts
import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

type FetchLike = typeof fetch

export interface ElevenLabsProviderOptions {
  fetch?: FetchLike
  endpoint?: string
}

interface ElevenLabsConfig {
  apiKey?: string
  voiceId?: string
}

export function createElevenLabsProvider(opts: ElevenLabsProviderOptions = {}): TTSProvider {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const base = opts.endpoint ?? "https://api.elevenlabs.io/v1/text-to-speech"
  let apiKey: string | null = null
  let voiceId: string | null = null

  return {
    name: "elevenlabs",
    capabilities: { streaming: true, offline: false },

    async init(config: unknown): Promise<void> {
      const cfg = (config ?? {}) as ElevenLabsConfig
      if (!cfg.apiKey) throw new Error("ElevenLabs provider requires an API key")
      if (!cfg.voiceId) throw new Error("ElevenLabs provider requires a voiceId")
      apiKey = cfg.apiKey
      voiceId = cfg.voiceId
    },

    async synthesize(text: string, _opts: SynthesisOptions, signal: AbortSignal): Promise<SynthesisResult> {
      if (!apiKey || !voiceId) throw new Error("ElevenLabs provider not initialized")
      const res = await fetchFn(`${base}/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: "eleven_monolingual_v1" }),
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`ElevenLabs TTS request failed: ${res.status} ${body.slice(0, 200)}`)
      }
      const contentType = res.headers.get("content-type") ?? "audio/mpeg"
      const audio = res.body ?? Buffer.from(await res.arrayBuffer())
      return { audio, contentType }
    },

    validate(config: unknown): { ok: true } | { ok: false; reason: string } {
      const cfg = (config ?? {}) as ElevenLabsConfig
      if (!cfg.apiKey) return { ok: false, reason: "Missing apiKey" }
      if (!cfg.voiceId) return { ok: false, reason: "Missing voiceId" }
      return { ok: true }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/tts-elevenlabs.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tts/elevenlabs.ts test/tts-elevenlabs.test.ts
git commit -m "feat(tts/elevenlabs): add ElevenLabs TTS provider"
```

---

## Task 11: Template Handler

**Files:**
- Create: `src/handlers/template.ts`
- Test: `test/handlers-template.test.ts`

Pure functions, no async needed (but return Promises for interface uniformity).

- [ ] **Step 1: Write the failing test**

`test/handlers-template.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { renderTemplate, stripMarkdown, truncate } from "../src/handlers/template.js"

describe("renderTemplate", () => {
  it("formats session.error", () => {
    expect(renderTemplate({ type: "session.error", message: "Model overloaded" }))
      .toBe("Session error: Model overloaded.")
  })

  it("truncates long error messages", () => {
    const longMsg = "x".repeat(200)
    const out = renderTemplate({ type: "session.error", message: longMsg })
    expect(out!.length).toBeLessThanOrEqual(110)
  })

  it("formats permission.asked", () => {
    expect(renderTemplate({ type: "permission.asked", tool: "write" }))
      .toBe("Permission requested for write.")
  })

  it("formats session.compacted", () => {
    expect(renderTemplate({ type: "session.compacted" })).toBe("Session compacted.")
  })

  it("formats tool.execute.before / .after", () => {
    expect(renderTemplate({ type: "tool.execute.before", tool: "bash" })).toBe("Running bash.")
    expect(renderTemplate({ type: "tool.execute.after", tool: "bash" })).toBe("bash done.")
  })

  it("formats todo.completed.item with content", () => {
    expect(renderTemplate({ type: "todo.completed.item", content: "Add login route" }))
      .toBe("Task complete: Add login route.")
  })

  it("returns null for unknown event types", () => {
    expect(renderTemplate({ type: "unknown.event" })).toBeNull()
  })

  it("formats message.updated with stripped markdown", () => {
    const out = renderTemplate({ type: "message.updated", text: "**Bold** and `code` text" })
    expect(out).toBe("Bold and code text")
  })

  it("formats session.idle with a fallback line", () => {
    expect(renderTemplate({ type: "session.idle" })).toBe("Session idle.")
  })
})

describe("stripMarkdown", () => {
  it("removes bold, italic, code, links", () => {
    expect(stripMarkdown("**hi**")).toBe("hi")
    expect(stripMarkdown("_x_")).toBe("x")
    expect(stripMarkdown("`code`")).toBe("code")
    expect(stripMarkdown("[label](http://x)")).toBe("label")
    expect(stripMarkdown("# Heading")).toBe("Heading")
  })
})

describe("truncate", () => {
  it("returns the string when shorter than limit", () => {
    expect(truncate("short", 10)).toBe("short")
  })
  it("truncates and appends ellipsis", () => {
    expect(truncate("a".repeat(20), 10)).toBe("aaaaaaaaaa…")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/handlers-template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/handlers/template.ts`**

```ts
export interface AnyEvent {
  type: string
  [key: string]: unknown
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + "…"
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")        // fenced code
    .replace(/`([^`]+)`/g, "$1")           // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")     // bold
    .replace(/\*([^*]+)\*/g, "$1")         // italic
    .replace(/__([^_]+)__/g, "$1")         // bold
    .replace(/_([^_]+)_/g, "$1")           // italic
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")  // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
    .replace(/^#+\s+/gm, "")               // headings
    .replace(/^\s*[-*+]\s+/gm, "")         // list bullets
    .replace(/\s+/g, " ")
    .trim()
}

type Renderer = (e: AnyEvent) => string

const templates: Record<string, Renderer> = {
  "session.idle":         ()  => "Session idle.",
  "session.error":        (e) => `Session error: ${truncate(String(e.message ?? "unknown"), 80)}.`,
  "session.compacted":    ()  => "Session compacted.",
  "permission.asked":     (e) => `Permission requested for ${e.tool ?? "an operation"}.`,
  "todo.completed.all":   ()  => "All todos complete.",
  "todo.completed.item":  (e) => `Task complete: ${truncate(stripMarkdown(String(e.content ?? "")), 40)}.`,
  "tool.execute.before":  (e) => `Running ${e.tool ?? "tool"}.`,
  "tool.execute.after":   (e) => `${e.tool ?? "tool"} done.`,
  "message.updated":      (e) => truncate(stripMarkdown(String(e.text ?? "")), 300),
}

export function renderTemplate(event: AnyEvent): string | null {
  const fn = templates[event.type]
  if (!fn) return null
  const out = fn(event)
  return out.length === 0 ? null : out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/handlers-template.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/template.ts test/handlers-template.test.ts
git commit -m "feat(handlers/template): add deterministic event templates"
```

---

## Task 12: Narrator Handler

**Files:**
- Create: `src/handlers/narrator.ts`
- Test: `test/handlers-narrator.test.ts`

LLM-based summarization with timeout, token cap, min-interval throttle, and fallback to template.

- [ ] **Step 1: Write the failing test**

`test/handlers-narrator.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createNarrator } from "../src/handlers/narrator.js"

const baseConfig = { model: "test/narrator", maxTokens: 60, timeoutMs: 1000, minIntervalMs: 0 }

function ctx(text: string) {
  return { assistantText: text, recentTools: [] as string[] }
}

describe("narrator", () => {
  it("calls model with crafted prompt and returns summary", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "Done refactoring." } }] })
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("did stuff"))
    expect(out).toBe("Done refactoring.")
    expect(create).toHaveBeenCalledOnce()
    const args = create.mock.calls[0][0]
    expect(args.model).toBe("test/narrator")
    expect(args.max_tokens).toBe(60)
    expect(args.messages[0].content).toContain("did stuff")
  })

  it("returns null when timeout elapses", async () => {
    const create = vi.fn().mockImplementation(() => new Promise(() => {}))  // never resolves
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, { ...baseConfig, timeoutMs: 20 })
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("returns null when api errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("500"))
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("throttles within minIntervalMs returning null", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] })
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, { ...baseConfig, minIntervalMs: 100_000 })
    const first = await n.summarize({ type: "session.idle" }, ctx("x"))
    const second = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(first).toBe("ok")
    expect(second).toBeNull()
    expect(create).toHaveBeenCalledOnce()
  })

  it("truncates very long assistant text in the prompt", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] })
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, baseConfig)
    const long = "x".repeat(10_000)
    await n.summarize({ type: "session.idle" }, ctx(long))
    const prompt = create.mock.calls[0][0].messages[0].content
    expect(prompt.length).toBeLessThan(3000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/handlers-narrator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/handlers/narrator.ts`**

```ts
import { truncate } from "./template.js"

export interface NarrationContext {
  assistantText: string
  recentTools: string[]
}

export interface NarratorClient {
  chat: {
    completions: {
      create: (req: {
        model: string
        max_tokens: number
        temperature?: number
        messages: { role: "user" | "system"; content: string }[]
      }) => Promise<{ choices: { message: { content: string } }[] }>
    }
  }
}

export interface NarratorConfig {
  model: string
  maxTokens: number
  timeoutMs: number
  minIntervalMs: number
}

export interface Narrator {
  summarize(event: { type: string; [k: string]: unknown }, ctx: NarrationContext): Promise<string | null>
}

export function createNarrator(client: NarratorClient, config: NarratorConfig): Narrator {
  let lastFinishedAt = 0

  function buildPrompt(event: { type: string }, ctx: NarrationContext): string {
    const text = truncate(ctx.assistantText, 2000)
    const tools = ctx.recentTools.slice(-5).map((t) => `- ${t}`).join("\n") || "(none)"
    const occasion = event.type === "todo.completed.all" ? "all todos are now complete" : "just finished a turn"
    return [
      "You are a brief spoken status narrator for a coding agent.",
      `The agent ${occasion}. Summarize what happened in ONE sentence, under 25 words, spoken style (no markdown, no code, no quotes).`,
      "",
      "Recent assistant output:",
      text || "(none)",
      "",
      "Recent tool calls:",
      tools,
    ].join("\n")
  }

  return {
    async summarize(event, ctx) {
      const now = Date.now()
      if (now - lastFinishedAt < config.minIntervalMs) return null

      const prompt = buildPrompt(event, ctx)
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          client.chat.completions.create({
            model: config.model,
            max_tokens: config.maxTokens,
            temperature: 0.3,
            messages: [{ role: "user", content: prompt }],
          }),
          new Promise<null>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(null), config.timeoutMs)
          }),
        ])
        if (!result) return null
        lastFinishedAt = Date.now()
        const text = result.choices?.[0]?.message?.content?.trim() ?? ""
        return text.length > 0 ? text : null
      } catch {
        return null
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/handlers-narrator.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/narrator.ts test/handlers-narrator.test.ts
git commit -m "feat(handlers/narrator): add LLM summarizer with timeout, throttle, fallback"
```

---

## Task 13: Handler Registry

**Files:**
- Create: `src/handlers/index.ts`
- Test: `test/handlers-index.test.ts`

Routes an event to the configured handler mode (`template`, `narrate`, `verbatim`) and produces a `SpeechRequest` (or null).

- [ ] **Step 1: Write the failing test**

`test/handlers-index.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createHandlerRegistry } from "../src/handlers/index.js"
import { Priority } from "../src/queue/types.js"

const baseEvents = {
  "session.idle":      { enabled: true, mode: "narrate"  as const },
  "session.error":     { enabled: true, mode: "template" as const, priority: "urgent" as const },
  "tool.execute.before": { enabled: true, mode: "template" as const },
  "message.updated":  { enabled: true, mode: "verbatim" as const },
  "disabled.event":   { enabled: false, mode: "template" as const },
}

function fakeNarrator(text: string | null) {
  return { summarize: vi.fn().mockResolvedValue(text) }
}

describe("handler registry", () => {
  it("returns null for disabled events", async () => {
    const r = createHandlerRegistry({ events: baseEvents, narrator: fakeNarrator("hi"), getContext: () => ({ assistantText: "", recentTools: [] }) })
    expect(await r.handle({ type: "disabled.event" })).toBeNull()
  })

  it("uses template for mode=template", async () => {
    const r = createHandlerRegistry({ events: baseEvents, narrator: fakeNarrator(null), getContext: () => ({ assistantText: "", recentTools: [] }) })
    const sr = await r.handle({ type: "session.error", message: "bad" })
    expect(sr?.text).toContain("Session error")
    expect(sr?.priority).toBe(Priority.URGENT)
    expect(sr?.dedupKey).toBe("session.error")
  })

  it("uses narrator for mode=narrate", async () => {
    const n = fakeNarrator("Wrapped up.")
    const r = createHandlerRegistry({ events: baseEvents, narrator: n, getContext: () => ({ assistantText: "did x", recentTools: [] }) })
    const sr = await r.handle({ type: "session.idle" })
    expect(n.summarize).toHaveBeenCalled()
    expect(sr?.text).toBe("Wrapped up.")
    expect(sr?.priority).toBe(Priority.NORMAL)
  })

  it("falls back to template when narrator returns null", async () => {
    const r = createHandlerRegistry({ events: baseEvents, narrator: fakeNarrator(null), getContext: () => ({ assistantText: "x", recentTools: [] }) })
    const sr = await r.handle({ type: "session.idle" })
    expect(sr?.text).toBe("Session idle.")
  })

  it("returns null when template has no entry and narrator returns null", async () => {
    const r = createHandlerRegistry({
      events: { "unknown.thing": { enabled: true, mode: "narrate" as const } },
      narrator: fakeNarrator(null),
      getContext: () => ({ assistantText: "", recentTools: [] }),
    })
    expect(await r.handle({ type: "unknown.thing" })).toBeNull()
  })

  it("uses verbatim mode (read text field)", async () => {
    const r = createHandlerRegistry({ events: baseEvents, narrator: fakeNarrator(null), getContext: () => ({ assistantText: "", recentTools: [] }) })
    const sr = await r.handle({ type: "message.updated", text: "**hello world**" })
    expect(sr?.text).toBe("hello world")
  })

  it("applies CHATTY priority to tool events by default", async () => {
    const r = createHandlerRegistry({ events: baseEvents, narrator: fakeNarrator(null), getContext: () => ({ assistantText: "", recentTools: [] }) })
    const sr = await r.handle({ type: "tool.execute.before", tool: "bash" })
    expect(sr?.priority).toBe(Priority.CHATTY)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/handlers-index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/handlers/index.ts`**

```ts
import { randomUUID } from "node:crypto"
import { Priority, type SpeechRequest } from "../queue/types.js"
import { renderTemplate, stripMarkdown, truncate } from "./template.js"
import type { Narrator, NarrationContext } from "./narrator.js"

export interface EventConfig {
  enabled: boolean
  mode: "template" | "narrate" | "verbatim"
  priority?: "urgent" | "normal" | "chatty"
}

export interface HandlerRegistryOptions {
  events: Record<string, EventConfig>
  narrator: Narrator
  getContext: () => NarrationContext
}

export interface HandlerRegistry {
  handle(event: { type: string; [k: string]: unknown }): Promise<SpeechRequest | null>
}

const DEFAULT_PRIORITY: Record<string, Priority> = {
  "session.idle":         Priority.NORMAL,
  "session.error":        Priority.URGENT,
  "session.compacted":    Priority.NORMAL,
  "permission.asked":     Priority.URGENT,
  "todo.completed.all":   Priority.NORMAL,
  "todo.completed.item":  Priority.CHATTY,
  "tool.execute.before":  Priority.CHATTY,
  "tool.execute.after":   Priority.CHATTY,
  "message.updated":      Priority.CHATTY,
}

function priorityFromName(name?: string): Priority | null {
  if (name === "urgent") return Priority.URGENT
  if (name === "normal") return Priority.NORMAL
  if (name === "chatty") return Priority.CHATTY
  return null
}

export function createHandlerRegistry(opts: HandlerRegistryOptions): HandlerRegistry {
  return {
    async handle(event) {
      const cfg = opts.events[event.type]
      if (!cfg || !cfg.enabled) return null

      let text: string | null = null
      if (cfg.mode === "template") {
        text = renderTemplate(event)
      } else if (cfg.mode === "narrate") {
        text = await opts.narrator.summarize(event, opts.getContext())
        if (!text) text = renderTemplate(event)
      } else if (cfg.mode === "verbatim") {
        const raw = String(event.text ?? "")
        const stripped = stripMarkdown(raw)
        text = truncate(stripped, 300)
      }
      if (!text) return null

      const priority = priorityFromName(cfg.priority) ?? DEFAULT_PRIORITY[event.type] ?? Priority.NORMAL
      return {
        id: randomUUID(),
        priority,
        text,
        dedupKey: event.type,
        enqueuedAt: Date.now(),
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/handlers-index.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/index.ts test/handlers-index.test.ts
git commit -m "feat(handlers): add handler registry routing by event mode"
```

---

## Task 14: Dispatcher

**Files:**
- Create: `src/dispatcher.ts`
- Test: `test/dispatcher.test.ts`

Subscribes to the opencode `event` hook. Derives the synthetic `todo.completed.all` / `todo.completed.item` events from raw `todo.updated` payloads. Also accumulates the recent assistant text + tool log used by the narrator's `getContext`.

- [ ] **Step 1: Write the failing test**

`test/dispatcher.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createDispatcher } from "../src/dispatcher.js"

describe("dispatcher", () => {
  it("forwards plain events to the handler", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({ type: "session.idle" })
    expect(handle).toHaveBeenCalledWith({ type: "session.idle" })
  })

  it("pushes returned SpeechRequest to the queue", async () => {
    const req = { id: "x", priority: 2, text: "hi", enqueuedAt: 0 }
    const handle = vi.fn().mockResolvedValue(req)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({ type: "session.error" })
    expect(push).toHaveBeenCalledWith(req)
  })

  it("derives todo.completed.item from todo.updated transitions", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({ type: "todo.updated", todos: [{ id: "1", content: "A", status: "pending" }] })
    await d.onEvent({ type: "todo.updated", todos: [{ id: "1", content: "A", status: "completed" }] })
    const types = handle.mock.calls.map(([e]) => e.type)
    expect(types).toContain("todo.completed.item")
    const itemEvent = handle.mock.calls.find(([e]) => e.type === "todo.completed.item")?.[0]
    expect(itemEvent.content).toBe("A")
  })

  it("derives todo.completed.all when every todo is completed", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({ type: "todo.updated", todos: [
      { id: "1", content: "A", status: "pending" },
      { id: "2", content: "B", status: "pending" },
    ]})
    await d.onEvent({ type: "todo.updated", todos: [
      { id: "1", content: "A", status: "completed" },
      { id: "2", content: "B", status: "completed" },
    ]})
    const types = handle.mock.calls.map(([e]) => e.type)
    expect(types).toContain("todo.completed.all")
  })

  it("does not re-fire todo.completed.all when no new transitions happened", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    const todos = [{ id: "1", content: "A", status: "completed" }]
    await d.onEvent({ type: "todo.updated", todos })
    handle.mockClear()
    await d.onEvent({ type: "todo.updated", todos })
    expect(handle.mock.calls.find(([e]) => e.type === "todo.completed.all")).toBeUndefined()
  })

  it("accumulates assistant text for getContext()", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onMessagePart("assistant says hello")
    await d.onToolStart("bash")
    expect(d.getContext().assistantText).toContain("assistant says hello")
    expect(d.getContext().recentTools).toContain("bash")
  })

  it("never throws when handler throws", async () => {
    const handle = vi.fn().mockRejectedValue(new Error("boom"))
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push }, onError: () => {} } as any)
    await expect(d.onEvent({ type: "session.idle" })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/dispatcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/dispatcher.ts`**

```ts
import type { SpeechRequest } from "./queue/types.js"
import type { HandlerRegistry } from "./handlers/index.js"
import type { NarrationContext } from "./handlers/narrator.js"

interface QueueIfc { push(req: SpeechRequest): void }

export interface DispatcherOptions {
  handler: HandlerRegistry
  queue: QueueIfc
  onError?: (err: unknown, event: { type: string }) => void
  /** Max chars of recent assistant text to keep. */
  textWindow?: number
  /** Max recent tool calls to remember. */
  toolWindow?: number
}

interface TodoSnapshot { id: string; content: string; status: string }

export interface Dispatcher {
  onEvent(event: { type: string; [k: string]: unknown }): Promise<void>
  onMessagePart(text: string): Promise<void>
  onToolStart(tool: string): Promise<void>
  getContext(): NarrationContext
}

export function createDispatcher(opts: DispatcherOptions): Dispatcher {
  const textWindow = opts.textWindow ?? 4000
  const toolWindow = opts.toolWindow ?? 10
  let assistantText = ""
  const recentTools: string[] = []
  const todoStatus = new Map<string, string>()  // id -> last seen status

  function appendText(t: string) {
    assistantText = (assistantText + " " + t).slice(-textWindow)
  }

  async function fire(event: { type: string; [k: string]: unknown }): Promise<void> {
    try {
      const sr = await opts.handler.handle(event)
      if (sr) opts.queue.push(sr)
    } catch (err) {
      opts.onError?.(err, event)
    }
  }

  async function handleTodoUpdated(event: { type: string; todos?: TodoSnapshot[] }): Promise<void> {
    const todos = event.todos ?? []
    let transitionsToCompleted = 0
    for (const t of todos) {
      const prev = todoStatus.get(t.id)
      if (prev !== "completed" && t.status === "completed") {
        transitionsToCompleted++
        await fire({ type: "todo.completed.item", content: t.content })
      }
      todoStatus.set(t.id, t.status)
    }
    if (todos.length > 0 && todos.every((t) => t.status === "completed") && transitionsToCompleted > 0) {
      await fire({ type: "todo.completed.all", count: todos.length })
    }
    await fire({ type: "todo.updated", todos })  // also forward raw (no template by default)
  }

  return {
    async onEvent(event) {
      if (event.type === "todo.updated") return handleTodoUpdated(event as any)
      await fire(event)
    },
    async onMessagePart(text) { appendText(text) },
    async onToolStart(tool) {
      recentTools.push(tool)
      while (recentTools.length > toolWindow) recentTools.shift()
    },
    getContext() {
      return { assistantText, recentTools: [...recentTools] }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/dispatcher.test.ts`
Expected: 7 tests pass.

Note: the test `it("never throws when handler throws", ...)` expects the dispatcher to swallow handler errors via `opts.onError`. The implementation above does that. The dispatcher.onEvent for todo also wraps `fire()` calls which catch internally. Confirm.

- [ ] **Step 5: Commit**

```bash
git add src/dispatcher.ts test/dispatcher.test.ts
git commit -m "feat(dispatcher): add event router with todo transition detection"
```

---

## Task 15: Commands

**Files:**
- Create: `src/commands/index.ts`
- Test: `test/commands.test.ts`

Provides programmatic mute/unmute/say/test/status operations. Wiring to opencode's slash command API happens in Task 16. If that API isn't usable, these are exposed via a `voice` custom tool.

- [ ] **Step 1: Write the failing test**

`test/commands.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { createCommands } from "../src/commands/index.js"
import { Priority } from "../src/queue/types.js"

function fakeQueue() {
  const log: string[] = []
  return {
    log,
    push: vi.fn((r: any) => log.push(`push:${r.text}`)),
    mute: vi.fn(() => log.push("mute")),
    unmute: vi.fn(() => log.push("unmute")),
    size: vi.fn(() => 3),
  } as any
}

describe("commands", () => {
  it("mute calls queue.mute and updates state", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.mute()
    expect(q.mute).toHaveBeenCalled()
    expect(c.status().muted).toBe(true)
  })

  it("unmute calls queue.unmute and updates state", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.mute()
    c.unmute()
    expect(q.unmute).toHaveBeenCalled()
    expect(c.status().muted).toBe(false)
  })

  it("say pushes a NORMAL-priority request", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.say("hello there")
    const req = q.push.mock.calls[0][0]
    expect(req.text).toBe("hello there")
    expect(req.priority).toBe(Priority.NORMAL)
  })

  it("test pushes a canned message", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.test()
    expect(q.push).toHaveBeenCalled()
  })

  it("status returns provider/voice/muted/queue size", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "openai", voiceName: "nova" })
    const s = c.status()
    expect(s.provider).toBe("openai")
    expect(s.voice).toBe("nova")
    expect(s.queueSize).toBe(3)
    expect(s.muted).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/index.ts`**

```ts
import { randomUUID } from "node:crypto"
import { Priority, type SpeechRequest } from "../queue/types.js"

export interface CommandsOptions {
  queue: {
    push(req: SpeechRequest): void
    mute(): void
    unmute(): void
    size(): number
  }
  providerName: string
  voiceName?: string
}

export interface VoiceStatus {
  provider: string
  voice?: string
  muted: boolean
  queueSize: number
}

export interface Commands {
  mute(): void
  unmute(): void
  say(text: string): void
  test(): void
  status(): VoiceStatus
}

export function createCommands(opts: CommandsOptions): Commands {
  let muted = false

  function makeRequest(text: string, priority: Priority): SpeechRequest {
    return { id: randomUUID(), priority, text, enqueuedAt: Date.now() }
  }

  return {
    mute() { muted = true; opts.queue.mute() },
    unmute() { muted = false; opts.queue.unmute() },
    say(text: string) { opts.queue.push(makeRequest(text, Priority.NORMAL)) },
    test() { opts.queue.push(makeRequest("opencode voice test. If you hear this, audio is working.", Priority.NORMAL)) },
    status(): VoiceStatus {
      return { provider: opts.providerName, voice: opts.voiceName, muted, queueSize: opts.queue.size() }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/commands.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/index.ts test/commands.test.ts
git commit -m "feat(commands): add mute/unmute/say/test/status operations"
```

---

## Task 16: Plugin Entry & Wiring

**Files:**
- Create: `src/index.ts`
- Test: `test/index.test.ts` (light integration; full e2e is Task 17)

Exports the opencode plugin function. Wires config → providers → queue → handlers → dispatcher → commands. Subscribes to opencode events.

**Important — opencode plugin API research note for the implementer:**

The opencode plugin docs (https://opencode.ai/docs/plugins/) confirm these event hook keys but **do not** describe a stable in-plugin slash-command registration API at the time of writing. Before implementing this task, verify with `gh repo view anomalyco/opencode` / search the source for "tui.command" or "command.executed" to confirm the supported registration pathway. If none exists for plugins, fall back to:

1. A custom tool named `voice` (via the `tool:` plugin export) that the agent can invoke with `{ action: "mute" | "unmute" | "say" | "test" | "status", text?: string }`.
2. A `dist/cli.js` bin (already declared in package.json) implementing `opencode-voice test` that runs the test command in standalone mode for the user's setup verification.

The tests below assume the custom-tool fallback path; if real slash commands become available, add them in addition.

- [ ] **Step 1: Write the failing test**

`test/index.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { OpencodeVoice } from "../src/index.js"

describe("OpencodeVoice plugin", () => {
  it("returns an empty (no-op) hooks object when OPENCODE_VOICE_DISABLED=1", async () => {
    const ctx = {
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp",
      worktree: "/tmp",
      project: { config: { voice: {} } },
      $: vi.fn(),
    } as any
    const oldEnv = process.env.OPENCODE_VOICE_DISABLED
    process.env.OPENCODE_VOICE_DISABLED = "1"
    try {
      const hooks = await OpencodeVoice(ctx)
      expect(hooks).toEqual({})
    } finally {
      if (oldEnv === undefined) delete process.env.OPENCODE_VOICE_DISABLED
      else process.env.OPENCODE_VOICE_DISABLED = oldEnv
    }
  })

  it("registers an `event` hook that does not throw on unknown events", async () => {
    const ctx = {
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp", worktree: "/tmp",
      project: { config: { voice: { events: {} } } },
      $: vi.fn(),
    } as any
    const hooks = await OpencodeVoice(ctx) as any
    expect(typeof hooks.event).toBe("function")
    await expect(hooks.event({ event: { type: "some.unknown.event" } })).resolves.toBeUndefined()
  })

  it("registers a `voice` custom tool", async () => {
    const ctx = {
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp", worktree: "/tmp",
      project: { config: { voice: { } } },
      $: vi.fn(),
    } as any
    const hooks = await OpencodeVoice(ctx) as any
    expect(hooks.tool?.voice).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test test/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/index.ts`**

```ts
import { parseConfig } from "./config.js"
import { createLogger } from "./log.js"
import { SpeechQueue } from "./queue/speech-queue.js"
import { Priority, type SpeechRequest } from "./queue/types.js"
import { registerProvider, getProvider, type TTSProvider } from "./tts/provider.js"
import { createSystemProvider } from "./tts/system.js"
import { createOpenAIProvider } from "./tts/openai.js"
import { createElevenLabsProvider } from "./tts/elevenlabs.js"
import { createPlayer } from "./audio/player.js"
import { createHandlerRegistry } from "./handlers/index.js"
import { createNarrator } from "./handlers/narrator.js"
import { createDispatcher } from "./dispatcher.js"
import { createCommands } from "./commands/index.js"

export { registerProvider } from "./tts/provider.js"
export type { TTSProvider, SynthesisOptions, SynthesisResult } from "./tts/provider.js"

type PluginCtx = {
  client: { app: { log: (...args: any[]) => Promise<unknown> }; chat?: any }
  directory: string
  worktree?: string
  project: { config?: { voice?: unknown } }
  $: unknown
}

export const OpencodeVoice = async (ctx: PluginCtx) => {
  const logger = createLogger(ctx.client as any, "opencode-voice")
  const rawConfig = (ctx.project?.config as any)?.voice ?? {}
  const parsed = parseConfig(rawConfig)

  if (!parsed.ok) {
    await logger.error("Invalid voice config; plugin disabled", { errors: parsed.errors })
    return {}
  }
  const config = parsed.config

  if (!config.enabled) {
    await logger.info("opencode-voice disabled by config or env")
    return {}
  }

  // 1. Register built-in providers.
  registerProvider(createSystemProvider({}))
  registerProvider(createOpenAIProvider({}))
  registerProvider(createElevenLabsProvider({}))

  // 2. Resolve and initialize the selected provider.
  const provider = getProvider(config.tts.provider)
  if (!provider) {
    await logger.error(`Unknown TTS provider: ${config.tts.provider}`)
    return {}
  }
  try {
    const providerConfig =
      config.tts.provider === "openai" ? config.tts.openai :
      config.tts.provider === "elevenlabs" ? config.tts.elevenlabs : {}
    await provider.init(providerConfig)
  } catch (err) {
    await logger.error("Failed to initialize TTS provider; plugin self-disabling", { error: String(err) })
    return {}
  }

  // 3. Set up audio player (only used if provider returns real audio bytes).
  let player: { init(): Promise<void>; play(...args: any[]): Promise<void> } | null = null
  if (provider.capabilities.streaming) {
    try {
      // Construct a minimal default runner inline (same shape as Runner in src/tts/system.ts):
      const { spawn } = await import("node:child_process")
      const { access, constants } = await import("node:fs/promises")
      const { delimiter, sep } = await import("node:path")
      const runner = {
        async has(b: string) {
          const PATH = process.env.PATH ?? ""
          for (const d of PATH.split(delimiter)) {
            try { await access(`${d}${sep}${b}`, constants.X_OK); return true } catch {}
          }
          return false
        },
        run(cmd: string[], signal: AbortSignal) {
          return new Promise<{ exitCode: number }>((resolve, reject) => {
            const c = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" })
            const onAbort = () => c.kill("SIGTERM")
            signal.addEventListener("abort", onAbort)
            c.on("error", (e) => { signal.removeEventListener("abort", onAbort); reject(e) })
            c.on("exit", (code) => {
              signal.removeEventListener("abort", onAbort)
              if (signal.aborted) reject(new DOMException("aborted", "AbortError"))
              else resolve({ exitCode: code ?? 0 })
            })
          })
        },
      }
      player = createPlayer({ runner })
      await player.init()
    } catch (err) {
      await logger.warn("Audio player unavailable; cloud providers may not produce output", { error: String(err) })
      player = null
    }
  }

  // 4. Build the speak function used by the queue.
  async function speak(req: SpeechRequest, signal: AbortSignal): Promise<void> {
    const result = await provider!.synthesize(req.text, { voice: config.tts.voice, rate: config.tts.rate, pitch: config.tts.pitch }, signal)
    if (result.contentType === "audio/none") return  // system providers self-play
    if (!player) {
      await logger.warn("Audio produced but no player available; dropping audio")
      return
    }
    await player.play(result.audio, result.contentType, signal)
  }

  // 5. Wire queue.
  const queue = new SpeechQueue({
    speak,
    staleMs: config.queue.staleMs,
    now: () => Date.now(),
    onError: (err, req) => { void logger.warn(`speak failed for "${req.text}"`, { error: String(err) }) },
  })

  // 6. Narrator + handler registry.
  const narrator = createNarrator((ctx.client as any).chat ? (ctx.client as any) : {
    // If the SDK exposes a different shape, the narrator will fail and fall back to template.
    chat: { completions: { create: async () => { throw new Error("Narrator client not available in this context") } } },
  }, config.narrator)

  const dispatcher = createDispatcher({
    handler: createHandlerRegistry({
      events: config.events as any,
      narrator,
      getContext: () => dispatcher.getContext(),
    }),
    queue,
    onError: (err, e) => { void logger.warn(`handler error for ${e.type}`, { error: String(err) }) },
  })

  // 7. Commands + custom tool.
  const commands = createCommands({ queue, providerName: config.tts.provider, voiceName: config.tts.voice })
  if (config.startMuted) commands.mute()

  await logger.info(`opencode-voice ready (provider=${config.tts.provider})`)

  return {
    event: async ({ event }: { event: { type: string; [k: string]: unknown } }) => {
      try {
        if (event.type === "message.part.updated" && typeof (event as any).text === "string") {
          await dispatcher.onMessagePart((event as any).text)
        }
        if (event.type === "tool.execute.before" && typeof (event as any).tool === "string") {
          await dispatcher.onToolStart((event as any).tool)
        }
        await dispatcher.onEvent(event)
      } catch (err) {
        await logger.warn(`event handler crashed for ${event.type}`, { error: String(err) })
      }
    },
    tool: {
      voice: {
        description: "Control the opencode-voice plugin: mute, unmute, say text, test, or report status.",
        args: {
          // Engine-specific Zod-like schema; using simple object to avoid coupling.
        },
        async execute(args: { action: "mute" | "unmute" | "say" | "test" | "status"; text?: string }) {
          if (args.action === "mute") { commands.mute(); return "muted" }
          if (args.action === "unmute") { commands.unmute(); return "unmuted" }
          if (args.action === "say") { commands.say(args.text ?? ""); return "queued" }
          if (args.action === "test") { commands.test(); return "test queued" }
          if (args.action === "status") return JSON.stringify(commands.status())
          return `unknown action: ${args.action}`
        },
      },
    },
  }
}

export default OpencodeVoice
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test test/index.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full test suite**

Run: `bun run test`
Expected: all tests across all modules pass.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Build**

Run: `bun run build`
Expected: `dist/index.js` and `dist/index.d.ts` produced.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: wire opencode-voice plugin entry"
```

---

## Task 17: Smoke Integration Test

**Files:**
- Create: `test/integration.test.ts`

End-to-end check that the system provider can actually spawn its subprocess on the host OS. No audio assertion — just exit code.

- [ ] **Step 1: Write the test**

`test/integration.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createSystemProvider } from "../src/tts/system.js"

describe("integration: system TTS subprocess", () => {
  it("can spawn the OS TTS binary without error", async () => {
    const provider = createSystemProvider({})
    try {
      await provider.init({})
    } catch (err) {
      console.warn("Skipping integration test — no system TTS on this host:", err)
      return
    }
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 2000)  // don't hang on misconfigured hosts
    try {
      await provider.synthesize("opencode voice integration test", { rate: 2.0 }, ac.signal)
    } catch (err: any) {
      // AbortError is acceptable — we just want to see the subprocess started
      if (err?.name !== "AbortError") throw err
    }
    expect(true).toBe(true)
  }, 5000)
})
```

- [ ] **Step 2: Run integration**

Run: `bun run test test/integration.test.ts`
Expected: passes on macOS/Linux/Windows where TTS is installed; skips with a warning otherwise.

- [ ] **Step 3: Commit**

```bash
git add test/integration.test.ts
git commit -m "test: add system-provider smoke integration test"
```

---

## Task 18: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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

```ts
import { registerProvider } from "opencode-voice"

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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Final Verification

- [ ] **Run the entire test suite:** `bun run test`. Expect every test passing.
- [ ] **Run typecheck:** `bun run typecheck`. Expect zero errors.
- [ ] **Run build:** `bun run build`. Expect `dist/` populated with `index.js` and `index.d.ts`.
- [ ] **Manually smoke-test against a real opencode session:**
  1. `bun link` in this repo.
  2. In a separate opencode project, add `opencode-voice` to `opencode.json` and `bun link opencode-voice` in its config dir.
  3. Run opencode; trigger a `permission.asked` event and confirm you hear "Permission requested for …".
  4. Let a turn finish; confirm you hear an LLM-summarized completion line.
  5. Switch `voice.tts.provider` to `openai` (with a key); confirm cloud TTS works.
- [ ] **Commit final adjustments** if smoke tests reveal issues.

---

## Notes for the Implementer

- **DRY:** the `Runner` interface in `src/tts/system.ts` is reused by `src/audio/player.ts`. Don't duplicate the binary-detection logic.
- **YAGNI:** do not add custom-template support, locale support, sound effects, or STT — they're explicitly out of scope (spec §11).
- **TDD:** every task starts with a failing test. Resist the urge to write implementation first.
- **Frequent commits:** one commit per task minimum; smaller commits within tasks are fine.
- **Don't widen the public surface:** only `OpencodeVoice` (default export) and `registerProvider` + TTS types are public API. Everything else stays internal.
- **Open question to resolve during implementation:** the exact `event` payload shapes from opencode (e.g. does `permission.asked` carry a `tool` field, or a different name?). Inspect runtime payloads on a real session and adjust the template renderers accordingly. The test suite uses synthetic payloads matching the spec; adjust both when real payloads differ.
