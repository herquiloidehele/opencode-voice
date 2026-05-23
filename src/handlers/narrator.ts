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
        max_tokens: number
        temperature?: number
        messages: { role: "user" | "system"; content: string }[]
      }) => Promise<{ choices: { message: { content: string } }[] }>
    }
  }
}

export interface NarratorConfig {
  model: string
  maxTokens: number
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
      "You are a brief spoken status narrator for a coding agent.",
      `The agent ${occasion}. Summarize what happened in ONE sentence, under 25 words, spoken style (no markdown, no code, no quotes).`,
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
            max_tokens: config.maxTokens,
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
