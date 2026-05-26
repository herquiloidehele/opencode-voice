/**
 * Test the LLM narrator handler in isolation. Sends a real request via the
 * Vercel AI SDK and prints + speaks the result (speech via OpenAI TTS).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npm run demo:narrator -- --assistant-text="I refactored the auth module" --tool=edit --tool=bash
 *   OPENAI_API_KEY=...    npm run demo:narrator -- --assistant-text="..." --model=openai/gpt-5
 *
 * Flags:
 *   --assistant-text=...      sample recent assistant output (required)
 *   --tool=...                one or more recent tool calls (repeatable)
 *   --model=provider/id       override narrator model (default: anthropic/claude-haiku-4)
 *   --tts-model=provider/id   override TTS model (default: openai/gpt-4o-mini-tts)
 *   --tts-voice=name          voice for the TTS provider
 *   --no-speak                only print, don't speak
 *
 * Env vars:
 *   ANTHROPIC_API_KEY     required if narrator model is anthropic/*
 *   OPENAI_API_KEY        required if narrator or TTS model is openai/*
 */

import { createNarrator } from "../src/handlers/narrator.js"
import { createAiSdkProvider } from "../src/tts/ai-sdk.js"
import { createPlayer } from "../src/audio/player.js"
import { defaultRunner } from "../src/audio/runner.js"
import {
  resolveLanguageModel,
  resolveSpeechModel,
  ConfigError,
} from "../src/ai-sdk/models.js"
import { DEFAULT_TTS_MODEL } from "../src/config.js"

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
const ttsModelSlug = flag("tts-model") ?? DEFAULT_TTS_MODEL
const ttsVoice = flag("tts-voice")
const noSpeak = args.includes("--no-speak")

let model
try {
  model = resolveLanguageModel(modelSlug)
} catch (err) {
  if (err instanceof ConfigError) console.error(err.message)
  else console.error(err)
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

console.log(`[narrator] speaking via ${ttsModelSlug}...`)
let ttsResolved
try {
  ttsResolved = resolveSpeechModel(ttsModelSlug)
} catch (err) {
  if (err instanceof ConfigError) console.error(err.message)
  else console.error(err)
  process.exit(1)
}

const provider = createAiSdkProvider()
await provider.init({
  model: ttsResolved.model,
  provider: ttsResolved.provider,
  voice: ttsVoice,
})

const runner = await defaultRunner()
const player = createPlayer({ runner })
await player.init()

const ac = new AbortController()
const result = await provider.synthesize(output, { voice: ttsVoice }, ac.signal)
await player.play(result.audio, result.contentType, ac.signal)
console.log("[narrator] done.")
