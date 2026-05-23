import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

export interface Runner {
  has(binary: string): Promise<boolean>
  run(cmd: string[], signal: AbortSignal): Promise<{ exitCode: number }>
}

export interface SystemProviderOptions {
  platform?: NodeJS.Platform
  runner?: Runner
}

/** Default runner: uses Node's child_process. */
async function defaultRunner(): Promise<Runner> {
  const { spawn } = await import("node:child_process")
  const { access, constants } = await import("node:fs/promises")
  const { delimiter, sep } = await import("node:path")

  async function has(binary: string): Promise<boolean> {
    const PATH = process.env.PATH ?? ""
    const exts =
      process.platform === "win32"
        ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
        : [""]
    for (const dir of PATH.split(delimiter)) {
      for (const ext of exts) {
        try {
          await access(`${dir}${sep}${binary}${ext}`, constants.X_OK)
          return true
        } catch {
          /* keep searching */
        }
      }
    }
    return false
  }

  async function run(cmd: string[], signal: AbortSignal): Promise<{ exitCode: number }> {
    if (signal.aborted) throw new DOMException("aborted", "AbortError")
    return await new Promise((resolve, reject) => {
      const child = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" })
      const onAbort = () => {
        child.kill("SIGTERM")
      }
      signal.addEventListener("abort", onAbort)
      child.on("error", (e) => {
        signal.removeEventListener("abort", onAbort)
        reject(e)
      })
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
        if (!(await r.has("say"))) {
          throw new Error("No supported system TTS binary found (expected `say`)")
        }
        command = (text, opts) => {
          const args = ["say"]
          if (opts.voice) args.push("-v", opts.voice)
          if (opts.rate && opts.rate !== 1.0) {
            args.push("-r", String(Math.round(180 * opts.rate)))
          }
          args.push(text)
          return args
        }
      } else if (platform === "linux") {
        if (await r.has("spd-say")) {
          command = (text, opts) => {
            const args = ["spd-say"]
            if (opts.rate && opts.rate !== 1.0) {
              args.push("-r", String(Math.round((opts.rate - 1.0) * 100)))
            }
            args.push(text)
            return args
          }
        } else if (await r.has("espeak")) {
          command = (text, opts) => {
            const args = ["espeak"]
            if (opts.voice) args.push("-v", opts.voice)
            if (opts.rate && opts.rate !== 1.0) {
              args.push("-s", String(Math.round(175 * opts.rate)))
            }
            args.push(text)
            return args
          }
        } else {
          throw new Error(
            "No supported system TTS binary found (expected `spd-say` or `espeak`)",
          )
        }
      } else if (platform === "win32") {
        if (!(await r.has("powershell"))) {
          throw new Error("No supported system TTS binary found (expected `powershell`)")
        }
        command = (text, opts) => {
          const escaped = text.replace(/'/g, "''")
          const rate = opts.rate ? Math.round((opts.rate - 1.0) * 10) : 0 // -10..10
          const script =
            `Add-Type -AssemblyName System.Speech; ` +
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

    async synthesize(
      text: string,
      opts: SynthesisOptions,
      signal: AbortSignal,
    ): Promise<SynthesisResult> {
      if (!command) throw new Error("System provider not initialized")
      if (signal.aborted) throw new DOMException("aborted", "AbortError")
      const r = await ensureRunner()
      const cmd = command(text, opts)
      const result = await r.run(cmd, signal)
      if (result.exitCode !== 0) throw new Error(`system TTS exited ${result.exitCode}`)
      // System provider self-plays; return an empty buffer so the queue layer doesn't try to play.
      return { audio: Buffer.alloc(0), contentType: "audio/none" }
    },

    validate(): { ok: true } | { ok: false; reason: string } {
      return { ok: true }
    },
  }
}
