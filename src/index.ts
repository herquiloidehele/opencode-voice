import { parseConfig } from "./config.js"
import { createLogger } from "./log.js"
import { SpeechQueue } from "./queue/speech-queue.js"
import { type SpeechRequest } from "./queue/types.js"
import { registerProvider, getProvider } from "./tts/provider.js"
import { createSystemProvider } from "./tts/system.js"
import { createOpenAIProvider } from "./tts/openai.js"
import { createElevenLabsProvider } from "./tts/elevenlabs.js"
import { createPlayer, type Player } from "./audio/player.js"
import { createHandlerRegistry } from "./handlers"
import { createNarrator } from "./handlers/narrator.js"
import { createDispatcher } from "./dispatcher.js"
import { createCommands } from "./commands"

export { registerProvider } from "./tts/provider.js"
export type {
  TTSProvider,
  SynthesisOptions,
  SynthesisResult,
} from "./tts/provider.js"

type PluginCtx = {
  client: {
    app: { log: (...args: any[]) => Promise<unknown> }
    chat?: any
  }
  directory: string
  worktree?: string
  project: { config?: { voice?: unknown } }
  $: unknown
}

export const OpencodeVoice = async (ctx: PluginCtx) => {
  try {
    return await initPlugin(ctx)
  } catch (err) {
    // Last-line-of-defense: never let plugin failure crash opencode startup.
    try {
      const logger = createLogger(ctx.client as any, "opencode-voice")
      await logger.error("opencode-voice failed to initialize; plugin disabled", {
        error: String(err),
      })
    } catch {
      /* logger itself failed; nothing we can safely do */
    }
    return {}
  }
}

async function initPlugin(ctx: PluginCtx) {
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
      config.tts.provider === "openai"
        ? config.tts.openai
        : config.tts.provider === "elevenlabs"
          ? config.tts.elevenlabs
          : {}
    await provider.init(providerConfig)
  } catch (err) {
    await logger.error("Failed to initialize TTS provider; plugin self-disabling", {
      error: String(err),
    })
    return {}
  }

  // 3. Set up audio player (only used if provider returns real audio bytes).
  let player: Player | null = null
  if (provider.capabilities.streaming) {
    try {
      // Minimal default runner inline (same shape as Runner in src/tts/system.ts).
      const { spawn } = await import("node:child_process")
      const { access, constants } = await import("node:fs/promises")
      const { delimiter, sep } = await import("node:path")
      const runner = {
        async has(b: string) {
          const PATH = process.env.PATH ?? ""
          for (const d of PATH.split(delimiter)) {
            try {
              await access(`${d}${sep}${b}`, constants.X_OK)
              return true
            } catch {
              /* keep searching */
            }
          }
          return false
        },
        run(cmd: string[], signal: AbortSignal) {
          return new Promise<{ exitCode: number }>((resolve, reject) => {
            const c = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" })
            const onAbort = () => c.kill("SIGTERM")
            signal.addEventListener("abort", onAbort)
            c.on("error", (e) => {
              signal.removeEventListener("abort", onAbort)
              reject(e)
            })
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
      await logger.warn(
        "Audio player unavailable; cloud providers may not produce output",
        { error: String(err) },
      )
      player = null
    }
  }

  // 4. Build the speak function used by the queue.
  async function speak(req: SpeechRequest, signal: AbortSignal): Promise<void> {
    const result = await provider!.synthesize(
      req.text,
      {
        voice: config.tts.voice,
        rate: config.tts.rate,
        pitch: config.tts.pitch,
      },
      signal,
    )
    if (result.contentType === "audio/none") return // system providers self-play
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
    onError: (err, req) => {
      void logger.warn(`speak failed for "${req.text}"`, { error: String(err) })
    },
  })

  // 6. Narrator + handler registry.
  // If the SDK exposes a different LLM shape than client.chat.completions.create,
  // the narrator will fail gracefully and the handler registry will fall back to templates.
  const narratorClient = (ctx.client as any).chat
    ? (ctx.client as any)
    : {
        chat: {
          completions: {
            create: async () => {
              throw new Error("Narrator client not available in this context")
            },
          },
        },
      }
  const narrator = createNarrator(narratorClient, config.narrator)

  const dispatcher = createDispatcher({
    handler: createHandlerRegistry({
      events: config.events as any,
      narrator,
      getContext: () => dispatcher.getContext(),
    }),
    queue,
    onError: (err, e) => {
      void logger.warn(`handler error for ${e.type}`, { error: String(err) })
    },
  })

  // 7. Commands + custom tool.
  const commands = createCommands({
    queue,
    providerName: config.tts.provider,
    voiceName: config.tts.voice,
  })
  if (config.startMuted) commands.mute()

  await logger.info(`opencode-voice ready (provider=${config.tts.provider})`)

  return {
    event: async ({
      event,
    }: {
      event: { type: string; [k: string]: unknown }
    }) => {
      try {
        if (
          event.type === "message.part.updated" &&
          typeof (event as any).text === "string"
        ) {
          await dispatcher.onMessagePart((event as any).text)
        }
        if (
          event.type === "tool.execute.before" &&
          typeof (event as any).tool === "string"
        ) {
          await dispatcher.onToolStart((event as any).tool)
        }
        await dispatcher.onEvent(event)
      } catch (err) {
        await logger.warn(`event handler crashed for ${event.type}`, {
          error: String(err),
        })
      }
    },
    tool: {
      voice: {
        description:
          "Control the opencode-voice plugin: mute, unmute, say text, test, or report status.",
        args: {},
        async execute(args: {
          action: "mute" | "unmute" | "say" | "test" | "status"
          text?: string
        }) {
          if (args.action === "mute") {
            commands.mute()
            return "muted"
          }
          if (args.action === "unmute") {
            commands.unmute()
            return "unmuted"
          }
          if (args.action === "say") {
            commands.say(args.text ?? "")
            return "queued"
          }
          if (args.action === "test") {
            commands.test()
            return "test queued"
          }
          if (args.action === "status") return JSON.stringify(commands.status())
          return `unknown action: ${args.action}`
        },
      },
    },
  }
}

export default OpencodeVoice
