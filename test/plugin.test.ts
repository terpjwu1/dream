import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideTrigger } from "../src/commands/trigger.js";
import { hookPayloadProject } from "../src/commands/trigger.js";
import { statuslineProject } from "../src/commands/statusline.js";
import { writeBadge, clearBadge, readBadge, displayBadge } from "../src/badge.js";
import { badgeFile } from "../src/paths.js";
import { rmSync } from "node:fs";

const ROOT = join(import.meta.dirname, "..");

describe("decideTrigger (ambient)", () => {
  const base = {
    initialized: true,
    enabled: true,
    minSessions: 3,
    undreamed: 5,
    pendingBranches: 0,
    lockHeld: false,
  };

  it("never fires for uninitialized projects (the cost opt-in)", () => {
    expect(decideTrigger({ ...base, initialized: false })).toEqual({ action: "none" });
  });
  it("respects trigger.enabled = false", () => {
    expect(decideTrigger({ ...base, enabled: false })).toEqual({ action: "none" });
  });
  it("reminds instead of running when proposals are pending", () => {
    const d = decideTrigger({ ...base, pendingBranches: 2 });
    expect(d.action).toBe("remind");
    expect((d as { message: string }).message).toContain("/dream:review");
  });
  it("stays silent while another run holds the lock", () => {
    expect(decideTrigger({ ...base, lockHeld: true })).toEqual({ action: "none" });
  });
  it("stays silent below the session threshold", () => {
    expect(decideTrigger({ ...base, undreamed: 2 })).toEqual({ action: "none" });
  });
  it("runs at or above the threshold", () => {
    expect(decideTrigger({ ...base, undreamed: 3 }).action).toBe("run");
  });
});

describe("decideTrigger (--now, the /dream command)", () => {
  const base = {
    initialized: true,
    enabled: false, // ambient off — /dream must still work
    minSessions: 3,
    undreamed: 1,
    pendingBranches: 0,
    lockHeld: false,
  };
  const now = { now: true };

  it("runs with any backlog even when ambient is disabled", () => {
    expect(decideTrigger(base, now).action).toBe("run");
  });
  it("hints at setup for uninitialized projects instead of staying silent", () => {
    const d = decideTrigger({ ...base, initialized: false }, now);
    expect(d.action).toBe("info");
    expect((d as { message: string }).message).toContain("/dream:setup");
  });
  it("pending reviews take precedence over a held lock (same order as ambient)", () => {
    const d = decideTrigger({ ...base, pendingBranches: 2, lockHeld: true }, now);
    expect(d.action).toBe("remind");
    expect((d as { message: string }).message).toContain("/dream:review");
  });
  it("reports an in-progress run", () => {
    const d = decideTrigger({ ...base, lockHeld: true }, now);
    expect(d.action).toBe("info");
    expect((d as { message: string }).message).toContain("already in progress");
  });
  it("reports an empty backlog", () => {
    const d = decideTrigger({ ...base, undreamed: 0 }, now);
    expect(d.action).toBe("info");
    expect((d as { message: string }).message).toContain("nothing to dream about");
  });
});

describe("payload parsing", () => {
  it("extracts cwd from a SessionStart hook payload", () => {
    expect(hookPayloadProject('{"session_id":"x","cwd":"/Users/a/proj"}')).toBe("/Users/a/proj");
  });
  it("extracts current_dir from a statusline payload", () => {
    expect(statuslineProject('{"workspace":{"current_dir":"/Users/a/proj"}}')).toBe("/Users/a/proj");
  });
  it("returns undefined on garbage without throwing", () => {
    expect(hookPayloadProject("not json")).toBeUndefined();
    expect(statuslineProject("")).toBeUndefined();
  });
  it("rejects non-string and empty project fields (type-trust guard)", () => {
    expect(hookPayloadProject('{"cwd":123}')).toBeUndefined();
    expect(hookPayloadProject('{"cwd":"  "}')).toBeUndefined();
    expect(hookPayloadProject('{"cwd":null,"workspace":{"current_dir":["x"]}}')).toBeUndefined();
    expect(statuslineProject('{"workspace":{"current_dir":42}}')).toBeUndefined();
  });
});

