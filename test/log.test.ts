import { describe, it, expect, vi } from "vitest"
import { createLogger, redact } from "../src/log.js"

describe("redact", () => {
  it("masks apiKey-like fields recursively", () => {
    const input = {
      provider: "openai",
      openai: { apiKey: "sk-secret-123", model: "tts-1" },
      elevenlabs: { apiKey: "el-456", voiceId: "abc" },
      narrator: { model: "haiku" },
    }
    expect(redact(input)).toEqual({
      provider: "openai",
      openai: { apiKey: "***", model: "tts-1" },
      elevenlabs: { apiKey: "***", voiceId: "abc" },
      narrator: { model: "haiku" },
    })
  })

  it("masks Authorization headers", () => {
    expect(redact({ headers: { Authorization: "Bearer xyz" } })).toEqual({
      headers: { Authorization: "***" },
    })
  })

  it("returns primitives unchanged", () => {
    expect(redact("hello")).toBe("hello")
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
  })
})

describe("createLogger", () => {
  it("forwards info to client.app.log with redacted extras", async () => {
    const log = vi.fn().mockResolvedValue(undefined)
    const client = { app: { log } } as any
    const logger = createLogger(client, "test-service")
    await logger.info("hello", { apiKey: "secret" })
    expect(log).toHaveBeenCalledWith({
      body: {
        service: "test-service",
        level: "info",
        message: "hello",
        extra: { apiKey: "***" },
      },
    })
  })

  it("never throws when client.app.log fails", async () => {
    const log = vi.fn().mockRejectedValue(new Error("network"))
    const client = { app: { log } } as any
    const logger = createLogger(client, "test-service")
    await expect(logger.warn("oops")).resolves.toBeUndefined()
  })
})
