import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

type FetchLike = typeof fetch

export interface ElevenLabsProviderOptions {
  fetch?: FetchLike
  endpoint?: string
}

interface ElevenLabsConfig {
  apiKey?: string
  voiceId?: string
}

export function createElevenLabsProvider(
  opts: ElevenLabsProviderOptions = {},
): TTSProvider {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const base = opts.endpoint ?? "https://api.elevenlabs.io/v1/text-to-speech"
  let apiKey: string | null = null
  let voiceId: string | null = null

  return {
    name: "elevenlabs",
    capabilities: { streaming: true, offline: false },

    async init(config: unknown): Promise<void> {
      const cfg = (config ?? {}) as ElevenLabsConfig
      if (!cfg.apiKey) throw new Error("ElevenLabs provider requires an API key")
      if (!cfg.voiceId) throw new Error("ElevenLabs provider requires a voiceId")
      apiKey = cfg.apiKey
      voiceId = cfg.voiceId
    },

    async synthesize(
      text: string,
      _opts: SynthesisOptions,
      signal: AbortSignal,
    ): Promise<SynthesisResult> {
      if (!apiKey || !voiceId) throw new Error("ElevenLabs provider not initialized")
      const res = await fetchFn(`${base}/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: "eleven_monolingual_v1" }),
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(
          `ElevenLabs TTS request failed: ${res.status} ${body.slice(0, 200)}`,
        )
      }
      const contentType = res.headers.get("content-type") ?? "audio/mpeg"
      const audio = res.body ?? Buffer.from(await res.arrayBuffer())
      return { audio, contentType }
    },

    validate(config: unknown): { ok: true } | { ok: false; reason: string } {
      const cfg = (config ?? {}) as ElevenLabsConfig
      if (!cfg.apiKey) return { ok: false, reason: "Missing apiKey" }
      if (!cfg.voiceId) return { ok: false, reason: "Missing voiceId" }
      return { ok: true }
    },
  }
}
