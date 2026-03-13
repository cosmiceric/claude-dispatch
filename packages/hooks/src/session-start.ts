import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { notify } from "./lib/notify.js";
import { isDispatchEnabled } from "./lib/enabled.js";
import type { StartSessionBody } from "@dispatch/shared";

if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

interface HookInput {
  session_id: string;
  cwd: string;
}

async function main() {
  const input = (await readStdin()) as HookInput;
  const project = input.cwd.split("/").pop() || input.cwd;

  notify("Claude Code", `Session started in ${project}`);

  api(`/sessions/${input.session_id}/start`, {
    method: "POST",
    body: JSON.stringify({ cwd: input.cwd } satisfies StartSessionBody),
  }).catch(() => {});

  process.stdout.write(JSON.stringify({}));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
