/**
 * Test the LLM narrator handler in isolation. Sends a real request to your
 * configured chat-completions endpoint and prints + speaks the result.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npm run demo:narrator -- --assistant-text="I refactored the auth module" --tool=edit --tool=bash
 *
 * Flags:
 *   --assistant-text=...   sample recent assistant output (required)
 *   --tool=...             one or more recent tool calls (repeatable)
 *   --model=...            override narrator model (default: gpt-4o-mini)
 *   --no-speak             only print, don't speak
 *
 * Defaults to the OpenAI chat-completions endpoint. Swap providers by setting
 *   OPENAI_API_BASE=https://your-endpoint  (must be OpenAI-compatible).
 */

import { createNarrator } from "../src/handlers/narrator.js"
import { createSystemProvider } from "../src/tts/system.js"
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
const model = flag("model") ?? "gpt-4o-mini"
const noSpeak = args.includes("--no-speak")

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error("OPENAI_API_KEY env var required")
  process.exit(1)
}

const apiBase = process.env.OPENAI_API_BASE ?? "https://api.openai.com"

// Build a minimal OpenAI-compatible client that the narrator can call.
const client = {
  chat: {
    completions: {
      create: async (req: any) => {
        const res = await fetch(`${apiBase}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(req),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => "")
          throw new Error(`LLM call failed ${res.status}: ${body.slice(0, 200)}`)
        }
        return res.json()
      },
    },
  },
}

const narrator = createNarrator(client, {
  model,
  maxTokens: 60,
  timeoutMs: 10_000,
  minIntervalMs: 0,
})

const t0 = Date.now()
const output = await narrator.summarize(
  { type: "session.idle" },
  { assistantText, recentTools: tools },
)
const ms = Date.now() - t0

console.log(`[narrator] model=${model} latency=${ms}ms`)
console.log(`[narrator] output: ${output ?? "(null — fell back)"}`)

if (!output) {
  process.exit(0)
}

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
