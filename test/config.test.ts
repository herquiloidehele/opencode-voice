import { describe, it, expect } from "vitest"
import { parseConfig, DEFAULT_CONFIG } from "../src/config.js"

describe("parseConfig", () => {
  it("returns defaults when given empty object", () => {
    const result = parseConfig({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.enabled).toBe(true)
      expect(result.config.tts.provider).toBe("system")
      expect(result.config.events["session.idle"].enabled).toBe(true)
      expect(result.config.events["session.idle"].mode).toBe("narrate")
    }
  })

  it("merges user-provided event overrides with defaults", () => {
    const result = parseConfig({
      events: { "tool.execute.before": { enabled: true } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.events["tool.execute.before"].enabled).toBe(true)
      // session.idle still uses default
      expect(result.config.events["session.idle"].enabled).toBe(true)
    }
  })

  it("rejects invalid provider name", () => {
    const result = parseConfig({ tts: { provider: 123 } })
    expect(result.ok).toBe(false)
  })

  it("rejects rate out of bounds", () => {
    const result = parseConfig({ tts: { rate: 10 } })
    expect(result.ok).toBe(false)
  })

  it("respects OPENCODE_VOICE_MUTE env override", () => {
    const result = parseConfig({}, { OPENCODE_VOICE_MUTE: "1" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.startMuted).toBe(true)
  })

  it("disables plugin when OPENCODE_VOICE_DISABLED is set", () => {
    const result = parseConfig({}, { OPENCODE_VOICE_DISABLED: "1" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.enabled).toBe(false)
  })

  it("falls back to env var for OpenAI api key when not in config", () => {
    const result = parseConfig(
      { tts: { provider: "openai" } },
      { OPENAI_API_KEY: "sk-env" }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.tts.openai?.apiKey).toBe("sk-env")
  })

  it("preserves unknown event keys for forward compat", () => {
    const result = parseConfig({
      events: { "future.event.type": { enabled: true, mode: "template" } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.events["future.event.type"]).toBeDefined()
    }
  })
})

describe("DEFAULT_CONFIG", () => {
  it("has all expected on-by-default events", () => {
    const enabled = Object.entries(DEFAULT_CONFIG.events)
      .filter(([, v]) => v.enabled)
      .map(([k]) => k)
      .sort()
    expect(enabled).toEqual([
      "permission.asked",
      "session.compacted",
      "session.error",
      "session.idle",
      "todo.completed.all",
    ])
  })
})