describe("badge lifecycle", () => {
  const proj = "/tmp/dream-badge-test-proj";
  it("writes, reads, and clears the single-line badge", () => {
    writeBadge(proj, "🌙 2 proposal(s) · /dream:review");
    expect(readBadge(proj)).toBe("🌙 2 proposal(s) · /dream:review");
    clearBadge(proj);
    expect(readBadge(proj)).toBeUndefined();
    clearBadge(proj); // idempotent
    rmSync(badgeFile(proj), { force: true });
  });

  it("expires stranded 💤 badges but keeps terminal 🌙/⚠ ones", () => {
    const later = Date.now() + 31 * 60 * 1000;
    writeBadge(proj, "💤 dreaming — analyzing 2 batch(es)…");
    expect(displayBadge(proj)).toContain("💤");           // fresh: shown
    expect(displayBadge(proj, later)).toBeUndefined();     // stale: hidden
    writeBadge(proj, "🌙 1 proposal(s) · /dream:review");
    expect(displayBadge(proj, later)).toContain("🌙");     // terminal: persists
    clearBadge(proj);
  });
});

describe("trigger config safety defaults", () => {
  it("ambient dreaming is opt-in: trigger.enabled and trigger.global default to false", async () => {
    const { ConfigSchema } = await import("../src/config.js");
    const config = ConfigSchema.parse({});
    expect(config.trigger.enabled).toBe(false);
    expect(config.trigger.global).toBe(false);
    expect(config.trigger.excludeProjects).toEqual([]);
    expect(config.trigger.minSessions).toBe(3);
  });
});

describe("resolveConsent", () => {
  it("honors the profile-wide opt-in and its exclusions (one definition for trigger AND status)", async () => {
    const { resolveConsent } = await import("../src/config.js");
    const { ConfigSchema } = await import("../src/config.js");
    const off = ConfigSchema.parse({});
    const on = ConfigSchema.parse({ trigger: { global: true } });
    const carved = ConfigSchema.parse({
      trigger: { global: true, excludeProjects: ["/scratch/", "clients/acme"] },
    });
    expect(resolveConsent("/Users/x/proj", off)).toEqual({
      dreamable: false,
      ambient: false,
      source: "none",
    });
    expect(resolveConsent("/Users/x/proj", on)).toEqual({
      dreamable: true,
      ambient: true, // global consent IS ambient consent
      source: "global",
    });
    expect(resolveConsent("/Users/x/scratch/tmp", carved).dreamable).toBe(false);
    expect(resolveConsent("/Users/x/clients/acme/app", carved).dreamable).toBe(false);
    expect(resolveConsent("/Users/x/proj", carved).dreamable).toBe(true);
  });
});

describe("manifest drift protection", () => {
  it("both manifests and the marketplace agree on identity fields", () => {
    const standard = JSON.parse(readFileSync(join(ROOT, "plugin/plugin.json"), "utf8"));
    const claude = JSON.parse(
      readFileSync(join(ROOT, "plugin/.claude-plugin/plugin.json"), "utf8"),
    );
    const market = JSON.parse(
      readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    );
    for (const field of ["name", "version", "description", "license", "repository"]) {
      expect(claude[field], `field ${field}`).toEqual(standard[field]);
    }
    expect(market.plugins[0].version).toBe(standard.version);
    expect(market.plugins[0].name).toBe(standard.name);
  });

});

