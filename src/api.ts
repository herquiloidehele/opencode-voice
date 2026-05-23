/**
 * Public API for opencode-voice. Import from `opencode-voice/api` to register
 * custom TTS providers without interfering with the plugin's loader contract.
 *
 * @example
 *   import { registerProvider } from "opencode-voice/api"
 *   registerProvider({ name: "my-tts", ... })
 */
export { registerProvider } from "./tts/provider.js"
export type {
  TTSProvider,
  SynthesisOptions,
  SynthesisResult,
} from "./tts/provider.js"
