import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  formatWaiting,
  isLongWait,
  isStale,
  LONG_WAIT_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
} from "./time";

const NOW = 1_700_000_000_000;

describe("formatElapsed", () => {
  it("returns '今' for 0 ms elapsed", () => {
    expect(formatElapsed(NOW, NOW)).toBe("今");
  });

  it("returns '今' for less than 1 minute elapsed", () => {
    expect(formatElapsed(NOW - 59_000, NOW)).toBe("今");
  });

  it("returns '1分前' for exactly 1 minute", () => {
    expect(formatElapsed(NOW - 60_000, NOW)).toBe("1分前");
  });

  it("returns '59分前' just before the hour boundary", () => {
    expect(formatElapsed(NOW - 59 * 60_000, NOW)).toBe("59分前");
  });

  it("returns '1時間前' at exactly 60 minutes", () => {
    expect(formatElapsed(NOW - 60 * 60_000, NOW)).toBe("1時間前");
  });

  it("returns '23時間前' just before the day boundary", () => {
    expect(formatElapsed(NOW - 23 * 60 * 60_000, NOW)).toBe("23時間前");
  });

  it("returns '1日前' at exactly 24 hours", () => {
    expect(formatElapsed(NOW - 24 * 60 * 60_000, NOW)).toBe("1日前");
  });

  it("returns '3日前' for 3 days elapsed", () => {
    expect(formatElapsed(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3日前");
  });
});

describe("formatWaiting", () => {
  it("returns '待ち中' for 0 ms elapsed", () => {
    expect(formatWaiting(NOW, NOW)).toBe("待ち中");
  });

  it("returns '待ち中' for less than 1 minute", () => {
    expect(formatWaiting(NOW - 30_000, NOW)).toBe("待ち中");
  });

  it("returns '1分待ち' at exactly 1 minute", () => {
    expect(formatWaiting(NOW - 60_000, NOW)).toBe("1分待ち");
  });

  it("returns '1時間待ち' at exactly 60 minutes", () => {
    expect(formatWaiting(NOW - 60 * 60_000, NOW)).toBe("1時間待ち");
  });

  it("returns '1日待ち' at exactly 24 hours", () => {
    expect(formatWaiting(NOW - 24 * 60 * 60_000, NOW)).toBe("1日待ち");
  });
});

describe("isLongWait threshold (30 min)", () => {
  it("is false at exactly the threshold boundary (not exceeded)", () => {
    expect(isLongWait(NOW - LONG_WAIT_THRESHOLD_MS, NOW)).toBe(false);
  });

  it("is true 1 ms past the threshold", () => {
    expect(isLongWait(NOW - LONG_WAIT_THRESHOLD_MS - 1, NOW)).toBe(true);
  });

  it("is false under threshold", () => {
    expect(isLongWait(NOW - 29 * 60_000, NOW)).toBe(false);
  });

  it("is true well over threshold", () => {
    expect(isLongWait(NOW - 2 * 60 * 60_000, NOW)).toBe(true);
  });
});

describe("isStale threshold (60 min)", () => {
  it("is false at exactly the threshold boundary (not exceeded)", () => {
    expect(isStale(NOW - STALE_THRESHOLD_MS, NOW)).toBe(false);
  });

  it("is true 1 ms past the threshold", () => {
    expect(isStale(NOW - STALE_THRESHOLD_MS - 1, NOW)).toBe(true);
  });

  it("is false under threshold", () => {
    expect(isStale(NOW - 59 * 60_000, NOW)).toBe(false);
  });

  it("is true well over threshold", () => {
    expect(isStale(NOW - 3 * 60 * 60_000, NOW)).toBe(true);
  });
});
