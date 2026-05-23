import { randomUUID } from "node:crypto"
import { Priority, type SpeechRequest } from "../queue/types.js"
import { renderTemplate, stripMarkdown, truncate } from "./template.js"
import type { Narrator, NarrationContext } from "./narrator.js"

export interface EventConfig {
  enabled: boolean
  mode: "template" | "narrate" | "verbatim"
  priority?: "urgent" | "normal" | "chatty"
}

export interface HandlerRegistryOptions {
  events: Record<string, EventConfig>
  narrator: Narrator
  getContext: () => NarrationContext
}

export interface HandlerRegistry {
  handle(event: { type: string; [k: string]: unknown }): Promise<SpeechRequest | null>
}

const DEFAULT_PRIORITY: Record<string, Priority> = {
  "session.idle":         Priority.NORMAL,
  "session.error":        Priority.URGENT,
  "session.compacted":    Priority.NORMAL,
  "permission.asked":     Priority.URGENT,
  "todo.completed.all":   Priority.NORMAL,
  "todo.completed.item":  Priority.CHATTY,
  "tool.execute.before":  Priority.CHATTY,
  "tool.execute.after":   Priority.CHATTY,
  "message.updated":      Priority.CHATTY,
}

function priorityFromName(name?: string): Priority | null {
  if (name === "urgent") return Priority.URGENT
  if (name === "normal") return Priority.NORMAL
  if (name === "chatty") return Priority.CHATTY
  return null
}

export function createHandlerRegistry(opts: HandlerRegistryOptions): HandlerRegistry {
  return {
    async handle(event) {
      const cfg = opts.events[event.type]
      if (!cfg || !cfg.enabled) return null

      let text: string | null = null
      if (cfg.mode === "template") {
        text = renderTemplate(event)
      } else if (cfg.mode === "narrate") {
        text = await opts.narrator.summarize(event, opts.getContext())
        if (!text) text = renderTemplate(event)
      } else if (cfg.mode === "verbatim") {
        const raw = String(event.text ?? "")
        const stripped = stripMarkdown(raw)
        text = truncate(stripped, 300)
      }
      if (!text) return null

      const priority =
        priorityFromName(cfg.priority) ??
        DEFAULT_PRIORITY[event.type] ??
        Priority.NORMAL
      return {
        id: randomUUID(),
        priority,
        text,
        dedupKey: event.type,
        enqueuedAt: Date.now(),
      }
    },
  }
}
