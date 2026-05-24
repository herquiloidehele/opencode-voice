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
