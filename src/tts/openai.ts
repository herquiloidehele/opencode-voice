import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

type FetchLike = typeof fetch

export interface OpenAIProviderOptions {
  fetch?: FetchLike
  endpoint?: string
}

interface OpenAIConfig {
  apiKey?: string
  model?: string
}

export function createOpenAIProvider(opts: OpenAIProviderOptions = {}): TTSProvider {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const endpoint = opts.endpoint ?? "https://api.openai.com/v1/audio/speech"
  let apiKey: string | null = null
  let model = "tts-1"

  return {
    name: "openai",
    capabilities: { streaming: true, offline: false },

    async init(config: unknown): Promise<void> {
      const cfg = (config ?? {}) as OpenAIConfig
      if (!cfg.apiKey) {
        throw new Error(
          "OpenAI provider requires an API key (config.apiKey or OPENAI_API_KEY env)",
        )
      }
      apiKey = cfg.apiKey
      if (cfg.model) model = cfg.model
    },

    async synthesize(
      text: string,
      opts: SynthesisOptions,
      signal: AbortSignal,
    ): Promise<SynthesisResult> {
      if (!apiKey) throw new Error("OpenAI provider not initialized")
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: text,
          model,
          voice: opts.voice ?? "alloy",
          response_format: "mp3",
          speed: opts.rate ?? 1.0,
        }),
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`OpenAI TTS request failed: ${res.status} ${body.slice(0, 200)}`)
      }
      const contentType = res.headers.get("content-type") ?? "audio/mpeg"
      const audio = res.body ?? Buffer.from(await res.arrayBuffer())
      return { audio, contentType }
    },

    validate(config: unknown): { ok: true } | { ok: false; reason: string } {
      const cfg = (config ?? {}) as OpenAIConfig
      if (!cfg.apiKey) return { ok: false, reason: "Missing apiKey" }
      return { ok: true }
    },
  }
}
