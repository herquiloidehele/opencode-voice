import { describe, it, expect } from "vitest"
import { createPlayer } from "../src/audio/player.js"

const fakeRunner = (hasBin: Record<string, boolean>, log: string[][]) => ({
  has: async (b: string) => hasBin[b] ?? false,
  run: async (cmd: string[]) => {
    log.push(cmd)
    return { exitCode: 0 }
  },
})

describe("audio player", () => {
  it("uses afplay on macOS", async () => {
    const cmds: string[][] = []
    const p = createPlayer({ platform: "darwin", runner: fakeRunner({ afplay: true }, cmds) })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("afplay")
  })

  it("prefers paplay over aplay over ffplay on linux", async () => {
    const cmds: string[][] = []
    const p = createPlayer({
      platform: "linux",
      runner: fakeRunner({ paplay: true, aplay: true, ffplay: true }, cmds),
    })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("paplay")
  })

  it("falls through to ffplay when paplay/aplay missing", async () => {
    const cmds: string[][] = []
    const p = createPlayer({
      platform: "linux",
      runner: fakeRunner({ ffplay: true }, cmds),
    })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("ffplay")
  })

  it("init throws when no player binary on the host", async () => {
    const p = createPlayer({ platform: "linux", runner: fakeRunner({}, []) })
    await expect(p.init()).rejects.toThrow(/no audio player/i)
  })

  it("uses powershell on windows", async () => {
    const cmds: string[][] = []
    const p = createPlayer({
      platform: "win32",
      runner: fakeRunner({ powershell: true }, cmds),
    })
    await p.init()
    await p.play(Buffer.from("fake"), "audio/mpeg", new AbortController().signal)
    expect(cmds[0][0]).toBe("powershell")
  })
})
