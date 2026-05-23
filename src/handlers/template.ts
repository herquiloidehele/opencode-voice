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

const templates: Record<string, Renderer> = {
  "session.idle":         ()  => "Session idle.",
  "session.error":        (e) => `Session error: ${truncate(String(e.message ?? "unknown"), 80)}.`,
  "session.compacted":    ()  => "Session compacted.",
  "permission.asked":     (e) => `Permission requested for ${e.tool ?? "an operation"}.`,
  "todo.completed.all":   ()  => "All todos complete.",
  "todo.completed.item":  (e) => `Task complete: ${truncate(stripMarkdown(String(e.content ?? "")), 40)}.`,
  "tool.execute.before":  (e) => `Running ${e.tool ?? "tool"}.`,
  "tool.execute.after":   (e) => `${e.tool ?? "tool"} done.`,
  "message.updated":      (e) => truncate(stripMarkdown(String(e.text ?? "")), 300),
}

export function renderTemplate(event: AnyEvent): string | null {
  const fn = templates[event.type]
  if (!fn) return null
  const out = fn(event)
  return out.length === 0 ? null : out
}
