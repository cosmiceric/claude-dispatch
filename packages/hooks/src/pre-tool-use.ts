import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { notify } from "./lib/notify.js";
import { isDispatchEnabled } from "./lib/enabled.js";
import type { CreateApprovalBody, CreateApprovalResponse, ApprovalResponse } from "@dispatch/shared";

if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const AUTO_ALLOW = (process.env.DISPATCH_AUTO_ALLOW || "Read,Glob,Grep,WebFetch,WebSearch,Agent")
  .split(",")
  .map((s: string) => s.trim());

const POLL_INTERVAL_MS = 28000; // slightly under 30s CF limit

interface HookInput {
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path);
  if (input.command) return String(input.command).slice(0, 200);
  if (input.content && input.file_path) return String(input.file_path);
  if (input.pattern) return `pattern: ${input.pattern}`;
  if (input.prompt) return String(input.prompt).slice(0, 200);
  return JSON.stringify(input).slice(0, 200);
}

async function main() {
  const input = (await readStdin()) as HookInput;
  const { session_id, cwd, tool_name, tool_input } = input;

  // Auto-allow safe tools
  if (AUTO_ALLOW.includes(tool_name)) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Handle AskUserQuestion — post question to Discord, deny tool so terminal prompt doesn't show
  if (tool_name === "AskUserQuestion") {
    interface Question { question: string; options?: Array<{ label: string }> }
    const questions = (tool_input.questions as Question[]) || [];
    const questionText = questions.map((q) => q.question).join("\n") || "Claude has a question";
    const options = questions.flatMap((q) => (q.options || []).map((o) => o.label));

    notify("Claude Code", questionText);

    let requestId: string;
    try {
      const res = await api<{ request_id: string }>("/elicitation/request", {
        method: "POST",
        body: JSON.stringify({ session_id, question: questionText, cwd, options }),
      });
      requestId = res.request_id;
    } catch {
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Long-poll for Discord response
    while (true) {
      try {
        const pollResult = await api<ApprovalResponse>(
          `/approval/poll/${requestId}?timeout=${POLL_INTERVAL_MS}`
        );
        if (pollResult.message === "Poll timeout — retrying") continue;
        // Deny the tool (prevents terminal prompt) but inject the answer as context
        const answer = pollResult.message || "No response";
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Answered via Discord",
            additionalContext: `${process.env.DISPATCH_USER_NAME || 'User'} answered via Discord: ${answer}`,
          },
        }));
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  const summary = summarizeInput(tool_name, tool_input);

  // Fire native notification
  notify("Claude Code", `${tool_name}: ${summary}`);

  // Create approval request on server
  let requestId: string;
  try {
    const res = await api<CreateApprovalResponse>("/approval/request", {
      method: "POST",
      body: JSON.stringify({
        session_id,
        tool_name,
        tool_input_summary: summary,
        cwd,
      } satisfies CreateApprovalBody),
    });
    requestId = res.request_id;
  } catch (err) {
    // If server is down, allow the tool (fail open)
    console.error("Companion server error:", err);
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Long-poll indefinitely until Discord responds
  let result: ApprovalResponse;

  while (true) {
    try {
      const pollResult = await api<ApprovalResponse>(
        `/approval/poll/${requestId}?timeout=${POLL_INTERVAL_MS}`
      );

      // DO poll expired without a response — keep waiting
      if (pollResult.message === "Poll timeout — retrying") {
        continue;
      }

      result = pollResult;
      break;
    } catch {
      // Network error — wait and retry
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision === "approve" ? "allow" : "deny",
      permissionDecisionReason: result.decision === "deny"
        ? (result.message || "Denied via Discord")
        : "Approved via Discord",
      ...(result.message ? { additionalContext: `Message from ${process.env.DISPATCH_USER_NAME || 'User'} via Discord: ${result.message}` } : {}),
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  console.error("pre-tool-use hook error:", err);
  // Fail open — fall through to normal permission prompt
  process.stdout.write(JSON.stringify({}));
});
