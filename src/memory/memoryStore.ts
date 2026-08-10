import { mkdirSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import matter from "gray-matter";
import type { Proposal } from "../types.js";

export interface MemoryEntry {
  path: string; // relative to the memory dir, e.g. "gotcha-x.md"
  name: string;
  description: string;
  type?: string;
}

const RESERVED = new Set(["MEMORY.md", "CHANGELOG.md"]);

/**
 * v1 memory store: a directory of markdown files with YAML frontmatter and a
 * MEMORY.md index — the Claude Code per-project memory convention.
 */
export class FileMemoryStore {
  constructor(readonly root: string) {}

  /** Resolve a relative memory path, rejecting traversal outside the store. */
  resolvePath(relPath: string): string {
    const abs = resolve(this.root, relPath);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new Error(`Proposal path escapes the memory store: ${relPath}`);
    }
    return abs;
  }

  async list(): Promise<MemoryEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const entries: MemoryEntry[] = [];
    for (const file of names.sort()) {
      if (!file.endsWith(".md") || RESERVED.has(file)) continue;
      const raw = await readFile(join(this.root, file), "utf8");
      const parsed = matter(raw);
      entries.push({
        path: file,
        name: String(parsed.data?.name ?? basename(file, ".md")),
        description: String(parsed.data?.description ?? ""),
        type: parsed.data?.metadata?.type,
      });
    }
    return entries;
  }

  async read(relPath: string): Promise<string> {
    return readFile(this.resolvePath(relPath), "utf8");
  }

  /** Render the whole store as one markdown doc for agent consumption. */
  async snapshotMarkdown(maxBytes = 64 * 1024): Promise<string> {
    const entries = await this.list();
    if (entries.length === 0) return "# Memory store\n\n(empty — no memories yet)\n";
    const parts: string[] = ["# Memory store\n"];
    let used = parts[0]!.length;
    for (const entry of entries) {
      const content = await this.read(entry.path);
      const block = `\n---\n## ${entry.path}\n\n${content}\n`;
      if (used + block.length > maxBytes) {
        parts.push(`\n---\n## ${entry.path}\n\n(omitted for size — description: ${entry.description})\n`);
        continue;
      }
      parts.push(block);
      used += block.length;
    }
    return parts.join("");
  }

  async apply(p: Proposal): Promise<void> {
    const abs = this.resolvePath(p.path);
    switch (p.op) {
      case "create":
      case "update":
        if (p.newContent === undefined) {
          throw new Error(`Proposal ${p.op} ${p.path} has no newContent`);
        }
        mkdirSync(this.root, { recursive: true });
        await writeFile(abs, p.newContent, "utf8");
        return;
      case "delete":
        await rm(abs);
        return;
    }
  }

  /** Rewrite MEMORY.md from the files on disk (harness-owned, never agent-written). */
  async regenerateIndex(): Promise<void> {
    const entries = await this.list();
    const lines = [
      "# Memory Index",
      "",
      ...entries.map((e) => `- [${e.name}](${e.path}) — ${e.description}`),
      "",
    ];
    mkdirSync(this.root, { recursive: true });
    await writeFile(join(this.root, "MEMORY.md"), lines.join("\n"), "utf8");
  }
}
