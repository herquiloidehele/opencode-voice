import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import { elevenlabs } from "@ai-sdk/elevenlabs"
import type { LanguageModel, SpeechModel } from "ai"

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

const SLUG_RE = /^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/

function parseSlug(slug: string, field: string): [string, string] {
  if (!SLUG_RE.test(slug)) {
    throw new ConfigError(
      `${field} must be 'provider/model' (e.g. 'openai/gpt-5'), got '${slug}'`,
    )
  }
  const idx = slug.indexOf("/")
  return [slug.slice(0, idx), slug.slice(idx + 1)]
}

export function resolveLanguageModel(slug: string): LanguageModel {
  const [provider, modelId] = parseSlug(slug, "narrator.model")
  switch (provider) {
    case "openai":
      return openai(modelId)
    case "anthropic":
      return anthropic(modelId)
    default:
      throw new ConfigError(
        `Unknown narrator provider '${provider}' in '${slug}'. Supported: openai, anthropic`,
      )
  }
}

export type ResolvedSpeech = { provider: "openai" | "elevenlabs"; model: SpeechModel }

export function resolveSpeechModel(slug: string): ResolvedSpeech {
  const [provider, modelId] = parseSlug(slug, "tts.model")
  switch (provider) {
    case "openai":
      return { provider: "openai", model: openai.speech(modelId) }
    case "elevenlabs":
      return { provider: "elevenlabs", model: elevenlabs.speech(modelId) }
    default:
      throw new ConfigError(
        `Unknown TTS provider '${provider}' in '${slug}'. Supported: openai, elevenlabs`,
      )
  }
}
