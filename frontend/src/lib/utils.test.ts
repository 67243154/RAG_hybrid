import { describe, expect, it } from "vitest"

import { formatMs } from "@/lib/utils"

describe("formatMs", () => {
  it("keeps missing durations as an em dash", () => {
    expect(formatMs(null)).toBe("—")
    expect(formatMs(undefined)).toBe("—")
  })

  it("keeps zero as 0ms", () => {
    expect(formatMs(0)).toBe("0ms")
  })

  it("preserves sub-millisecond precision", () => {
    expect(formatMs(0.012)).toBe("0.012ms")
    expect(formatMs(0.4)).toBe("0.400ms")
  })

  it("preserves the existing formatting for millisecond and second values", () => {
    expect(formatMs(1.6)).toBe("2ms")
    expect(formatMs(1250)).toBe("1.25s")
  })
})
