export interface AnyEvent {
  type: string
  [key: string]: unknown
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + "…"
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")          // fenced code
    .replace(/`([^`]+)`/g, "$1")             // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")       // bold
    .replace(/\*([^*]+)\*/g, "$1")           // italic
    .replace(/__([^_]+)__/g, "$1")           // bold
    .replace(/_([^_]+)_/g, "$1")             // italic
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")    // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
    .replace(/^#+\s+/gm, "")                 // headings
    .replace(/^\s*[-*+]\s+/gm, "")           // list bullets
    .replace(/\s+/g, " ")
    .trim()
}

type Renderer = (e: AnyEvent) => string

function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "")
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

const templates: Record<string, Renderer> = {
  // --- Real OpenCode events ---
  "session.idle":         ()  => "Session idle. Awaiting your next instruction.",
  "session.error":        (e) =>
    `Session error: ${truncate(String(e.message ?? "unknown"), 200)}. Check the log for details.`,
  "session.compacted":    ()  =>
    "Session compacted. Older context has been summarized to free up room.",
  "session.created":      (e) => {
    const title = e.title ?? e.name
    return title
      ? `New session started: ${truncate(stripMarkdown(String(title)), 80)}.`
      : "New session started. Ready when you are."
  },
  "permission.asked":     (e) =>
    `Permission requested for ${e.tool ?? "an operation"}. Waiting on your approval.`,
  "permission.replied":   (e) => {
    const raw = String(
      e.decision ?? e.response ?? e.reply ?? e.result ?? "responded",
    ).toLowerCase()
    const verb =
      raw === "allow" || raw === "approve" || raw === "accept" || raw === "yes"
        ? "granted"
        : raw === "deny" || raw === "reject" || raw === "no"
          ? "denied"
          : raw
    return `Permission ${verb} for ${e.tool ?? "the operation"}.`
  },
  "tool.execute.before":  (e) => `Running ${e.tool ?? "tool"}.`,
  "tool.execute.after":   (e) => `${e.tool ?? "tool"} finished.`,
  "file.edited":          (e) => {
    const raw = String(e.file ?? e.path ?? e.filePath ?? "")
    return raw ? `Edited ${basename(raw)}.` : "A file was edited."
  },
  "command.executed":     (e) => {
    const name = String(e.command ?? e.name ?? "").trim()
    return name ? `Command ${name} executed.` : "Command executed."
  },
  "message.updated":      (e) => truncate(stripMarkdown(String(e.text ?? "")), 600),

  // --- Synthesized by src/dispatcher.ts ---
  "message.text.delta":      (e) => truncate(stripMarkdown(String(e.text ?? "")), 600),
  "message.reasoning.delta": (e) => truncate(stripMarkdown(String(e.text ?? "")), 600),
  "todo.completed.all":   (e) => {
    const n = Number(e.count ?? 0)
    return n > 0
      ? `All ${n} todos complete. Nice work.`
      : "All todos complete. Nice work."
  },
  "todo.completed.item":  (e) =>
    `Task complete: ${truncate(stripMarkdown(String(e.content ?? "")), 80)}.`,
}

export function renderTemplate(event: AnyEvent): string | null {
  const fn = templates[event.type]
  if (!fn) return null
  const out = fn(event)
  return out.length === 0 ? null : out
}