describe("trigger.mjs execution (fast path behavior)", () => {
  function runHook(payload: object, shimDir: string, dreamHome: string): string {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync("node", [join(ROOT, "plugin/hooks/trigger.mjs")], {
      input: JSON.stringify(payload),
      // DREAM_HOME isolates the test from the real ~/.dream (a machine with
      // `dream init --global` would otherwise make every project dreamable).
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}`, DREAM_HOME: dreamHome },
      encoding: "utf8",
    });
  }

  it("skips the CLI for uninitialized projects, invokes it for opted-in and global ones", () => {
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const tmp = mkdtempSync(join(tmpdir(), "dream-hook-"));
    // fake `dream` CLI that announces itself if invoked
    writeFileSync(join(tmp, "dream"), "#!/bin/sh\necho SHIM-CALLED\n");
    chmodSync(join(tmp, "dream"), 0o755);
    // hermetic dream homes: one with nothing, one with the global opt-in
    const homeOff = join(tmp, "home-off");
    mkdirSync(homeOff, { recursive: true });
    const homeGlobal = join(tmp, "home-global");
    mkdirSync(homeGlobal, { recursive: true });
    writeFileSync(join(homeGlobal, "config.json"), JSON.stringify({ trigger: { global: true } }));
    // initialized project
    const proj = join(tmp, "proj");
    mkdirSync(join(proj, ".dream"), { recursive: true });
    writeFileSync(join(proj, ".dream", "config.json"), "{}");

    const stranger = join(tmp, "not-a-project");
    expect(runHook({ cwd: stranger }, tmp, homeOff)).toBe(""); // fast path: no spawn
    expect(runHook({ cwd: proj }, tmp, homeOff)).toContain("SHIM-CALLED"); // opted-in: CLI invoked
    expect(runHook({ workspace: { current_dir: proj } }, tmp, homeOff)).toContain("SHIM-CALLED"); // fallback field
    expect(runHook({ cwd: 42 }, tmp, homeOff)).toBe(""); // type-trust guard
    expect(runHook({ cwd: stranger }, tmp, homeGlobal)).toContain("SHIM-CALLED"); // global opt-in reaches the CLI
  });
});

describe("plugin scaffold validity (schema-drift canary)", () => {
  it("Agent Plugins manifest has $schema and a spec-compliant name", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "plugin/plugin.json"), "utf8"));
    expect(manifest.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(manifest.name).toMatch(/^[a-z0-9]([a-z0-9]|(?<![-.])[-.])*[a-z0-9]$/);
    expect(manifest.name.length).toBeLessThanOrEqual(64);
    expect(manifest.version).toBeTruthy();
  });

  it("Claude Code manifest matches the installed-plugin shape", () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "plugin/.claude-plugin/plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("dream");
    expect(manifest.description).toBeTruthy();
  });

  it("hooks.json declares the SessionStart hook via node (cross-platform)", () => {
    const hooks = JSON.parse(readFileSync(join(ROOT, "plugin/hooks/hooks.json"), "utf8"));
    const entry = hooks.hooks.SessionStart[0];
    expect(entry.matcher).toBe("startup|resume");
    expect(entry.hooks[0].command).toContain('node "${CLAUDE_PLUGIN_ROOT}/hooks/trigger.mjs"');
    expect(entry.hooks[0].timeout).toBe(15);
  });

  it("trigger.mjs exists, guards re-entry, handles Windows shims, and fast-paths opt-out projects", () => {
    const script = readFileSync(join(ROOT, "plugin/hooks/trigger.mjs"), "utf8");
    expect(script).toContain("DREAM_BACKGROUND");
    expect(script).toContain('process.platform === "win32"');
    expect(script).toContain("trigger?.global"); // profile-wide opt-in honored
    // uninitialized projects must exit before the CLI spawn (session-start latency)
    expect(script.indexOf(".dream")).toBeLessThan(script.indexOf("spawnSync(\"dream\""));
  });

  it("install/uninstall scripts exist for both platforms", () => {
    for (const script of ["install.sh", "uninstall.sh", "install.ps1", "uninstall.ps1"]) {
      expect(existsSync(join(ROOT, "scripts", script)), script).toBe(true);
    }
    for (const script of ["install.sh", "uninstall.sh"]) {
      expect(statSync(join(ROOT, "scripts", script)).mode & 0o111, `${script} +x`).toBeTruthy();
    }
  });

  it("the bare /dream command exists (auto-dream homage) and stays fire-and-forget", () => {
    const content = readFileSync(join(ROOT, "plugin/commands/dream.md"), "utf8");
    expect(content).toContain("description:");
    expect(content).toContain("dream trigger --now");
    expect(content).toContain("Do not block");
  });

  it("all four skills exist with required frontmatter", () => {
    for (const skill of ["run", "review", "status", "setup"]) {
      const content = readFileSync(join(ROOT, `plugin/skills/${skill}/SKILL.md`), "utf8");
      expect(content).toContain(`name: ${skill}`);
      expect(content).toContain("description:");
      expect(content).toContain("user-invocable: true");
    }
  });

  it("marketplace.json is the fiorastudio marketplace pointing at the plugin dir", () => {
    const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
    expect(market.name).toBe("fiorastudio"); // install spec: dream@fiorastudio
    expect(market.plugins[0]).toMatchObject({ name: "dream", source: "./plugin" });
  });
});
