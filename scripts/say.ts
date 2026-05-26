/**
 * Speak arbitrary text through the AI SDK TTS provider, end-to-end.
 *
 * Usage:
 *   npm run demo:say -- "hello world"
 *   npm run demo:say -- "hi from openai" --model=openai/gpt-4o-mini-tts --voice=nova
 *   npm run demo:say -- "elevenlabs test" --model=elevenlabs/eleven_turbo_v2_5 --voice=EXAVITQu4vr4xnSDxMaL
 *
 * Env vars:
 *   OPENAI_API_KEY        required for openai/* models
 *   ELEVENLABS_API_KEY    required for elevenlabs/* models
 */

import { createAiSdkProvider } from "../src/tts/ai-sdk.js"
import { createPlayer } from "../src/audio/player.js"
import { defaultRunner } from "../src/audio/runner.js"
import { resolveSpeechModel, ConfigError } from "../src/ai-sdk/models.js"
import { DEFAULT_TTS_MODEL } from "../src/config.js"

const args = process.argv.slice(2)
const text = args.find((a) => !a.startsWith("--")) ?? "opencode speaker say-demo, working as expected"
function flag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m?.slice(name.length + 3)
}
const modelSlug = flag("model") ?? DEFAULT_TTS_MODEL
const voice = flag("voice")
const rate = flag("rate") ? Number(flag("rate")) : 1.0

let resolved
try {
  resolved = resolveSpeechModel(modelSlug)
} catch (err) {
  if (err instanceof ConfigError) console.error(err.message)
  else console.error(err)
  process.exit(1)
}

const provider = createAiSdkProvider()
await provider.init({
  model: resolved.model,
  provider: resolved.provider,
  voice,
})

console.log(`[say] model=${modelSlug} voice=${voice ?? "(default)"} rate=${rate}`)
console.log(`[say] text=${JSON.stringify(text)}`)

const ac = new AbortController()
const result = await provider.synthesize(text, { voice, rate }, ac.signal)

console.log(`[say] got ${result.contentType}; playing through audio player...`)
const runner = await defaultRunner()
const player = createPlayer({ runner })
await player.init()
await player.play(result.audio, result.contentType, ac.signal)
console.log("[say] done.")
