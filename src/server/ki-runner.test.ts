import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabelle = new Map<string, any>();
vi.mock("@/integrations/supabase/client.server", () => {
  const q = () => {
    const f: any = { _hash: "" };
    f.select = () => f;
    f.eq = (k: string, v: string) => (k === "params_hash" && (f._hash = v), f);
    f.maybeSingle = async () => ({ data: tabelle.get(f._hash) ?? null });
    f.upsert = async (r: any) => (tabelle.set(r.params_hash, r), { data: null });
    f.delete = () => {
      const d: any = {
        eq: (k: string, v: string) => (k === "params_hash" && tabelle.delete(v), d),
      };
      d.then = (res: any) => res({ data: null });
      return d;
    };
    return f;
  };
  return { supabaseAdmin: { from: () => q() } };
});

import { KiLaeuftNoch, runnerAktiv, runnerText } from "./ki-runner.server";

describe("KI über Runner (Abo)", () => {
  let status = "laeuft";
  let starts = 0;
  beforeEach(() => {
    process.env.AGENT_RUNNER_SECRET = "test";
    tabelle.clear();
    starts = 0;
    status = "laeuft";
    vi.stubGlobal("fetch", async (url: string, init?: any) => {
      if (init?.method === "POST") {
        starts++;
        expect(JSON.parse(init.body).websearch).toBe(2);
        return Response.json({ ok: true, job_id: "a".repeat(32) });
      }
      return Response.json(
        status === "fertig" ? { ok: true, status, text: '{"x":1}' } : { ok: true, status },
      );
    });
  });
  afterEach(() => {
    delete process.env.AGENT_RUNNER_SECRET;
    vi.unstubAllGlobals();
  });

  it("läuft noch → KiLaeuftNoch, nächster Takt holt denselben Job ab", async () => {
    expect(runnerAktiv()).toBe(true);
    const o = { system: "s", prompt: "p", websuche: 2, timeoutMs: 0 };
    await expect(runnerText(o)).rejects.toBeInstanceOf(KiLaeuftNoch);
    status = "fertig";
    expect(await runnerText(o)).toBe('{"x":1}');
    expect(starts).toBe(1);
    expect(tabelle.size).toBe(0);
  });

  it("ohne Secret oder mit BLOG_KI=api bleibt es bei der API", () => {
    process.env.BLOG_KI = "api";
    expect(runnerAktiv()).toBe(false);
    delete process.env.BLOG_KI;
    delete process.env.AGENT_RUNNER_SECRET;
    expect(runnerAktiv()).toBe(false);
  });
});
