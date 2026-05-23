export interface SynthesisOptions {
  voice?: string
  rate?: number
  pitch?: number
  format?: "wav" | "mp3" | "raw"
}

export interface SynthesisResult {
  audio: ReadableStream<Uint8Array> | Buffer
  contentType: string
}

export interface TTSProvider {
  readonly name: string
  readonly capabilities: { streaming: boolean; offline: boolean }
  init(config: unknown): Promise<void>
  synthesize(
    text: string,
    opts: SynthesisOptions,
    signal: AbortSignal,
  ): Promise<SynthesisResult>
  validate?(config: unknown): { ok: true } | { ok: false; reason: string }
}

const registry = new Map<string, TTSProvider>()

export function registerProvider(p: TTSProvider): void {
  registry.set(p.name, p)
}

export function getProvider(name: string): TTSProvider | undefined {
  return registry.get(name)
}

export function listProviders(): TTSProvider[] {
  return Array.from(registry.values())
}

/** For tests only. */
export function _resetRegistry(): void {
  registry.clear()
}
