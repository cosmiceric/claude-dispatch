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

// src/elicitation.ts
if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}
var POLL_INTERVAL_MS = 28e3;
function projectName(cwd) {
  return cwd.split("/").pop() || cwd;
}
async function main() {
  const input = await readStdin();
  const question = input.message || input.title || "Claude is asking a question";
  const project = projectName(input.cwd || "unknown");
  const sessionShort = (input.session_id || "unknown").slice(0, 8);
  notify("Claude Code", `Question: ${question}`);
  let requestId;
  try {
    const res = await api("/elicitation/request", {
      method: "POST",
      body: JSON.stringify({
        session_id: input.session_id,
        question,
        cwd: input.cwd
      })
    });
    requestId = res.request_id;
  } catch (err) {
    console.error("Dispatch server error:", err);
    process.stdout.write(JSON.stringify({}));
    return;
  }
  while (true) {
    try {
      const pollResult = await api(
        `/approval/poll/${requestId}?timeout=${POLL_INTERVAL_MS}`
      );
      if (pollResult.message === "Poll timeout \u2014 retrying") {
        continue;
      }
      if (pollResult.message) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "Elicitation",
            additionalContext: `Response from ${process.env.DISPATCH_USER_NAME || "User"} via Discord: ${pollResult.message}`
          }
        }));
      } else {
        process.stdout.write(JSON.stringify({}));
      }
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2e3));
    }
  }
}
main().catch((err) => {
  console.error("elicitation hook error:", err);
  process.stdout.write(JSON.stringify({}));
});
