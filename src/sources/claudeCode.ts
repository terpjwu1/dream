import { createReadStream } from "node:fs";
import { readdir, stat, open } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { claudeProjectDir } from "../paths.js";
import type { SessionRecord, SessionRef } from "../types.js";
import type { TranscriptSource } from "./transcriptSource.js";

const SESSION_FILE = /^[0-9a-f-]{36}\.jsonl$/;

/** Reads Claude Code session JSONL files under ~/.claude/projects/<munged>/. */
export class ClaudeCodeSource implements TranscriptSource {
  readonly id = "claude-code";

  async listSessions(projectPath: string, opts?: { since?: Date }): Promise<SessionRef[]> {
    const dir = claudeProjectDir(projectPath);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const refs: SessionRef[] = [];
    for (const name of entries) {
      if (!SESSION_FILE.test(name)) continue;
      const filePath = join(dir, name);
      const info = await stat(filePath);
      if (info.size === 0) continue;
      const endedAt = info.mtime;
      if (opts?.since && endedAt < opts.since) continue;
      refs.push({
        sessionId: basename(name, ".jsonl"),
        filePath,
        startedAt: (await firstTimestamp(filePath)) ?? info.birthtime,
        endedAt,
        sizeBytes: info.size,
        projectPath,
      });
    }
    return refs.sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
  }

  async *readSession(ref: SessionRef): AsyncIterable<SessionRecord> {
    const rl = createInterface({
      input: createReadStream(ref.filePath, "utf8"),
      crlfDelay: Infinity,
    });
    let envelopeEmitted = false;
    for await (const line of rl) {
      if (!line.trim()) continue;
      let raw: any;
      try {
        raw = JSON.parse(line);
      } catch {
        continue; // torn final line of a live session; skip
      }
      if (!envelopeEmitted && raw?.gitBranch) {
        envelopeEmitted = true;
        yield {
          kind: "meta",
          ts: raw.timestamp ?? "",
          raw: { type: "envelope", gitBranch: raw.gitBranch },
        };
      }
      yield* mapRecord(raw);
    }
  }
}

/** Map one raw JSONL record to zero or more normalized SessionRecords. */
export function* mapRecord(raw: any): Generator<SessionRecord> {
  const ts: string = raw?.timestamp ?? "";
  switch (raw?.type) {
    case "user": {
      const content = raw.message?.content;
      // isMeta user records are harness-injected (command caveats, image
      // placeholders) — never treat them as human prompts.
      if (typeof content === "string") {
        if (!raw.isMeta) yield { kind: "user_prompt", text: content, ts, uuid: raw.uuid ?? "" };
        return;
      }
      if (Array.isArray(content)) {
        const sideChannel = raw.toolUseResult ?? {};
        for (const block of content) {
          if (block?.type === "tool_result") {
            yield {
              kind: "tool_result",
              toolUseId: block.tool_use_id ?? "",
              isError: block.is_error === true,
              stdout: pickText(block.content) ?? sideChannel.stdout,
              stderr: sideChannel.stderr,
              interrupted: sideChannel.interrupted === true,
              ts,
            };
          } else if (block?.type === "text" && !raw.isMeta) {
            yield { kind: "user_prompt", text: block.text ?? "", ts, uuid: raw.uuid ?? "" };
          }
        }
        return;
      }
      return;
    }
    case "assistant": {
      const model: string = raw.message?.model ?? "unknown";
      for (const block of raw.message?.content ?? []) {
        if (block?.type === "text" && block.text) {
          yield { kind: "assistant_text", text: block.text, model, ts, uuid: raw.uuid ?? "" };
        } else if (block?.type === "tool_use") {
          yield {
            kind: "tool_call",
            toolName: block.name ?? "unknown",
            input: block.input,
            id: block.id ?? "",
            ts,
          };
        }
        // thinking blocks are intentionally dropped (huge, low signal for dreaming)
      }
      return;
    }
    default:
      // progress / system / file-history-snapshot / queue-operation / headers
      yield {
        kind: "meta",
        ts,
        raw: { type: String(raw?.type ?? "unknown"), gitBranch: raw?.gitBranch },
      };
  }
}

function pickText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text);
    if (texts.length) return texts.join("\n");
  }
  return undefined;
}

/** Read just enough of the file head to find the first record timestamp. */
async function firstTimestamp(filePath: string): Promise<Date | undefined> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.toString("utf8", 0, bytesRead).split("\n")) {
      try {
        const ts = JSON.parse(line)?.timestamp;
        if (ts) return new Date(ts);
      } catch {
        continue;
      }
    }
    return undefined;
  } finally {
    await fh.close();
  }
}
