import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { isDispatchEnabled } from "./lib/enabled.js";
import type { CreateEventBody } from "@dispatch/shared";

if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result?: unknown;
}

async function main() {
  const input = (await readStdin()) as HookInput;

  // Fire and forget — don't block Claude
  api("/events", {
    method: "POST",
    body: JSON.stringify({
      session_id: input.session_id,
      type: "tool_use",
      tool_name: input.tool_name,
      summary: summarize(input),
    } satisfies CreateEventBody),
  }).catch(() => {});

  process.stdout.write(JSON.stringify({}));
}

function summarize(input: HookInput): string {
  const ti = input.tool_input;
  if (ti.file_path) return String(ti.file_path);
  if (ti.command) return String(ti.command).slice(0, 100);
  if (ti.pattern) return `pattern: ${ti.pattern}`;
  return input.tool_name;
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
