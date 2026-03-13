import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { isDispatchEnabled } from "./lib/enabled.js";
import { readFileSync } from "fs";

if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

interface HookInput {
  session_id: string;
  cwd: string;
  transcript_path: string;
}

function getLastAssistantMessage(transcriptPath: string): string | null {
  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");

    // Walk backwards to find the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "assistant" && entry.message?.content) {
          // content can be a string or array of content blocks
          const parts = Array.isArray(entry.message.content)
            ? entry.message.content
            : [{ type: "text", text: entry.message.content }];

          const text = parts
            .filter((p: { type: string }) => p.type === "text")
            .map((p: { text: string }) => p.text)
            .join("\n");

          if (text.trim()) return text.trim();
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function projectName(cwd: string): string {
  return cwd.split("/").pop() || cwd;
}

async function main() {
  const input = (await readStdin()) as HookInput;
  const message = getLastAssistantMessage(input.transcript_path);

  if (!message) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Truncate for Discord (2000 char limit, leave room for header)
  const truncated = message.length > 1800
    ? message.slice(0, 1800) + "…"
    : message;

  const body = {
    session_id: input.session_id,
    type: "notification" as const,
    summary: truncated,
    cwd: input.cwd,
  };

  api("/events/discord", {
    method: "POST",
    body: JSON.stringify(body),
  }).catch(() => {});

  process.stdout.write(JSON.stringify({}));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
