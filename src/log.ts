const SENSITIVE_KEYS = new Set([
  "apiKey", "api_key", "apikey",
  "authorization", "Authorization",
  "secret", "token", "password",
])

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redact)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(k) ? "***" : redact(v)
  }
  return out
}

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface Logger {
  debug(msg: string, extra?: unknown): Promise<void>
  info(msg: string, extra?: unknown): Promise<void>
  warn(msg: string, extra?: unknown): Promise<void>
  error(msg: string, extra?: unknown): Promise<void>
}

interface OpencodeClient {
  app: {
    log: (req: {
      body: { service: string; level: LogLevel; message: string; extra?: unknown }
    }) => Promise<unknown>
  }
}

export function createLogger(client: OpencodeClient, service: string): Logger {
  async function emit(level: LogLevel, message: string, extra?: unknown): Promise<void> {
    try {
      await client.app.log({
        body: {
          service,
          level,
          message,
          ...(extra !== undefined ? { extra: redact(extra) } : {}),
        },
      })
    } catch {
      // Swallow — logger must never throw.
    }
  }
  return {
    debug: (m, e) => emit("debug", m, e),
    info:  (m, e) => emit("info",  m, e),
    warn:  (m, e) => emit("warn",  m, e),
    error: (m, e) => emit("error", m, e),
  }
}
