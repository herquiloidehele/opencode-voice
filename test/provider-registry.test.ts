import { describe, it, expect, beforeEach } from "vitest"
import {
  registerProvider,
  getProvider,
  listProviders,
  _resetRegistry,
  type TTSProvider,
} from "../src/tts/provider.js"

const stub: TTSProvider = {
  name: "stub",
  capabilities: { streaming: false, offline: true },
  async init() {},
  async synthesize() {
    return { audio: Buffer.from([]), contentType: "audio/wav" }
  },
}

describe("provider registry", () => {
  beforeEach(() => _resetRegistry())

  it("registers and retrieves a provider by name", () => {
    registerProvider(stub)
    expect(getProvider("stub")).toBe(stub)
  })

  it("lists all registered providers", () => {
    registerProvider(stub)
    registerProvider({ ...stub, name: "stub2" })
    expect(
      listProviders()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["stub", "stub2"])
  })

  it("returns undefined for unknown provider", () => {
    expect(getProvider("nope")).toBeUndefined()
  })

  it("overwrites on duplicate registration (last wins)", () => {
    const a = { ...stub, name: "dup", capabilities: { streaming: true, offline: false } }
    const b = { ...stub, name: "dup", capabilities: { streaming: false, offline: true } }
    registerProvider(a)
    registerProvider(b)
    expect(getProvider("dup")?.capabilities.offline).toBe(true)
  })
})
