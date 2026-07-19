import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_MINUTES,
  isAuthorized,
  parseStaleMinutes,
  withConnected,
  type ClaudeSessionRow,
} from "./claude-sessions";

const TOKEN = "test-token-1234567890abcdef";

function row(overrides: Partial<ClaudeSessionRow>): ClaudeSessionRow {
  return {
    session_id: "sess-1",
    label: null,
    source: null,
    status: "active",
    started_at: "2026-07-19T10:00:00.000Z",
    last_seen_at: "2026-07-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("isAuthorized", () => {
  it("akzeptiert korrekten Bearer-Token (case-insensitives Schema)", () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("lehnt fehlenden/falschen Header ab", () => {
    expect(isAuthorized(null, TOKEN)).toBe(false);
    expect(isAuthorized("Bearer wrong", TOKEN)).toBe(false);
    expect(isAuthorized(TOKEN, TOKEN)).toBe(false); // ohne Bearer-Schema
  });

  it("ist deaktiviert ohne konfigurierten oder mit zu kurzem Token", () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(isAuthorized("Bearer abc", "abc")).toBe(false);
  });
});

describe("withConnected", () => {
  const now = Date.parse("2026-07-19T10:20:00.000Z");

  it("markiert frische Heartbeats als verbunden, alte nicht", () => {
    const views = withConnected(
      [
        row({ session_id: "fresh", last_seen_at: "2026-07-19T10:15:00.000Z" }),
        row({ session_id: "stale", last_seen_at: "2026-07-19T09:00:00.000Z" }),
      ],
      now,
    );
    expect(views.find((v) => v.session_id === "fresh")?.connected).toBe(true);
    expect(views.find((v) => v.session_id === "stale")?.connected).toBe(false);
  });

  it("beendete Sessions sind nie verbunden, auch mit frischem Heartbeat", () => {
    const views = withConnected(
      [row({ status: "ended", last_seen_at: "2026-07-19T10:19:00.000Z" })],
      now,
    );
    expect(views[0].connected).toBe(false);
  });

  it("sortiert verbundene zuerst, dann nach last_seen_at absteigend", () => {
    const views = withConnected(
      [
        row({ session_id: "old-offline", last_seen_at: "2026-07-19T08:00:00.000Z" }),
        row({ session_id: "connected", last_seen_at: "2026-07-19T10:18:00.000Z" }),
        row({ session_id: "newer-offline", last_seen_at: "2026-07-19T09:30:00.000Z" }),
      ],
      now,
    );
    expect(views.map((v) => v.session_id)).toEqual(["connected", "newer-offline", "old-offline"]);
  });

  it("berechnet minutes_since_seen und toleriert kaputte Timestamps", () => {
    const views = withConnected(
      [
        row({ session_id: "ok", last_seen_at: "2026-07-19T10:15:00.000Z" }),
        row({ session_id: "broken", last_seen_at: "not-a-date" }),
      ],
      now,
    );
    expect(views.find((v) => v.session_id === "ok")?.minutes_since_seen).toBe(5);
    const broken = views.find((v) => v.session_id === "broken");
    expect(broken?.minutes_since_seen).toBe(-1);
    expect(broken?.connected).toBe(false);
  });
});

describe("parseStaleMinutes", () => {
  it("liefert Default fuer fehlende/ungueltige Werte", () => {
    expect(parseStaleMinutes(null)).toBe(DEFAULT_STALE_MINUTES);
    expect(parseStaleMinutes("abc")).toBe(DEFAULT_STALE_MINUTES);
    expect(parseStaleMinutes("0")).toBe(DEFAULT_STALE_MINUTES);
    expect(parseStaleMinutes("999")).toBe(DEFAULT_STALE_MINUTES);
  });

  it("akzeptiert Werte im Bereich 1..120", () => {
    expect(parseStaleMinutes("5")).toBe(5);
    expect(parseStaleMinutes("120")).toBe(120);
  });
});
