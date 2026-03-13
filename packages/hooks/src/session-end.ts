import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { isDispatchEnabled } from "./lib/enabled.js";

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

  api(`/sessions/${input.session_id}/end`, {
    method: "POST",
    body: JSON.stringify({}),
  }).catch(() => {});

  process.stdout.write(JSON.stringify({}));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
