import { describe, it, expect, vi } from "vitest"
import { createOpenAIProvider } from "../src/tts/openai.js"

describe("openai TTS provider", () => {
  it("posts to /v1/audio/speech with bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      body: new ReadableStream(),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const p = createOpenAIProvider({ fetch: fetchMock as unknown as typeof fetch })
    await p.init({ apiKey: "sk-test", model: "tts-1" })
    await p.synthesize("hello", { voice: "alloy" }, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("/v1/audio/speech")
    expect(init.headers.Authorization).toBe("Bearer sk-test")
    const body = JSON.parse(init.body)
    expect(body.input).toBe("hello")
    expect(body.voice).toBe("alloy")
    expect(body.model).toBe("tts-1")
  })

  it("init throws when apiKey missing", async () => {
    const p = createOpenAIProvider({ fetch: vi.fn() as unknown as typeof fetch })
    await expect(p.init({})).rejects.toThrow(/api key/i)
  })

  it("throws on non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" })
    const p = createOpenAIProvider({ fetch: fetchMock as unknown as typeof fetch })
    await p.init({ apiKey: "sk-test" })
    await expect(p.synthesize("hi", {}, new AbortController().signal)).rejects.toThrow(/401/)
  })

  it("forwards AbortSignal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      body: new ReadableStream(),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const p = createOpenAIProvider({ fetch: fetchMock as unknown as typeof fetch })
    await p.init({ apiKey: "sk-test" })
    const ac = new AbortController()
    await p.synthesize("hi", {}, ac.signal)
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal)
  })
})
