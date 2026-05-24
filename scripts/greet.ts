/**
 * Boot the opencode-voice-tts plugin against a mock opencode context and verify
 * that the startup greeting fires end-to-end.
 *
 * This calls `OpencodeVoice()` the same way opencode does (ctx + options),
 * so it exercises the real provider init, queue wiring, and `commands.say()`
 * code path that the greeting uses.
 *
 * Usage:
 *   npm run demo:greet
 *   npm run demo:greet -- --greeting="welcome back"
 *   npm run demo:greet -- --greeting=""                  # should stay silent
 *   npm run demo:greet -- --provider=openai --voice=nova # cloud provider
 *   OPENCODE_VOICE_MUTE=1 npm run demo:greet             # should stay silent
 *
 * Flags:
 *   --greeting=<text>   Override greeting text. Empty string disables it.
 *   --provider=<name>   system | openai | elevenlabs (default: system).
 *   --voice=<name>      Voice/voice-id for the provider.
 *   --wait=<ms>         How long to wait for the queue to drain (default 6000).
 *
 * Env vars:
 *   OPENAI_API_KEY          required for --provider=openai
 *   ELEVENLABS_API_KEY      required for --provider=elevenlabs
 *   OPENCODE_VOICE_MUTE=1   start muted (greeting should be skipped)
 *   OPENCODE_VOICE_DISABLED=1   skip plugin entirely
 */

import { OpencodeVoice } from "../src/index.js"

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m?.slice(name.length + 3)
}
function has(name: string): boolean {
  return args.includes(`--${name}`)
}

const greeting = flag("greeting")
const provider = flag("provider") ?? "system"
const voice = flag("voice")
const waitMs = flag("wait") ? Number(flag("wait")) : 6000

// Minimal mock of the opencode plugin context. Only `client.app.log` is
// strictly required by the plugin; `chat` is optional (the narrator falls
// back gracefully when absent).
const ctx = {
  client: {
    app: {
      log: async (...a: unknown[]) => {
        // Forward plugin log lines to stderr so they don't interfere with
        // anything piped from stdout, but stay visible during the demo.
        console.error("[log]", ...a)
      },
    },
  },
  directory: process.cwd(),
  worktree: process.cwd(),
  project: { id: "demo-greet" },
  $: () => undefined,
} as const

// Build options object. `greeting` is only set if the user explicitly passed
// --greeting=... so the default ("opencode voice ready") still applies
// otherwise.
const options: Record<string, unknown> = {
  tts: {
    provider,
    ...(voice ? { voice } : {}),
    ...(provider === "openai" ? { openai: { apiKey: process.env.OPENAI_API_KEY } } : {}),
    ...(provider === "elevenlabs"
      ? {
          elevenlabs: {
            apiKey: process.env.ELEVENLABS_API_KEY,
            ...(voice ? { voiceId: voice } : {}),
          },
        }
      : {}),
  },
}
if (greeting !== undefined) options.greeting = greeting

console.error(
  `[greet] booting plugin: provider=${provider}` +
    (voice ? ` voice=${voice}` : "") +
    (greeting !== undefined ? ` greeting=${JSON.stringify(greeting)}` : " greeting=(default)"),
)
if (process.env.OPENCODE_VOICE_MUTE === "1") {
  console.error("[greet] OPENCODE_VOICE_MUTE=1 set; greeting should be skipped")
}
if (process.env.OPENCODE_VOICE_DISABLED === "1") {
  console.error("[greet] OPENCODE_VOICE_DISABLED=1 set; plugin should no-op")
}

const hooks = (await OpencodeVoice(ctx as any, options)) as Record<string, unknown>

if (Object.keys(hooks).length === 0) {
  console.error("[greet] plugin returned no hooks (disabled or init failed). Exiting.")
  process.exit(0)
}

console.error(`[greet] plugin initialized; waiting ${waitMs}ms for queue to drain...`)

// The queue is asynchronous: commands.say() returns immediately while the
// provider synthesizes + plays in the background. There's no public idle()
// on the returned hooks, so we just wait long enough for any reasonable
// greeting to finish, then exit.
await new Promise<void>((r) => setTimeout(r, waitMs))

console.error("[greet] done.")
process.exit(0)
