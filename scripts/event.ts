/**
 * Simulate an opencode event flowing through the plugin's full pipeline:
 *   event -> dispatcher -> handler registry -> queue -> AI SDK TTS.
 *
 * Usage:
 *   npm run demo:event -- session.idle
 *   npm run demo:event -- session.error --message="boom"
 *   npm run demo:event -- permission.asked --tool=write
 *   npm run demo:event -- todo.completed.all
 *   npm run demo:event -- tool.execute.before --tool=bash --enable=tool.execute.before
 *
 * Pass --enable=<event-type> repeatedly to turn on events that are off by default.
 */

import OpencodeSpeakerDefault from "../src/index.js"

const args = process.argv.slice(2)
const eventType = args.find((a) => !a.startsWith("--"))
if (!eventType) {
  console.error("Usage: npm run demo:event -- <event.type> [--field=value ...]")
  process.exit(1)
}

function getFlag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m?.slice(name.length + 3)
}
function getMultiFlag(name: string): string[] {
  return args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
}

// Build the event payload from --field=value flags (excluding --enable).
const eventPayload: Record<string, unknown> = { type: eventType }
for (const arg of args) {
  if (!arg.startsWith("--") || !arg.includes("=")) continue
  const eq = arg.indexOf("=")
  const key = arg.slice(2, eq)
  const value = arg.slice(eq + 1)
  if (key === "enable") continue
  eventPayload[key] = value
}

// Build options. Turn on any --enable=event.type events on top of defaults.
const enableOverrides: Record<string, { enabled: boolean; mode: "template" | "narrate" | "verbatim" }> = {}
for (const ev of getMultiFlag("enable")) {
  enableOverrides[ev] = { enabled: true, mode: "template" }
}
const options = {
  events: enableOverrides,
  // For demos, force template mode for session.idle so we don't need an LLM
  // (override --enable if the user supplied something else).
  ...(Object.keys(enableOverrides).length === 0
    ? { events: { "session.idle": { enabled: true, mode: "template" } } }
    : {}),
}

// Minimal opencode-style ctx with a console-backed logger.
const ctx = {
  client: {
    app: {
      log: async ({ body }: any) => {
        console.log(`[plugin:${body.level}] ${body.message}${body.extra ? " " + JSON.stringify(body.extra) : ""}`)
      },
    },
  },
  directory: process.cwd(),
  worktree: process.cwd(),
  project: { id: "demo" },
  $: () => {},
}

const hooks: any = await OpencodeSpeakerDefault.server(ctx as any, options)
if (!hooks.event) {
  console.error("Plugin returned no event hook (was it disabled?).")
  process.exit(1)
}

console.log(`[event] firing ${JSON.stringify(eventPayload)}`)
await hooks.event({ event: eventPayload as any })

// Give the queue a moment to drain the speech.
await new Promise((res) => setTimeout(res, 4000))
console.log("[event] done.")
