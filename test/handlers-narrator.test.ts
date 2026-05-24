import { describe, it, expect, vi } from "vitest"
import { MockLanguageModelV2 } from "ai/test"
import { createNarrator } from "../src/handlers/narrator.js"

const baseConfig = { timeoutMs: 1000, minIntervalMs: 0 }

function ctx(text: string) {
  return { assistantText: text, recentTools: [] as string[] }
}

function mockResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: "stop" as const,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  }
}

function mockModel(text: string, opts: { onCall?: (input: any) => void } = {}) {
  const doGenerate = vi.fn(async (input: any) => {
    opts.onCall?.(input)
    return mockResult(text)
  })
  return { model: new MockLanguageModelV2({ doGenerate }), doGenerate }
}

describe("narrator", () => {
  it("calls model with crafted prompt and returns summary", async () => {
    let capturedPrompt = ""
    const { model, doGenerate } = mockModel("Done refactoring.", {
      onCall: (input) => {
        capturedPrompt = JSON.stringify(input)
      },
    })
    const n = createNarrator(model, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("did stuff"))
    expect(out).toBe("Done refactoring.")
    expect(doGenerate).toHaveBeenCalledOnce()
    expect(capturedPrompt).toContain("did stuff")
  })

  it("returns null when timeout elapses", async () => {
    const doGenerate = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 500)
        abortSignal?.addEventListener("abort", () => {
          clearTimeout(t)
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      })
      // If we ever get here the signal wasn't honoured — fail loudly.
      throw new Error("should have aborted")
    })
    const model = new MockLanguageModelV2({ doGenerate })
    const n = createNarrator(model, { ...baseConfig, timeoutMs: 20 })
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("returns null when model errors", async () => {
    const doGenerate = vi.fn(async () => {
      throw new Error("500")
    })
    const model = new MockLanguageModelV2({ doGenerate })
    const n = createNarrator(model, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("returns null when response text is empty", async () => {
    const { model } = mockModel("")
    const n = createNarrator(model, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("throttles within minIntervalMs returning null", async () => {
    const { model, doGenerate } = mockModel("ok")
    const n = createNarrator(model, { ...baseConfig, minIntervalMs: 100_000 })
    const first = await n.summarize({ type: "session.idle" }, ctx("x"))
    const second = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(first).toBe("ok")
    expect(second).toBeNull()
    expect(doGenerate).toHaveBeenCalledOnce()
  })

  it("truncates very long assistant text in the prompt", async () => {
    let capturedPrompt = ""
    const { model } = mockModel("ok", {
      onCall: (input) => {
        capturedPrompt = JSON.stringify(input)
      },
    })
    const n = createNarrator(model, baseConfig)
    const long = "x".repeat(10_000)
    await n.summarize({ type: "session.idle" }, ctx(long))
    expect(capturedPrompt.length).toBeLessThan(5000)
  })

  it("does not advance throttle on error", async () => {
    let calls = 0
    const doGenerate = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error("transient")
      return mockResult("second")
    })
    const model = new MockLanguageModelV2({ doGenerate })
    const n = createNarrator(model, { ...baseConfig, minIntervalMs: 100_000 })
    const first = await n.summarize({ type: "session.idle" }, ctx("x"))
    const second = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(first).toBeNull()
    expect(second).toBe("second")
  })
})
