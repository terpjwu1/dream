/**
 * Secret scanning + redaction applied to EVERY string dream persists —
 * memory content, rationales, evidence excerpts, commit bodies, changelog
 * entries, proposals JSON — so no review artifact can leak transcript secrets.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[a-zA-Z0-9_-]{8,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /gh[pousr]_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /whsec_[a-zA-Z0-9]{16,}/g,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[a-zA-Z0-9._~+/=-]{20,}/g,
  /\beyJ[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9._-]{10,}/g, // JWTs
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED-SECRET]");
  }
  return out;
}

/**
 * Redact every string anywhere in a JSON-shaped value. Schema-driven,
 * field-by-field redaction misses newly added fields; this can't.
 */
export function deepRedact<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => deepRedact(v)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deepRedact(v)]),
    ) as T;
  }
  return value;
}

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}
