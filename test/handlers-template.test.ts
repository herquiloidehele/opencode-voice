import { describe, it, expect } from "vitest"
import { renderTemplate, stripMarkdown, truncate } from "../src/handlers/template.js"

describe("renderTemplate", () => {
  it("formats session.error", () => {
    expect(renderTemplate({ type: "session.error", message: "Model overloaded" })).toBe(
      "Session error: Model overloaded.",
    )
  })

  it("truncates long error messages", () => {
    const longMsg = "x".repeat(200)
    const out = renderTemplate({ type: "session.error", message: longMsg })
    expect(out!.length).toBeLessThanOrEqual(110)
  })

  it("formats permission.asked", () => {
    expect(renderTemplate({ type: "permission.asked", tool: "write" })).toBe(
      "Permission requested for write.",
    )
  })

  it("formats session.compacted", () => {
    expect(renderTemplate({ type: "session.compacted" })).toBe("Session compacted.")
  })

  it("formats tool.execute.before / .after", () => {
    expect(renderTemplate({ type: "tool.execute.before", tool: "bash" })).toBe("Running bash.")
    expect(renderTemplate({ type: "tool.execute.after", tool: "bash" })).toBe("bash done.")
  })

  it("formats todo.completed.item with content", () => {
    expect(
      renderTemplate({ type: "todo.completed.item", content: "Add login route" }),
    ).toBe("Task complete: Add login route.")
  })

  it("returns null for unknown event types", () => {
    expect(renderTemplate({ type: "unknown.event" })).toBeNull()
  })

  it("formats message.updated with stripped markdown", () => {
    const out = renderTemplate({ type: "message.updated", text: "**Bold** and `code` text" })
    expect(out).toBe("Bold and code text")
  })

  it("formats session.idle with a fallback line", () => {
    expect(renderTemplate({ type: "session.idle" })).toBe("Session idle.")
  })
})

describe("stripMarkdown", () => {
  it("removes bold, italic, code, links", () => {
    expect(stripMarkdown("**hi**")).toBe("hi")
    expect(stripMarkdown("_x_")).toBe("x")
    expect(stripMarkdown("`code`")).toBe("code")
    expect(stripMarkdown("[label](http://x)")).toBe("label")
    expect(stripMarkdown("# Heading")).toBe("Heading")
  })
})

describe("truncate", () => {
  it("returns the string when shorter than limit", () => {
    expect(truncate("short", 10)).toBe("short")
  })
  it("truncates and appends ellipsis", () => {
    expect(truncate("a".repeat(20), 10)).toBe("aaaaaaaaaa…")
  })
})
