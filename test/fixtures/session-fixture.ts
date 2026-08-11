/** Sanitized JSONL lines matching the real Claude Code transcript shapes. */
export const FIXTURE_SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const env = {
  isSidechain: false,
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/test/proj",
  sessionId: FIXTURE_SESSION_ID,
  version: "2.1.84",
  gitBranch: "feat/demo",
};

export const FIXTURE_LINES: object[] = [
  { type: "progress", data: { type: "hook_progress", hookEvent: "SessionStart" }, ...env },
  {
    type: "user",
    isMeta: true,
    message: { role: "user", content: "<local-command-caveat>ignore me</local-command-caveat>" },
    uuid: "u0",
    timestamp: "2026-08-01T10:00:00.000Z",
    ...env,
  },
  {
    type: "user",
    message: { role: "user", content: "please fix the flaky deploy script" },
    uuid: "u1",
    timestamp: "2026-08-01T10:00:05.000Z",
    ...env,
  },
  {
    type: "assistant",
    message: {
      model: "claude-fable-5",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "SHOULD BE DROPPED ".repeat(50), signature: "sig" },
        { type: "text", text: "Looking at the deploy script now." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "./deploy.sh --prod", description: "Run deploy" },
        },
      ],
    },
    uuid: "a1",
    timestamp: "2026-08-01T10:00:10.000Z",
    ...env,
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "deploy failed",
          is_error: true,
        },
      ],
    },
    toolUseResult: { stdout: "deploy failed", stderr: "Error: MISSING_ENV_VAR AWS_REGION" },
    uuid: "u2",
    timestamp: "2026-08-01T10:00:20.000Z",
    ...env,
  },
  {
    type: "assistant",
    message: {
      model: "claude-fable-5",
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "sleep 999" } },
      ],
    },
    uuid: "a2",
    timestamp: "2026-08-01T10:01:00.000Z",
    ...env,
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_2", content: "", is_error: false },
      ],
    },
    toolUseResult: { stdout: "", stderr: "", interrupted: true },
    uuid: "u3",
    timestamp: "2026-08-01T10:01:05.000Z",
    ...env,
  },
  { type: "file-history-snapshot", snapshot: {}, ...env },
  { type: "queue-operation", operation: "drain", ...env },
];

export const FIXTURE_JSONL = FIXTURE_LINES.map((l) => JSON.stringify(l)).join("\n") + "\n";
