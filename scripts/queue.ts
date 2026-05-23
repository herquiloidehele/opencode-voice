/**
 * Audibly demonstrate the speech queue's priority interrupt, dedup, and
 * stale-drop behavior. Uses the system TTS provider.
 *
 * Usage:
 *   npm run demo:queue
 *
 * What you should hear:
 *   1. "Speaking chatty one" starts.
 *   2. ~250ms later, an URGENT request interrupts it; you hear urgent.
 *   3. After urgent finishes, "chatty four" plays (chatty 2 and 3 deduped).
 *   4. Mute fires, dropping anything still pending.
 */

import { SpeechQueue } from "../src/queue/speech-queue.js"
import { Priority, type SpeechRequest } from "../src/queue/types.js"
import { createSystemProvider } from "../src/tts/system.js"
import { spawn } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { delimiter, sep } from "node:path"

const runner = {
  async has(b: string) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      try { await access(`${dir}${sep}${b}`, constants.X_OK); return true } catch {}
    }
    return false
  },
  run(cmd: string[], signal: AbortSignal) {
    return new Promise<{ exitCode: number }>((resolve, reject) => {
      const c = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" })
      const onAbort = () => c.kill("SIGTERM")
      signal.addEventListener("abort", onAbort)
      c.on("error", reject)
      c.on("exit", (code) => {
        signal.removeEventListener("abort", onAbort)
        if (signal.aborted) reject(new DOMException("aborted", "AbortError"))
        else resolve({ exitCode: code ?? 0 })
      })
    })
  },
}

const provider = createSystemProvider({ runner })
await provider.init({})

async function speak(req: SpeechRequest, signal: AbortSignal): Promise<void> {
  console.log(`[queue] >>> speaking ${req.id}: "${req.text}" (priority=${req.priority})`)
  try {
    await provider.synthesize(req.text, { rate: 1.2 }, signal)
    console.log(`[queue] <<< finished ${req.id}`)
  } catch (err: any) {
    if (err?.name === "AbortError") console.log(`[queue] xxx aborted ${req.id}`)
    else throw err
  }
}

const queue = new SpeechQueue({
  speak,
  staleMs: 8000,
  now: () => Date.now(),
  onError: (e) => console.log(`[queue] error:`, String(e)),
})

const r = (id: string, text: string, priority: Priority, dedupKey?: string): SpeechRequest => ({
  id, text, priority, dedupKey, enqueuedAt: Date.now(),
})

console.log("[queue] step 1: push chatty 1 (long)")
queue.push(r("chatty-1", "Speaking chatty one. This line should be interrupted soon.", Priority.CHATTY))

await new Promise((res) => setTimeout(res, 300))
console.log("[queue] step 2: push URGENT (should interrupt chatty 1)")
queue.push(r("urgent", "Urgent message. This should cut in immediately.", Priority.URGENT))

console.log("[queue] step 3: push 3 chatty-deduped requests (only last should play)")
queue.push(r("chatty-2", "Two", Priority.CHATTY, "tool.execute"))
queue.push(r("chatty-3", "Three", Priority.CHATTY, "tool.execute"))
queue.push(r("chatty-4", "Four. Only this fourth one should be heard, the other two should drop.", Priority.CHATTY, "tool.execute"))

await queue.idle()
console.log("[queue] done.")
