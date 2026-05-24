import { describe, it, expect, vi } from "vitest"
import OpencodeVoiceDefault, { OpencodeVoice } from "../src/index.js"

describe("opencode-voice-tts plugin module shape", () => {
  it("default-exports the plugin function itself (current opencode contract)", () => {
    // opencode's current plugin loader expects `default` to be the async
    // plugin function — not a `{ id, server }` wrapper. The older wrapper
    // shape causes a "does not expose a server entrypoint" warning and the
    // plugin is silently skipped at runtime.
    expect(typeof OpencodeVoiceDefault).toBe("function")
    expect(OpencodeVoiceDefault).toBe(OpencodeVoice)
  })

  it("module does not export anything other than the plugin function and its default", async () => {
    // Critical for compatibility with opencode's plugin scanner. Any
    // additional exported function could be invoked as a separate plugin.
    const mod = await import("../src/index.js")
    const exportedKeys = Object.keys(mod).filter((k) => k !== "default")
    expect(exportedKeys).toEqual(["OpencodeVoice"])
  })
})

describe("OpencodeVoice plugin", () => {
  const baseCtx = () =>
    ({
      client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
      directory: "/tmp",
      worktree: "/tmp",
      project: { id: "test" },
      $: vi.fn(),
    }) as any

  it("returns an empty (no-op) hooks object when OPENCODE_VOICE_DISABLED=1", async () => {
    const oldEnv = process.env.OPENCODE_VOICE_DISABLED
    process.env.OPENCODE_VOICE_DISABLED = "1"
    try {
      const hooks = await OpencodeVoice(baseCtx(), {})
      expect(hooks).toEqual({})
    } finally {
      if (oldEnv === undefined) delete process.env.OPENCODE_VOICE_DISABLED
      else process.env.OPENCODE_VOICE_DISABLED = oldEnv
    }
  })

  it("registers an `event` hook that does not throw on unknown events", async () => {
    const hooks = (await OpencodeVoice(baseCtx(), { events: {} })) as any
    expect(typeof hooks.event).toBe("function")
    await expect(
      hooks.event({ event: { type: "some.unknown.event" } }),
    ).resolves.toBeUndefined()
  })

  it("registers a `voice` custom tool", async () => {
    const hooks = (await OpencodeVoice(baseCtx(), {})) as any
    expect(hooks.tool?.voice).toBeDefined()
  })

  it("accepts options as the second argument (opencode's plugin contract)", async () => {
    const hooks = (await OpencodeVoice(baseCtx(), {
      tts: { model: "system/say" },
    })) as any
    // Initialization should succeed (returns hooks object, not {}).
    expect(typeof hooks.event).toBe("function")
  })

  it("falls back to defaults when options is undefined", async () => {
    const hooks = (await OpencodeVoice(baseCtx(), undefined)) as any
    expect(typeof hooks.event).toBe("function")
  })
})
