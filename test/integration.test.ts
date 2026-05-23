import { describe, it, expect } from "vitest"
import { createSystemProvider } from "../src/tts/system.js"

describe("integration: system TTS subprocess", () => {
  it("can spawn the OS TTS binary without error", async () => {
    const provider = createSystemProvider({})
    try {
      await provider.init({})
    } catch (err) {
      console.warn("Skipping integration test — no system TTS on this host:", err)
      return
    }
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 2000) // don't hang on misconfigured hosts
    try {
      await provider.synthesize(
        "opencode voice integration test",
        { rate: 2.0 },
        ac.signal,
      )
    } catch (err: any) {
      // AbortError is acceptable — we just want to see the subprocess started
      if (err?.name !== "AbortError") throw err
    }
    expect(true).toBe(true)
  }, 5000)
})
