import { describe, expect, it } from "vitest";
import { containsSecret, redactSecrets } from "../src/redact.js";
import { extractJson } from "../src/agents/runner.js";

describe("redactSecrets", () => {
  it.each([
    ["anthropic key", "key sk-ant-api03-abcdefgh1234 done"],
    ["github token", "ghp_" + "a1B2".repeat(10)],
    ["aws key", "AKIAIOSFODNN7EXAMPLE"],
    ["stripe webhook", "whsec_abcdef1234567890"],
    ["bearer", "Authorization: Bearer abcdefghijklmnopqrstuvwx.12345"],
    ["jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig-part-here"],
    ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"],
  ])("redacts %s", (_name, text) => {
    expect(containsSecret(text)).toBe(true);
    expect(redactSecrets(text)).toContain("[REDACTED-SECRET]");
    expect(containsSecret(redactSecrets(text))).toBe(false);
  });

  it("leaves ordinary text alone", () => {
    const text = "the deploy failed because AWS_REGION was unset";
    expect(redactSecrets(text)).toBe(text);
    expect(containsSecret(text)).toBe(false);
  });
});

describe("extractJson", () => {
  it("takes the last json fence", () => {
    const text = 'thinking…\n```json\n[1]\n```\nrevised:\n```json\n[1,2]\n```';
    expect(extractJson(text)).toBe("[1,2]");
  });
  it("falls back to a bare JSON document", () => {
    expect(extractJson('Here you go: [{"a":1}]')).toBe('[{"a":1}]');
  });

  it("is not truncated by triple-backticks inside JSON strings (E2E regression)", () => {
    const inner = '[{"path":"db.md","newContent":"header\\n\\n```bash\\nmake db-up\\n```\\ntail"}]';
    const text = "Both findings point at one file.\n\n```json\n" + inner + "\n```\n";
    expect(extractJson(text)).toBe(inner);
    expect(JSON.parse(extractJson(text))[0].newContent).toContain("make db-up");
  });

  it("recovers a balanced document even when prose follows the fence", () => {
    const text = 'result:\n```json\n[{"a":"x```y"}]\n```\ndone — ping me.';
    expect(JSON.parse(extractJson(text))).toEqual([{ a: "x```y" }]);
  });
});
