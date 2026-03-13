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

// src/stop.ts
import { readFileSync as readFileSync2 } from "fs";
if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}
function getLastAssistantMessage(transcriptPath) {
  try {
    const content = readFileSync2(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === "assistant" && entry.message?.content) {
          const parts = Array.isArray(entry.message.content) ? entry.message.content : [{ type: "text", text: entry.message.content }];
          const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
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
async function main() {
  const input = await readStdin();
  const message = getLastAssistantMessage(input.transcript_path);
  if (!message) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const truncated = message.length > 1800 ? message.slice(0, 1800) + "\u2026" : message;
  const body = {
    session_id: input.session_id,
    type: "notification",
    summary: truncated,
    cwd: input.cwd
  };
  api("/events/discord", {
    method: "POST",
    body: JSON.stringify(body)
  }).catch(() => {
  });
  process.stdout.write(JSON.stringify({}));
}
main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
