/**
 * Speak arbitrary text through a TTS provider, end-to-end.
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

import { createSystemProvider } from "../src/tts/system.js"
import { createAiSdkProvider } from "../src/tts/ai-sdk.js"
import { createPlayer } from "../src/audio/player.js"
import { resolveSpeechModel, ConfigError } from "../src/ai-sdk/models.js"
import type { Runner } from "../src/tts/system.js"
import { spawn } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { delimiter, sep } from "node:path"

const args = process.argv.slice(2)
const text = args.find((a) => !a.startsWith("--")) ?? "opencode voice say-demo, working as expected"
function flag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m?.slice(name.length + 3)
}
const modelSlug = flag("model") ?? "system/say"
const voice = flag("voice")
const rate = flag("rate") ? Number(flag("rate")) : 1.0

const runner: Runner = {
  async has(b: string) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      try {
        await access(`${dir}${sep}${b}`, constants.X_OK)
        return true
      } catch {}
    }
    return false
  },
  run(cmd, signal) {
    return new Promise<{ exitCode: number }>((resolve, reject) => {
      const c = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" })
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

let resolved
try {
  resolved = resolveSpeechModel(modelSlug)
} catch (err) {
  if (err instanceof ConfigError) console.error(err.message)
  else console.error(err)
  process.exit(1)
}

const provider =
  resolved.provider === "system"
    ? createSystemProvider({ runner })
    : createAiSdkProvider()

if (resolved.provider === "system") {
  await provider.init({})
} else {
  await provider.init({
    model: resolved.model,
    provider: resolved.provider,
    voice,
  })
}

console.log(`[say] model=${modelSlug} voice=${voice ?? "(default)"} rate=${rate}`)
console.log(`[say] text=${JSON.stringify(text)}`)

const ac = new AbortController()
const result = await provider.synthesize(text, { voice, rate }, ac.signal)

if (result.contentType === "audio/none") {
  console.log("[say] system provider self-played; done.")
  process.exit(0)
}

console.log(`[say] got ${result.contentType}; playing through audio player...`)
const player = createPlayer({ runner })
await player.init()
await player.play(result.audio, result.contentType, ac.signal)
console.log("[say] done.")
