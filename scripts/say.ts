/**
 * Speak arbitrary text through a TTS provider, end-to-end.
 *
 * Usage:
 *   npm run demo:say -- "hello world"
 *   npm run demo:say -- "hi from openai" --provider=openai --voice=nova
 *   npm run demo:say -- "elevenlabs test" --provider=elevenlabs --voice=EXAVITQu4vr4xnSDxMaL
 *
 * Env vars:
 *   OPENAI_API_KEY        required for --provider=openai
 *   ELEVENLABS_API_KEY    required for --provider=elevenlabs
 */

import { createSystemProvider } from "../src/tts/system.js"
import { createOpenAIProvider } from "../src/tts/openai.js"
import { createElevenLabsProvider } from "../src/tts/elevenlabs.js"
import { createPlayer } from "../src/audio/player.js"
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
const providerName = flag("provider") ?? "system"
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

const provider =
  providerName === "openai"
    ? createOpenAIProvider({})
    : providerName === "elevenlabs"
      ? createElevenLabsProvider({})
      : createSystemProvider({ runner })

const providerConfig =
  providerName === "openai"
    ? { apiKey: process.env.OPENAI_API_KEY }
    : providerName === "elevenlabs"
      ? { apiKey: process.env.ELEVENLABS_API_KEY, voiceId: voice ?? "EXAVITQu4vr4xnSDxMaL" }
      : {}

console.log(`[say] provider=${providerName} voice=${voice ?? "(default)"} rate=${rate}`)
console.log(`[say] text=${JSON.stringify(text)}`)

await provider.init(providerConfig as any)

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
