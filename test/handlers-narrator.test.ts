import { describe, it, expect, vi } from "vitest"
import { createNarrator } from "../src/handlers/narrator.js"

const baseConfig = { model: "test/narrator", maxTokens: 60, timeoutMs: 1000, minIntervalMs: 0 }

function ctx(text: string) {
  return { assistantText: text, recentTools: [] as string[] }
}

describe("narrator", () => {
  it("calls model with crafted prompt and returns summary", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ choices: [{ message: { content: "Done refactoring." } }] })
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("did stuff"))
    expect(out).toBe("Done refactoring.")
    expect(create).toHaveBeenCalledOnce()
    const args = create.mock.calls[0][0]
    expect(args.model).toBe("test/narrator")
    expect(args.max_tokens).toBe(60)
    expect(args.messages[0].content).toContain("did stuff")
  })

  it("returns null when timeout elapses", async () => {
    const create = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, { ...baseConfig, timeoutMs: 20 })
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("returns null when api errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("500"))
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, baseConfig)
    const out = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(out).toBeNull()
  })

  it("throttles within minIntervalMs returning null", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] })
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, { ...baseConfig, minIntervalMs: 100_000 })
    const first = await n.summarize({ type: "session.idle" }, ctx("x"))
    const second = await n.summarize({ type: "session.idle" }, ctx("x"))
    expect(first).toBe("ok")
    expect(second).toBeNull()
    expect(create).toHaveBeenCalledOnce()
  })

  it("truncates very long assistant text in the prompt", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] })
    const client = { chat: { completions: { create } } } as any
    const n = createNarrator(client, baseConfig)
    const long = "x".repeat(10_000)
    await n.summarize({ type: "session.idle" }, ctx(long))
    const prompt = create.mock.calls[0][0].messages[0].content
    expect(prompt.length).toBeLessThan(3000)
  })
})
