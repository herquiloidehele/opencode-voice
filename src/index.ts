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
import {
  resolveLanguageModel,
  resolveSpeechModel,
  ConfigError,
} from "./ai-sdk/models.js"
import { createDispatcher } from "./dispatcher.js"
import { createCommands } from "./commands/index.js"

// IMPORTANT: do not re-export anything that opencode's plugin loader might
// mistake for a server plugin. The loader uses the v1 default-export contract
// `{ id, server }` (see `default` below) — that path skips the legacy scan
// that would otherwise iterate every module export. Putting public API
// (registerProvider, types) here would put them in `Object.values(mod)` and
// could break older loaders. They live in `./api.ts` instead.

type PluginCtx = {
  client: {
    app: { log: (...args: any[]) => Promise<unknown> }
  }
  directory: string
  worktree?: string
  project?: unknown
  $: unknown
}

type PluginOptions = Record<string, unknown> | undefined

export const OpencodeSpeaker = async (ctx: PluginCtx, options?: PluginOptions) => {
  try {
    return await initPlugin(ctx, options)
  } catch (err) {
    // Last-line-of-defense: never let plugin failure crash opencode startup.
    try {
      const logger = createLogger(ctx.client as any, "opencode-speaker")
      await logger.error("opencode-speaker failed to initialize; plugin disabled", {
        error: String(err),
      })
    } catch {
      /* logger itself failed; nothing we can safely do */
    }
    return {}
  }
}

async function initPlugin(ctx: PluginCtx, options?: PluginOptions) {
  const logger = createLogger(ctx.client as any, "opencode-speaker")
  // opencode passes per-plugin config as the second argument when the user
  // declares the plugin in tuple form: ["opencode-speaker", { ...options }].
  // We accept any user object and let parseConfig validate + apply defaults.
  const rawConfig = options ?? {}
  const parsed = parseConfig(rawConfig)

  if (!parsed.ok) {
    await logger.error("Invalid voice config; plugin disabled", { errors: parsed.errors })
    return {}
  }
  const config = parsed.config

  if (!config.enabled) {
    await logger.info("opencode-speaker disabled by config or env")
    return {}
  }

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
    await logger.error(
      `TTS provider not found after registration: ${resolvedSpeech.provider}`,
    )
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
  const narrator = createNarrator(languageModel, config.narrator)

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
    providerName: resolvedSpeech.provider,
    voiceName: config.tts.voice,
  })
  if (config.startMuted) commands.mute()

  await logger.info(`opencode-speaker ready (provider=${resolvedSpeech.provider})`)

  if (config.greeting.trim().length > 0 && !config.startMuted) {
    commands.say(config.greeting)
  }

  return {
    event: async ({
      event,
    }: {
      event: { type: string; [k: string]: unknown }
    }) => {
      // The dispatcher is the single entry point: it knows how to unwrap
      // OpenCode's `{ id, type, properties }` shape, fan out synthesized
      // events (todo.completed.*, message.reasoning.delta, message.text.delta),
      // and keep narration context fresh.
      try {
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
          "Control the opencode-speaker plugin. Actions: mute (silence + drop queue), unmute, say (speak arbitrary text), test (canned line for verifying audio), status (report provider, voice, mute state, queue size).",
        args: {
          action: z.enum(["mute", "unmute", "say", "test", "status"]),
          text: z.string().optional(),
        },
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

/**
 * Default export is the plugin function itself, matching the current
 * `@opencode-ai/plugin` contract (see ExamplePlugin / FolderWorkspacePlugin).
 *
 * History: this used to be `{ id, server: OpencodeSpeaker }` to satisfy an
 * older "v1" loader shape. Newer opencode releases reject that as
 * "does not expose a server entrypoint" — the loader expects the default
 * export to be the async plugin function directly.
 *
 * `index.ts` deliberately has no other exports beyond `OpencodeSpeaker` and
 * this default, so the loader's named-export scan (if any) does not invoke
 * a second plugin instance. Public API lives in `./api.ts`.
 */
export default OpencodeSpeaker
