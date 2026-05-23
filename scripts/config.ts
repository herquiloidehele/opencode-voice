/**
 * Validate a voice-options JSON object against the plugin's config schema
 * and print the resolved (defaults-applied) result. Useful for verifying
 * what your opencode.json plugin-tuple options will actually do.
 *
 * Usage:
 *   npm run demo:config -- '{"tts":{"provider":"system"}}'
 *   npm run demo:config -- --file=path/to/options.json
 *   npm run demo:config -- --defaults    # show the defaults
 */

import { parseConfig, DEFAULT_CONFIG } from "../src/config.js"
import { readFile } from "node:fs/promises"

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const m = args.find((a) => a.startsWith(`--${name}=`))
  return m?.slice(name.length + 3)
}

if (args.includes("--defaults")) {
  console.log("[config] DEFAULT_CONFIG:")
  console.log(JSON.stringify(DEFAULT_CONFIG, null, 2))
  process.exit(0)
}

let raw: unknown
const file = flag("file")
if (file) {
  raw = JSON.parse(await readFile(file, "utf8"))
} else {
  const jsonArg = args.find((a) => !a.startsWith("--"))
  if (!jsonArg) {
    console.error("Usage: npm run demo:config -- <json> | --file=path | --defaults")
    process.exit(1)
  }
  raw = JSON.parse(jsonArg)
}

const result = parseConfig(raw)
if (!result.ok) {
  console.log("[config] INVALID:")
  for (const err of result.errors) {
    console.log(`  - ${err.path || "(root)"}: ${err.message}`)
  }
  process.exit(2)
}

console.log("[config] valid; resolved config:")
console.log(JSON.stringify(result.config, null, 2))
