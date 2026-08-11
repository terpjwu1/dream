import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileMemoryStore } from "../src/memory/memoryStore.js";
import { validateMemoryFile } from "../src/memory/frontmatter.js";
import type { Finding, Proposal } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "dream-mem-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MEMORY_A = `---
name: deploy-env-vars
description: Deploy script requires AWS_REGION to be exported
metadata:
  type: project
---

The deploy script fails without AWS_REGION.
`;

const finding: Finding = {
  id: "f1",
  category: "recurring_failure",
  summary: "s",
  detail: "d",
  evidence: { sessionIds: ["a"], sessionsAnalyzed: 1, quotes: [{ sessionId: "a", excerpt: "q" }] },
  relatedMemoryFiles: [],
};

describe("FileMemoryStore", () => {
  const store = new FileMemoryStore(dir);

  it("lists memory files with frontmatter, skipping reserved files", async () => {
    writeFileSync(join(dir, "deploy-env-vars.md"), MEMORY_A);
    writeFileSync(join(dir, "MEMORY.md"), "# Memory Index\n");
    writeFileSync(join(dir, "notes.txt"), "not markdown");
    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: "deploy-env-vars.md",
      name: "deploy-env-vars",
      type: "project",
    });
  });

  it("rejects paths escaping the store", () => {
    expect(() => store.resolvePath("../evil.md")).toThrow(/escapes/);
    expect(() => store.resolvePath("/etc/passwd")).toThrow(/escapes/);
    expect(() => store.resolvePath("sub/ok.md")).not.toThrow();
  });

  it("applies create/update/delete proposals", async () => {
    const create: Proposal = {
      op: "create",
      path: "new-memory.md",
      newContent: MEMORY_A.replace("deploy-env-vars", "new-memory"),
      rationale: "r",
      finding,
    };
    await store.apply(create);
    expect(existsSync(join(dir, "new-memory.md"))).toBe(true);

    await store.apply({ ...create, op: "delete", newContent: undefined });
    expect(existsSync(join(dir, "new-memory.md"))).toBe(false);
  });

  it("regenerates MEMORY.md from files on disk", async () => {
    await store.regenerateIndex();
    const index = readFileSync(join(dir, "MEMORY.md"), "utf8");
    expect(index).toContain("[deploy-env-vars](deploy-env-vars.md)");
    expect(index).toContain("AWS_REGION");
  });

  it("snapshots the store as markdown with a size cap", async () => {
    const snapshot = await store.snapshotMarkdown(10_000);
    expect(snapshot).toContain("## deploy-env-vars.md");
    expect(snapshot).toContain("The deploy script fails");
  });
});

describe("validateMemoryFile", () => {
  it("accepts a conventional memory file", () => {
    expect(validateMemoryFile(MEMORY_A).name).toBe("deploy-env-vars");
  });
  it("rejects missing name/description/body", () => {
    expect(() => validateMemoryFile("---\nname: x\n---\n\nbody")).toThrow(/description/);
    expect(() => validateMemoryFile("---\nname: x\ndescription: y\n---\n\n")).toThrow(/empty/);
    expect(() => validateMemoryFile("no frontmatter at all")).toThrow(/name/);
  });
});
