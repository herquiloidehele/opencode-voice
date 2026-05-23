import { describe, it, expect, vi } from "vitest"
import OpencodeVoiceDefault, { OpencodeVoice } from "../src/index.js"

describe("opencode-voice plugin module shape", () => {
  it("default-exports a v1 plugin module ({ id, server })", () => {
    expect(OpencodeVoiceDefault).toMatchObject({
      id: "opencode-voice",
      server: expect.any(Function),
    })
    expect(OpencodeVoiceDefault.server).toBe(OpencodeVoice)
  })

  it("module does not export anything other than the plugin function and its default", async () => {
    // Critical for compatibility with opencode's legacy plugin scanner.
    // Any additional exported function would be invoked as a separate plugin.
    const mod = await import("../src/index.js")
    const exportedKeys = Object.keys(mod).filter((k) => k !== "default")
    expect(exportedKeys).toEqual(["OpencodeVoice"])
  })
})

describe("OpencodeVoice plugin", () => {
  it("returns an empty (no-op) hooks object when OPENCODE_VOICE_DISABLED=1", async () => {
    const ctx = {
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp",
      worktree: "/tmp",
      project: { config: { voice: {} } },
      $: vi.fn(),
    } as any
    const oldEnv = process.env.OPENCODE_VOICE_DISABLED
    process.env.OPENCODE_VOICE_DISABLED = "1"
    try {
      const hooks = await OpencodeVoice(ctx)
      expect(hooks).toEqual({})
    } finally {
      if (oldEnv === undefined) delete process.env.OPENCODE_VOICE_DISABLED
      else process.env.OPENCODE_VOICE_DISABLED = oldEnv
    }
  })

  it("registers an `event` hook that does not throw on unknown events", async () => {
    const ctx = {
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp",
      worktree: "/tmp",
      project: { config: { voice: { events: {} } } },
      $: vi.fn(),
    } as any
    const hooks = (await OpencodeVoice(ctx)) as any
    expect(typeof hooks.event).toBe("function")
    await expect(
      hooks.event({ event: { type: "some.unknown.event" } }),
    ).resolves.toBeUndefined()
  })

  it("registers a `voice` custom tool", async () => {
    const ctx = {
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp",
      worktree: "/tmp",
      project: { config: { voice: {} } },
      $: vi.fn(),
    } as any
    const hooks = (await OpencodeVoice(ctx)) as any
    expect(hooks.tool?.voice).toBeDefined()
  })
})
