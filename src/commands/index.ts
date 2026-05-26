import { randomUUID } from "node:crypto"
import { Priority, type SpeechRequest } from "../queue/types.js"

export interface CommandsOptions {
  queue: {
    push(req: SpeechRequest): void
    mute(): void
    unmute(): void
    stop(): void
    size(): number
  }
  providerName: string
  voiceName?: string
}

export interface VoiceStatus {
  provider: string
  voice?: string
  muted: boolean
  queueSize: number
}

export interface Commands {
  mute(): void
  unmute(): void
  toggle(): boolean
  stop(): void
  say(text: string): void
  test(): void
  status(): VoiceStatus
  isMuted(): boolean
}

export function createCommands(opts: CommandsOptions): Commands {
  let muted = false

  function makeRequest(text: string, priority: Priority): SpeechRequest {
    return { id: randomUUID(), priority, text, enqueuedAt: Date.now() }
  }

  return {
    mute() {
      muted = true
      opts.queue.mute()
    },
    unmute() {
      muted = false
      opts.queue.unmute()
    },
    /** Toggle mute state. Returns the new muted state. */
    toggle() {
      if (muted) {
        muted = false
        opts.queue.unmute()
      } else {
        muted = true
        opts.queue.mute()
      }
      return muted
    },
    /** Interrupt the current utterance (and drop the pending queue). */
    stop() {
      opts.queue.stop()
    },
    isMuted() {
      return muted
    },
    say(text: string) {
      opts.queue.push(makeRequest(text, Priority.NORMAL))
    },
    test() {
      opts.queue.push(
        makeRequest(
          "opencode voice test. If you hear this, audio is working.",
          Priority.NORMAL,
        ),
      )
    },
    status(): VoiceStatus {
      return {
        provider: opts.providerName,
        voice: opts.voiceName,
        muted,
        queueSize: opts.queue.size(),
      }
    },
  }
}
