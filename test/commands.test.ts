import { describe, it, expect, vi } from "vitest"
import { createCommands } from "../src/commands/index.js"
import { Priority } from "../src/queue/types.js"

function fakeQueue() {
  const log: string[] = []
  return {
    log,
    push: vi.fn((r: any) => log.push(`push:${r.text}`)),
    mute: vi.fn(() => log.push("mute")),
    unmute: vi.fn(() => log.push("unmute")),
    size: vi.fn(() => 3),
  } as any
}

describe("commands", () => {
  it("mute calls queue.mute and updates state", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.mute()
    expect(q.mute).toHaveBeenCalled()
    expect(c.status().muted).toBe(true)
  })

  it("unmute calls queue.unmute and updates state", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.mute()
    c.unmute()
    expect(q.unmute).toHaveBeenCalled()
    expect(c.status().muted).toBe(false)
  })

  it("say pushes a NORMAL-priority request", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.say("hello there")
    const req = q.push.mock.calls[0][0]
    expect(req.text).toBe("hello there")
    expect(req.priority).toBe(Priority.NORMAL)
  })

  it("test pushes a canned message", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "system", voiceName: "X" })
    c.test()
    expect(q.push).toHaveBeenCalled()
  })

  it("status returns provider/voice/muted/queue size", () => {
    const q = fakeQueue()
    const c = createCommands({ queue: q, providerName: "openai", voiceName: "nova" })
    const s = c.status()
    expect(s.provider).toBe("openai")
    expect(s.voice).toBe("nova")
    expect(s.queueSize).toBe(3)
    expect(s.muted).toBe(false)
  })
})
