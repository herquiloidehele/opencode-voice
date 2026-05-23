import { describe, it, expect } from "vitest"
import { createSystemProvider } from "../src/tts/system.js"

function fakeRunner(opts: {
  hasBinary: Record<string, boolean>
  commands: string[][]
  failOnRun?: boolean
}) {
  return {
    has: async (bin: string) => opts.hasBinary[bin] ?? false,
    run: async (cmd: string[], _signal: AbortSignal) => {
      opts.commands.push(cmd)
      if (opts.failOnRun) throw new Error("run failed")
      return { exitCode: 0 }
    },
  }
}

describe("system TTS provider", () => {
  it("uses `say` on macOS", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({ hasBinary: { say: true }, commands: cmds })
    const p = createSystemProvider({ platform: "darwin", runner })
    await p.init({})
    const ac = new AbortController()
    await p.synthesize("hello world", { voice: "Samantha", rate: 1.0 }, ac.signal)
    expect(cmds[0][0]).toBe("say")
    expect(cmds[0]).toContain("-v")
    expect(cmds[0]).toContain("Samantha")
    expect(cmds[0]).toContain("hello world")
  })

  it("uses `spd-say` on Linux when available", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({
      hasBinary: { "spd-say": true, espeak: true },
      commands: cmds,
    })
    const p = createSystemProvider({ platform: "linux", runner })
    await p.init({})
    await p.synthesize("hi", {}, new AbortController().signal)
    expect(cmds[0][0]).toBe("spd-say")
  })

  it("falls back to `espeak` on Linux when spd-say missing", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({
      hasBinary: { "spd-say": false, espeak: true },
      commands: cmds,
    })
    const p = createSystemProvider({ platform: "linux", runner })
    await p.init({})
    await p.synthesize("hi", {}, new AbortController().signal)
    expect(cmds[0][0]).toBe("espeak")
  })

  it("uses powershell on Windows", async () => {
    const cmds: string[][] = []
    const runner = fakeRunner({ hasBinary: { powershell: true }, commands: cmds })
    const p = createSystemProvider({ platform: "win32", runner })
    await p.init({})
    await p.synthesize("hi", {}, new AbortController().signal)
    expect(cmds[0][0]).toBe("powershell")
    expect(cmds[0].join(" ")).toContain("SpeechSynthesizer")
  })

  it("init throws when no binary available", async () => {
    const runner = fakeRunner({ hasBinary: {}, commands: [] })
    const p = createSystemProvider({ platform: "linux", runner })
    await expect(p.init({})).rejects.toThrow(/no supported.*tts/i)
  })

  it("synthesize rejects on aborted signal", async () => {
    const runner = fakeRunner({ hasBinary: { say: true }, commands: [] })
    const p = createSystemProvider({ platform: "darwin", runner })
    await p.init({})
    const ac = new AbortController()
    ac.abort()
    await expect(p.synthesize("hi", {}, ac.signal)).rejects.toThrow()
  })
})
