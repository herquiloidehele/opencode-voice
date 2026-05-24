import { z } from "zod"

const PrioritySchema = z.enum(["urgent", "normal", "chatty"]).optional()
const ModeSchema = z.enum(["template", "narrate", "verbatim"])

const EventConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: ModeSchema.default("template"),
  priority: PrioritySchema,
})

const TTSSchema = z.object({
  provider: z.string().default("system"),
  voice: z.string().optional(),
  rate: z.number().min(0.5).max(2.0).default(1.0),
  pitch: z.number().min(0.5).max(2.0).default(1.0),
  openai: z.object({
    apiKey: z.string().optional(),
    model: z.string().default("gpt-4o-mini-tts"),
  }).optional(),
  elevenlabs: z.object({
    apiKey: z.string().optional(),
    voiceId: z.string().optional(),
  }).optional(),
}).default({})

const NarratorSchema = z.object({
  model: z.string().default("anthropic/claude-haiku-4"),
  maxTokens: z.number().int().positive().default(60),
  timeoutMs: z.number().int().positive().default(5000),
  minIntervalMs: z.number().int().min(0).default(3000),
}).default({})

const QueueSchema = z.object({
  staleMs: z.number().int().min(0).default(8000),
}).default({})

const EventsSchema = z.record(z.string(), EventConfigSchema).default({})

const VoiceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  startMuted: z.boolean().default(false),
  greeting: z.string().default("opencode voice ready"),
  tts: TTSSchema,
  narrator: NarratorSchema,
  events: EventsSchema,
  queue: QueueSchema,
})

export type VoiceConfig = z.infer<typeof VoiceConfigSchema>
export type EventConfig = z.infer<typeof EventConfigSchema>

const DEFAULT_EVENTS: Record<
  string,
  { enabled: boolean; mode: "template" | "narrate" | "verbatim"; priority?: "urgent" | "normal" | "chatty" }
> = {
  "session.idle":         { enabled: true,  mode: "narrate" },
  "session.error":        { enabled: true,  mode: "template", priority: "urgent" },
  "session.compacted":    { enabled: true,  mode: "template" },
  "permission.asked":     { enabled: true,  mode: "template", priority: "urgent" },
  "todo.completed.all":   { enabled: true,  mode: "narrate" },
  "todo.completed.item":  { enabled: true, mode: "template" },
  "tool.execute.before":  { enabled: true, mode: "template" },
  "tool.execute.after":   { enabled: true, mode: "template" },
  "message.updated":      { enabled: true, mode: "verbatim" },
}

export const DEFAULT_CONFIG: VoiceConfig = VoiceConfigSchema.parse({ events: DEFAULT_EVENTS })

export type ParseResult =
  | { ok: true; config: VoiceConfig }
  | { ok: false; errors: { path: string; message: string }[] }

export function parseConfig(
  raw: unknown,
  env: Record<string, string | undefined> = process.env,
): ParseResult {
  // Merge raw user input over defaults (event-level deep merge).
  const userObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const userEvents =
    userObj.events && typeof userObj.events === "object"
      ? (userObj.events as Record<string, unknown>)
      : {}
  const mergedEvents: Record<string, unknown> = { ...DEFAULT_EVENTS }
  for (const [key, val] of Object.entries(userEvents)) {
    mergedEvents[key] = { ...(DEFAULT_EVENTS[key] ?? {}), ...(val as object) }
  }

  const merged = { ...userObj, events: mergedEvents }
  const parsed = VoiceConfigSchema.safeParse(merged)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }
  }
  const cfg = parsed.data

  // Env overrides.
  if (env.OPENCODE_VOICE_DISABLED === "1") cfg.enabled = false
  if (env.OPENCODE_VOICE_MUTE === "1") cfg.startMuted = true

  // API key env fallbacks.
  if (cfg.tts.provider === "openai") {
    cfg.tts.openai = cfg.tts.openai ?? { model: "tts-1" }
    cfg.tts.openai.apiKey = cfg.tts.openai.apiKey ?? env.OPENAI_API_KEY
  }
  if (cfg.tts.provider === "elevenlabs") {
    cfg.tts.elevenlabs = cfg.tts.elevenlabs ?? {}
    cfg.tts.elevenlabs.apiKey = cfg.tts.elevenlabs.apiKey ?? env.ELEVENLABS_API_KEY
  }

  return { ok: true, config: cfg }
}
