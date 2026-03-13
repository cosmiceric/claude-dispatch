import { readStdin } from "./lib/stdin.js";
import { api } from "./lib/client.js";
import { notify } from "./lib/notify.js";
import { isDispatchEnabled } from "./lib/enabled.js";
import type { CreateEventBody } from "@dispatch/shared";

if (!isDispatchEnabled()) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

interface HookInput {
  session_id: string;
  message: string;
}

async function main() {
  const input = (await readStdin()) as HookInput;

  notify("Claude Code", input.message);

  api("/events", {
    method: "POST",
    body: JSON.stringify({
      session_id: input.session_id,
      type: "notification",
      summary: input.message,
    } satisfies CreateEventBody),
  }).catch(() => {});

  process.stdout.write(JSON.stringify({}));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
