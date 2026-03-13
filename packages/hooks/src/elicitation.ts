import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { notify } from "./lib/notify.js";
import { isDispatchEnabled } from "./lib/enabled.js";
if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const POLL_INTERVAL_MS = 28000;

interface ElicitationInput {
  session_id: string;
  cwd: string;
  message?: string;
  title?: string;
  [key: string]: unknown;
}

function projectName(cwd: string): string {
  return cwd.split("/").pop() || cwd;
}

async function main() {
  const input = (await readStdin()) as ElicitationInput;

  const question = input.message || input.title || "Claude is asking a question";
  const project = projectName(input.cwd || "unknown");
  const sessionShort = (input.session_id || "unknown").slice(0, 8);

  notify("Claude Code", `Question: ${question}`);

  // Post to Discord with Respond button — reuse approval flow
  let requestId: string;
  try {
    const res = await api<{ request_id: string }>("/elicitation/request", {
      method: "POST",
      body: JSON.stringify({
        session_id: input.session_id,
        question,
        cwd: input.cwd,
      }),
    });
    requestId = res.request_id;
  } catch (err) {
    console.error("Dispatch server error:", err);
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Long-poll for response
  while (true) {
    try {
      const pollResult = await api<{ decision: string; message?: string }>(
        `/approval/poll/${requestId}?timeout=${POLL_INTERVAL_MS}`
      );

      if (pollResult.message === "Poll timeout — retrying") {
        continue;
      }

      // Got a response — inject it as context
      if (pollResult.message) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "Elicitation",
            additionalContext: `Response from ${process.env.DISPATCH_USER_NAME || 'User'} via Discord: ${pollResult.message}`,
          },
        }));
      } else {
        process.stdout.write(JSON.stringify({}));
      }
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  console.error("elicitation hook error:", err);
  process.stdout.write(JSON.stringify({}));
});
