import { describe, it, expect } from "vitest"
import {
  resolveLanguageModel,
  resolveSpeechModel,
  ConfigError,
} from "../src/ai-sdk/models.js"
import { DEFAULT_TTS_MODEL } from "../src/config.js"

describe("resolveLanguageModel", () => {
  it("returns a model for openai/<model>", () => {
    const model = resolveLanguageModel("openai/gpt-5")
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it("returns a model for anthropic/<model>", () => {
    const model = resolveLanguageModel("anthropic/claude-haiku-4")
    expect(model).toBeDefined()
    expect(model).not.toBeNull()
  })

  it("throws ConfigError for unknown provider prefix", () => {
    expect(() => resolveLanguageModel("unknown/foo")).toThrow(ConfigError)
    expect(() => resolveLanguageModel("unknown/foo")).toThrow(/openai.*anthropic/)
  })

  it("throws ConfigError for malformed slug", () => {
    expect(() => resolveLanguageModel("notaslug")).toThrow(ConfigError)
    expect(() => resolveLanguageModel("notaslug")).toThrow(/provider\/model/)
  })

  it("throws ConfigError for empty model id", () => {
    expect(() => resolveLanguageModel("openai/")).toThrow(ConfigError)
  })
})

describe("resolveSpeechModel", () => {
  it("returns openai speech model with provider tag", () => {
    const r = resolveSpeechModel(DEFAULT_TTS_MODEL)
    expect(r.provider).toBe("openai")
    expect(r.model).toBeDefined()
    expect(r.model).not.toBeNull()
  })

  it("returns elevenlabs speech model with provider tag", () => {
    const r = resolveSpeechModel("elevenlabs/eleven_turbo_v2_5")
    expect(r.provider).toBe("elevenlabs")
    expect(r.model).toBeDefined()
    expect(r.model).not.toBeNull()
  })

  it("throws ConfigError for unknown TTS prefix", () => {
    expect(() => resolveSpeechModel("unknown/foo")).toThrow(ConfigError)
    expect(() => resolveSpeechModel("unknown/foo")).toThrow(/openai.*elevenlabs/)
  })

  it("throws ConfigError for malformed slug", () => {
    expect(() => resolveSpeechModel("notaslug")).toThrow(ConfigError)
  })
})
