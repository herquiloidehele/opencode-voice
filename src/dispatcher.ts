import type { SpeechRequest } from "./queue/types.js"
import type { HandlerRegistry } from "./handlers/index.js"
import type { NarrationContext } from "./handlers/narrator.js"

interface QueueIfc {
  push(req: SpeechRequest): void
}

export interface DispatcherOptions {
  handler: HandlerRegistry
  queue: QueueIfc
  onError?: (err: unknown, event: { type: string }) => void
  /** Max chars of recent assistant text to keep. */
  textWindow?: number
  /** Max recent tool calls to remember. */
  toolWindow?: number
}

interface TodoSnapshot {
  id: string
  content: string
  status: string
}

export interface Dispatcher {
  onEvent(event: { type: string; [k: string]: unknown }): Promise<void>
  onMessagePart(text: string): Promise<void>
  onToolStart(tool: string): Promise<void>
  getContext(): NarrationContext
}

export function createDispatcher(opts: DispatcherOptions): Dispatcher {
  const textWindow = opts.textWindow ?? 4000
  const toolWindow = opts.toolWindow ?? 10
  let assistantText = ""
  const recentTools: string[] = []
  const todoStatus = new Map<string, string>() // id -> last seen status

  function appendText(t: string) {
    assistantText = (assistantText + " " + t).slice(-textWindow)
  }

  async function fire(event: { type: string; [k: string]: unknown }): Promise<void> {
    try {
      const sr = await opts.handler.handle(event)
      if (sr) opts.queue.push(sr)
    } catch (err) {
      opts.onError?.(err, event)
    }
  }

  async function handleTodoUpdated(event: {
    type: string
    todos?: TodoSnapshot[]
  }): Promise<void> {
    const todos = event.todos ?? []
    let transitionsToCompleted = 0
    for (const t of todos) {
      const prev = todoStatus.get(t.id)
      if (prev !== "completed" && t.status === "completed") {
        transitionsToCompleted++
        await fire({ type: "todo.completed.item", content: t.content })
      }
      todoStatus.set(t.id, t.status)
    }
    if (
      todos.length > 0 &&
      todos.every((t) => t.status === "completed") &&
      transitionsToCompleted > 0
    ) {
      await fire({ type: "todo.completed.all", count: todos.length })
    }
    await fire({ type: "todo.updated", todos }) // also forward raw
  }

  return {
    async onEvent(event) {
      if (event.type === "todo.updated") {
        return handleTodoUpdated(event as { type: string; todos?: TodoSnapshot[] })
      }
      await fire(event)
    },
    async onMessagePart(text) {
      appendText(text)
    },
    async onToolStart(tool) {
      recentTools.push(tool)
      while (recentTools.length > toolWindow) recentTools.shift()
    },
    getContext() {
      return { assistantText, recentTools: [...recentTools] }
    },
  }
}
