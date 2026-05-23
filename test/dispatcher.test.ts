import { describe, it, expect, vi } from "vitest"
import { createDispatcher } from "../src/dispatcher.js"

describe("dispatcher", () => {
  it("forwards plain events to the handler", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({ type: "session.idle" })
    expect(handle).toHaveBeenCalledWith({ type: "session.idle" })
  })

  it("pushes returned SpeechRequest to the queue", async () => {
    const req = { id: "x", priority: 2, text: "hi", enqueuedAt: 0 }
    const handle = vi.fn().mockResolvedValue(req)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({ type: "session.error" })
    expect(push).toHaveBeenCalledWith(req)
  })

  it("derives todo.completed.item from todo.updated transitions", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({
      type: "todo.updated",
      todos: [{ id: "1", content: "A", status: "pending" }],
    })
    await d.onEvent({
      type: "todo.updated",
      todos: [{ id: "1", content: "A", status: "completed" }],
    })
    const types = handle.mock.calls.map(([e]) => e.type)
    expect(types).toContain("todo.completed.item")
    const itemEvent = handle.mock.calls.find(([e]) => e.type === "todo.completed.item")?.[0]
    expect(itemEvent.content).toBe("A")
  })

  it("derives todo.completed.all when every todo is completed", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onEvent({
      type: "todo.updated",
      todos: [
        { id: "1", content: "A", status: "pending" },
        { id: "2", content: "B", status: "pending" },
      ],
    })
    await d.onEvent({
      type: "todo.updated",
      todos: [
        { id: "1", content: "A", status: "completed" },
        { id: "2", content: "B", status: "completed" },
      ],
    })
    const types = handle.mock.calls.map(([e]) => e.type)
    expect(types).toContain("todo.completed.all")
  })

  it("does not re-fire todo.completed.all when no new transitions happened", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    const todos = [{ id: "1", content: "A", status: "completed" }]
    await d.onEvent({ type: "todo.updated", todos })
    handle.mockClear()
    await d.onEvent({ type: "todo.updated", todos })
    expect(handle.mock.calls.find(([e]) => e.type === "todo.completed.all")).toBeUndefined()
  })

  it("accumulates assistant text for getContext()", async () => {
    const handle = vi.fn().mockResolvedValue(null)
    const push = vi.fn()
    const d = createDispatcher({ handler: { handle }, queue: { push } } as any)
    await d.onMessagePart("assistant says hello")
    await d.onToolStart("bash")
    expect(d.getContext().assistantText).toContain("assistant says hello")
    expect(d.getContext().recentTools).toContain("bash")
  })

  it("never throws when handler throws", async () => {
    const handle = vi.fn().mockRejectedValue(new Error("boom"))
    const push = vi.fn()
    const d = createDispatcher({
      handler: { handle },
      queue: { push },
      onError: () => {},
    } as any)
    await expect(d.onEvent({ type: "session.idle" })).resolves.toBeUndefined()
  })
})
