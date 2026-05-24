import { experimental_generateSpeech as generateSpeech, type SpeechModel } from "ai"
import type { TTSProvider, SynthesisOptions, SynthesisResult } from "./provider.js"

interface AiSdkInitConfig {
  model: SpeechModel
  provider: "openai" | "elevenlabs"
  voice?: string
}

export function createAiSdkProvider(): TTSProvider {
  let model: SpeechModel | null = null
  let providerName: "openai" | "elevenlabs" | null = null
  let defaultVoice: string | undefined

  const provider: TTSProvider = {
    get name() {
      return providerName ?? "ai-sdk"
    },
    capabilities: { streaming: true, offline: false },

    async init(config: unknown): Promise<void> {
      const c = (config ?? {}) as AiSdkInitConfig
      if (!c.model) throw new Error("ai-sdk TTS provider requires a model")
      if (c.provider !== "openai" && c.provider !== "elevenlabs") {
        throw new Error(
          `ai-sdk TTS provider supports openai or elevenlabs, got '${c.provider}'`,
        )
      }
      model = c.model
      providerName = c.provider
      defaultVoice = c.voice
    },

    async synthesize(
      text: string,
      opts: SynthesisOptions,
      signal: AbortSignal,
    ): Promise<SynthesisResult> {
      if (!model || !providerName) {
        throw new Error("ai-sdk TTS provider not initialized")
      }
      const voice =
        opts.voice ??
        defaultVoice ??
        (providerName === "openai" ? "alloy" : undefined)

      const result = await generateSpeech({
        model,
        text,
        voice,
        outputFormat: "mp3",
        speed: opts.rate,
        abortSignal: signal,
      })
      return {
        audio: Buffer.from(result.audio.uint8Array),
        contentType: result.audio.mediaType ?? "audio/mpeg",
      }
    },
  }
  return provider
}
