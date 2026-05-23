import { describe, it, expect, vi } from "vitest"
import { createElevenLabsProvider } from "../src/tts/elevenlabs.js"

describe("elevenlabs TTS provider", () => {
  it("posts to /v1/text-to-speech/{voiceId} with xi-api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      body: new ReadableStream(),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const p = createElevenLabsProvider({ fetch: fetchMock as unknown as typeof fetch })
    await p.init({ apiKey: "el-test", voiceId: "voice-1" })
    await p.synthesize("hello", {}, new AbortController().signal)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/v1/text-to-speech/voice-1")
    expect(init.headers["xi-api-key"]).toBe("el-test")
    const body = JSON.parse(init.body)
    expect(body.text).toBe("hello")
  })

  it("init throws when apiKey missing", async () => {
    const p = createElevenLabsProvider({ fetch: vi.fn() as unknown as typeof fetch })
    await expect(p.init({ voiceId: "v" })).rejects.toThrow(/api key/i)
  })

  it("init throws when voiceId missing", async () => {
    const p = createElevenLabsProvider({ fetch: vi.fn() as unknown as typeof fetch })
    await expect(p.init({ apiKey: "k" })).rejects.toThrow(/voiceId/i)
  })

  it("throws on non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" })
    const p = createElevenLabsProvider({ fetch: fetchMock as unknown as typeof fetch })
    await p.init({ apiKey: "k", voiceId: "v" })
    await expect(p.synthesize("hi", {}, new AbortController().signal)).rejects.toThrow(/429/)
  })
})
