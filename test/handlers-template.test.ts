import { describe, it, expect } from "vitest"
import { renderTemplate, stripMarkdown, truncate } from "../src/handlers/template.js"

describe("renderTemplate", () => {
  it("formats session.error", () => {
    expect(renderTemplate({ type: "session.error", message: "Model overloaded" })).toBe(
      "Session error: Model overloaded. Check the log for details.",
    )
  })

  it("truncates long error messages", () => {
    const longMsg = "x".repeat(500)
    const out = renderTemplate({ type: "session.error", message: longMsg })
    // 200 char cap on message + fixed prefix/suffix (~50 chars).
    expect(out!.length).toBeLessThanOrEqual(260)
    expect(out).toMatch(/^Session error: x+…\. Check the log for details\.$/)
  })

  it("formats permission.asked", () => {
    expect(renderTemplate({ type: "permission.asked", tool: "write" })).toBe(
      "Permission requested for write. Waiting on your approval.",
    )
  })

  it("formats permission.replied with normalized decisions", () => {
    expect(
      renderTemplate({ type: "permission.replied", tool: "write", decision: "allow" }),
    ).toBe("Permission granted for write.")
    expect(
      renderTemplate({ type: "permission.replied", tool: "bash", decision: "deny" }),
    ).toBe("Permission denied for bash.")
  })

  it("formats session.compacted", () => {
    expect(renderTemplate({ type: "session.compacted" })).toBe(
      "Session compacted. Older context has been summarized to free up room.",
    )
  })

  it("formats session.created", () => {
    expect(renderTemplate({ type: "session.created" })).toBe(
      "New session started, working on it.",
    )
    expect(renderTemplate({ type: "session.created", title: "Refactor auth" })).toBe(
      "New session started, working on it.",
    )
  })

  it("formats tool.execute.before / .after", () => {
    expect(renderTemplate({ type: "tool.execute.before", tool: "bash" })).toBe("Running bash.")
    expect(renderTemplate({ type: "tool.execute.after", tool: "bash" })).toBe("bash finished.")
  })

  it("formats file.edited using just the basename", () => {
    expect(
      renderTemplate({ type: "file.edited", file: "/repo/src/index.ts" }),
    ).toBe("Edited index.ts.")
    expect(renderTemplate({ type: "file.edited" })).toBe("A file was edited.")
  })

  it("formats command.executed", () => {
    expect(renderTemplate({ type: "command.executed", command: "/init" })).toBe(
      "Command /init executed.",
    )
    expect(renderTemplate({ type: "command.executed" })).toBe("Command executed.")
  })

  it("formats todo.completed.item with content", () => {
    expect(
      renderTemplate({ type: "todo.completed.item", content: "Add login route" }),
    ).toBe("Task complete: Add login route.")
  })

  it("formats todo.completed.all with optional count", () => {
    expect(renderTemplate({ type: "todo.completed.all" })).toBe(
      "All todos complete. Nice work.",
    )
    expect(renderTemplate({ type: "todo.completed.all", count: 3 })).toBe(
      "All 3 todos complete. Nice work.",
    )
  })

  it("returns null for unknown event types", () => {
    expect(renderTemplate({ type: "unknown.event" })).toBeNull()
  })

  it("formats message.updated with stripped markdown", () => {
    expect(
      renderTemplate({ type: "message.updated", text: "**Bold** and `code` text" }),
    ).toBe("Bold and code text")
  })

  it("has no template for the raw message.part.updated event", () => {
    expect(renderTemplate({ type: "message.part.updated" })).toBeNull()
  })

  it("formats session.idle with a chatty fallback line", () => {
    expect(renderTemplate({ type: "session.idle" })).toBe(
      "Session idle. Awaiting your next instruction.",
    )
  })

  it("renders synthesized streaming deltas verbatim (after markdown strip)", () => {
    expect(
      renderTemplate({
        type: "message.reasoning.delta",
        text: "Let me **think** about this.",
      }),
    ).toBe("Let me think about this.")
    expect(
      renderTemplate({
        type: "message.text.delta",
        text: "Here is the *answer*",
      }),
    ).toBe("Here is the answer")
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
