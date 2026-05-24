import { truncate } from "./template.js"

export interface NarrationContext {
  assistantText: string
  recentTools: string[]
}

export interface NarratorClient {
  chat: {
    completions: {
      create: (req: {
        model: string
        temperature?: number
        messages: { role: "user" | "system"; content: string }[]
      }) => Promise<{ choices: { message: { content: string } }[] }>
    }
  }
}

export interface NarratorConfig {
  model: string
  timeoutMs: number
  minIntervalMs: number
}

export interface Narrator {
  summarize(
    event: { type: string; [k: string]: unknown },
    ctx: NarrationContext,
  ): Promise<string | null>
}

export function createNarrator(client: NarratorClient, config: NarratorConfig): Narrator {
  let lastFinishedAt = 0

  function buildPrompt(event: { type: string }, ctx: NarrationContext): string {
    const text = truncate(ctx.assistantText, 2000)
    const tools = ctx.recentTools.slice(-5).map((t) => `- ${t}`).join("\n") || "(none)"
    const occasion =
      event.type === "todo.completed.all"
        ? "all todos are now complete"
        : "just finished a turn"
    return [
      "You are a spoken status narrator for a coding agent. Your output is read aloud by a TTS engine.",
      `The agent ${occasion}. Explain what actually happened so the user can keep their eyes off the screen:`,
      "- what was attempted, what tools were used, what changed, and the outcome,",
      "- any blockers, errors, or decisions that need the user's attention,",
      "- next steps if obvious.",
      "",
      "Style rules:",
      "- spoken English only — no markdown, no code blocks, no quotes, no bullet points,",
      "- plain prose, natural sentences, no filler or restatement of these instructions,",
      "- be concise: every sentence must add information, but do not omit anything the user needs to know,",
      "- skip greetings, sign-offs, and meta commentary about being an AI.",
      "",
      "Recent assistant output:",
      text || "(none)",
      "",
      "Recent tool calls:",
      tools,
    ].join("\n")
  }

  return {
    async summarize(event, ctx) {
      const now = Date.now()
      if (now - lastFinishedAt < config.minIntervalMs) return null

      const prompt = buildPrompt(event, ctx)
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          client.chat.completions.create({
            model: config.model,
            temperature: 0.3,
            messages: [{ role: "user", content: prompt }],
          }),
          new Promise<null>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(null), config.timeoutMs)
          }),
        ])
        if (!result) return null
        lastFinishedAt = Date.now()
        const text = result.choices?.[0]?.message?.content?.trim() ?? ""
        return text.length > 0 ? text : null
      } catch {
        return null
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    },
  }
}
