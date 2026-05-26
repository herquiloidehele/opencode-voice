/**
 * Audibly demonstrate the speech queue's priority interrupt, dedup, and
 * stale-drop behavior. Uses the AI SDK OpenAI TTS provider.
 *
 * Usage:
 *   OPENAI_API_KEY=... npm run demo:queue
 *
 * Env vars:
 *   OPENAI_API_KEY        required
 *
 * What you should hear:
 *   1. "Speaking chatty one" starts.
 *   2. ~250ms later, an URGENT request interrupts it; you hear urgent.
 *   3. After urgent finishes, "chatty four" plays (chatty 2 and 3 deduped).
 *   4. Mute fires, dropping anything still pending.
 */

import { SpeechQueue } from "../src/queue/speech-queue.js"
import { Priority, type SpeechRequest } from "../src/queue/types.js"
import { createAiSdkProvider } from "../src/tts/ai-sdk.js"
import { createPlayer } from "../src/audio/player.js"
import { defaultRunner } from "../src/audio/runner.js"
import { resolveSpeechModel } from "../src/ai-sdk/models.js"

const resolved = resolveSpeechModel("openai/gpt-4o-mini-tts")
const provider = createAiSdkProvider()
await provider.init({ model: resolved.model, provider: resolved.provider })

const runner = await defaultRunner()
const player = createPlayer({ runner })
await player.init()

async function speak(req: SpeechRequest, signal: AbortSignal): Promise<void> {
  console.log(`[queue] >>> speaking ${req.id}: "${req.text}" (priority=${req.priority})`)
  try {
    const result = await provider.synthesize(req.text, { rate: 1.2 }, signal)
    await player.play(result.audio, result.contentType, signal)
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
