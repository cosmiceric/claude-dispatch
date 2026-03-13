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

// src/session-start.ts
if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}
async function main() {
  const input = await readStdin();
  const project = input.cwd.split("/").pop() || input.cwd;
  notify("Claude Code", `Session started in ${project}`);
  api(`/sessions/${input.session_id}/start`, {
    method: "POST",
    body: JSON.stringify({ cwd: input.cwd })
  }).catch(() => {
  });
  process.stdout.write(JSON.stringify({}));
}
main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
