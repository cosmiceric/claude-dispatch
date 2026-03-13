#!/usr/bin/env node

// src/lib/stdin.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

// src/lib/client.ts
var BASE_URL = process.env.DISPATCH_URL || "http://localhost:8787";
var API_KEY = process.env.DISPATCH_API_KEY || "";
async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// src/lib/notify.ts
import { exec } from "child_process";
function notify(title, message) {
  const escaped = message.replace(/"/g, '\\"').slice(0, 200);
  const script = `display notification "${escaped}" with title "${title}" sound name "Ping"`;
  exec(`osascript -e '${script}'`, () => {
  });
}

// src/lib/enabled.ts
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
function isDispatchEnabled() {
  try {
    const content = readFileSync(join(homedir(), ".dispatch-enabled"), "utf-8").trim();
    return content === "true";
  } catch {
    return false;
  }
}

// src/pre-tool-use.ts
if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}
var AUTO_ALLOW = (process.env.DISPATCH_AUTO_ALLOW || "Read,Glob,Grep,WebFetch,WebSearch,Agent").split(",").map((s) => s.trim());
var POLL_INTERVAL_MS = 28e3;
function summarizeInput(toolName, input) {
  if (input.file_path) return String(input.file_path);
  if (input.command) return String(input.command).slice(0, 200);
  if (input.content && input.file_path) return String(input.file_path);
  if (input.pattern) return `pattern: ${input.pattern}`;
  if (input.prompt) return String(input.prompt).slice(0, 200);
  return JSON.stringify(input).slice(0, 200);
}
async function main() {
  const input = await readStdin();
  const { session_id, cwd, tool_name, tool_input } = input;
  if (AUTO_ALLOW.includes(tool_name)) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  if (tool_name === "AskUserQuestion") {
    const questions = tool_input.questions || [];
    const questionText = questions.map((q) => q.question).join("\n") || "Claude has a question";
    const options = questions.flatMap((q) => (q.options || []).map((o) => o.label));
    notify("Claude Code", questionText);
    let requestId2;
    try {
      const res = await api("/elicitation/request", {
        method: "POST",
        body: JSON.stringify({ session_id, question: questionText, cwd, options })
      });
      requestId2 = res.request_id;
    } catch {
      process.stdout.write(JSON.stringify({}));
      return;
    }
    while (true) {
      try {
        const pollResult = await api(
          `/approval/poll/${requestId2}?timeout=${POLL_INTERVAL_MS}`
        );
        if (pollResult.message === "Poll timeout \u2014 retrying") continue;
        const answer = pollResult.message || "No response";
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Answered via Discord",
            additionalContext: `${process.env.DISPATCH_USER_NAME || "User"} answered via Discord: ${answer}`
          }
        }));
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2e3));
      }
    }
  }
  const summary = summarizeInput(tool_name, tool_input);
  notify("Claude Code", `${tool_name}: ${summary}`);
  let requestId;
  try {
    const res = await api("/approval/request", {
      method: "POST",
      body: JSON.stringify({
        session_id,
        tool_name,
        tool_input_summary: summary,
        cwd
      })
    });
    requestId = res.request_id;
  } catch (err) {
    console.error("Companion server error:", err);
    process.stdout.write(JSON.stringify({}));
    return;
  }
  let result;
  while (true) {
    try {
      const pollResult = await api(
        `/approval/poll/${requestId}?timeout=${POLL_INTERVAL_MS}`
      );
      if (pollResult.message === "Poll timeout \u2014 retrying") {
        continue;
      }
      result = pollResult;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2e3));
    }
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision === "approve" ? "allow" : "deny",
      permissionDecisionReason: result.decision === "deny" ? result.message || "Denied via Discord" : "Approved via Discord",
      ...result.message ? { additionalContext: `Message from ${process.env.DISPATCH_USER_NAME || "User"} via Discord: ${result.message}` } : {}
    }
  };
  process.stdout.write(JSON.stringify(output));
}
main().catch((err) => {
  console.error("pre-tool-use hook error:", err);
  process.stdout.write(JSON.stringify({}));
});
