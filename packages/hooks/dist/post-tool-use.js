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

// src/post-tool-use.ts
if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}
async function main() {
  const input = await readStdin();
  api("/events", {
    method: "POST",
    body: JSON.stringify({
      session_id: input.session_id,
      type: "tool_use",
      tool_name: input.tool_name,
      summary: summarize(input)
    })
  }).catch(() => {
  });
  process.stdout.write(JSON.stringify({}));
}
function summarize(input) {
  const ti = input.tool_input;
  if (ti.file_path) return String(ti.file_path);
  if (ti.command) return String(ti.command).slice(0, 100);
  if (ti.pattern) return `pattern: ${ti.pattern}`;
  return input.tool_name;
}
main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
