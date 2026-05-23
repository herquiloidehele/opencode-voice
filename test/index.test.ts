import { describe, it, expect, vi } from "vitest"
import { OpencodeVoice } from "../src/index.js"

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
