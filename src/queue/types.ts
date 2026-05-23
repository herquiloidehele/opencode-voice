export enum Priority {
  URGENT = 3,   // permission.asked, session.error
  NORMAL = 2,   // session.idle, todo.completed.all, session.compacted, /say
  CHATTY = 1,   // tool.execute.*, todo.completed.item, message.updated
}

export interface SpeechRequest {
  /** Unique id for tracing. */
  id: string
  priority: Priority
  /** The text to speak. */
  text: string
  /** Optional key; same-keyed requests in the queue collapse to the newest. Typically the event type. */
  dedupKey?: string
  /** ms epoch when the request entered the queue. Used for stale drop. */
  enqueuedAt: number
}
