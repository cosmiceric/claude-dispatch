import { Hono } from "hono";
import { apiKeyAuth } from "./auth";
import {
  insertSession,
  endSession,
  getSession,
  insertEvent,
  insertApprovalRequest,
  updateApprovalRequest,
  getSessionStats,
} from "./db";
import {
  sendMessage,
  updateMessage,
  sendSessionStartMessage,
  sendSessionEndMessage,
  buildApprovalEmbed,
  buildApprovalButtons,
  buildModal,
} from "./discord";
import { SessionDO } from "./durable/session";
import type {
  StartSessionBody,
  CreateEventBody,
  CreateApprovalBody,
  ApprovalResponse,
} from "@dispatch/shared";

export type Env = {
  Bindings: {
    DB: D1Database;
    SESSION_DO: DurableObjectNamespace;
    COMPANION_API_KEY: string;
    DISCORD_BOT_TOKEN: string;
    DISCORD_PUBLIC_KEY: string;
    DISCORD_CHANNEL_ID: string;
    DISPATCH_USER_NAME?: string;
  };
};

const app = new Hono<Env>();

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: err.message }, 500);
});

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "dispatch" }));

// ─── Authenticated API routes ───
const api = new Hono<Env>();
api.use("*", apiKeyAuth);

// Session start
api.post("/sessions/:id/start", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<StartSessionBody>();
  const now = new Date().toISOString();

  await insertSession(c.env.DB, { id, cwd: body.cwd, started_at: now, status: "active" });
  await sendSessionStartMessage(c.env, id, body.cwd);

  return c.json({ ok: true });
});

// Session end
api.post("/sessions/:id/end", async (c) => {
  const id = c.req.param("id");
  const session = await getSession(c.env.DB, id);
  await endSession(c.env.DB, id);

  if (session) {
    const stats = await getSessionStats(c.env.DB, id);
    const durationMin = Math.round(
      (Date.now() - new Date(session.started_at).getTime()) / 60000
    );
    await sendSessionEndMessage(c.env, id, session.cwd, stats.tool_count, durationMin);
  }

  return c.json({ ok: true });
});

// Events
api.post("/events", async (c) => {
  const body = await c.req.json<CreateEventBody>();
  const now = new Date().toISOString();
  await insertEvent(c.env.DB, { ...body, created_at: now });
  return c.json({ ok: true });
});

// Post event + send to Discord
api.post("/events/discord", async (c) => {
  const body = await c.req.json<{ session_id: string; type: string; summary: string; cwd: string }>();
  const project = body.cwd.split("/").pop() || body.cwd;
  const sessionShort = body.session_id.slice(0, 8);

  await sendMessage(c.env, "", [
    {
      color: 0x6366f1, // indigo
      description: body.summary.slice(0, 4096),
      footer: { text: `${sessionShort} · ${project}` },
      timestamp: new Date().toISOString(),
    },
  ]);

  return c.json({ ok: true });
});

// Elicitation request — Claude is asking a question
api.post("/elicitation/request", async (c) => {
  const body = await c.req.json<{ session_id: string; question: string; cwd: string; options?: string[] }>();
  const requestId = crypto.randomUUID();
  const project = body.cwd.split("/").pop() || body.cwd;
  const sessionShort = body.session_id.slice(0, 8);

  const embed = {
    title: `${project} — Claude has a question`,
    color: 0x8b5cf6, // purple
    description: body.question.slice(0, 4096),
    footer: { text: `${sessionShort} · ${body.cwd}` },
    timestamp: new Date().toISOString(),
  };

  // Build option buttons (max 5 per row including Respond)
  const buttons: unknown[] = (body.options || []).slice(0, 4).map((label, i) => ({
    type: 2,
    style: 2,
    label: label.slice(0, 80),
    custom_id: `option:${requestId}:${i}`,
  }));
  buttons.push({
    type: 2,
    style: 2,
    label: "Respond",
    emoji: { name: "💬" },
    custom_id: `respond:${requestId}`,
  });

  const components = [{ type: 1, components: buttons }];

  await sendMessage(c.env, "", [embed], components);

  // Register with DO for long-polling
  const doId = c.env.SESSION_DO.idFromName(body.session_id);
  const stub = c.env.SESSION_DO.get(doId);
  await stub.fetch(new Request(`http://do/approval/request/${requestId}`, { method: "POST" }));

  // Store in D1 so the interaction handler can look up session_id
  await insertApprovalRequest(c.env.DB, {
    id: requestId,
    session_id: body.session_id,
    tool_name: "Elicitation",
    tool_input_summary: body.question,
    status: "pending",
    created_at: new Date().toISOString(),
  });

  return c.json({ request_id: requestId });
});

// Approval request
api.post("/approval/request", async (c) => {
  const body = await c.req.json<CreateApprovalBody>();
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Insert into D1
  await insertApprovalRequest(c.env.DB, {
    id: requestId,
    session_id: body.session_id,
    tool_name: body.tool_name,
    tool_input_summary: body.tool_input_summary,
    status: "pending",
    created_at: now,
  });

  const cwd = body.cwd;

  // Post to Discord
  const embed = buildApprovalEmbed(body.tool_name, body.tool_input_summary, body.session_id, cwd);
  const buttons = buildApprovalButtons(requestId);
  const msg = await sendMessage(c.env, "", [embed], buttons);

  if (msg) {
    await updateApprovalRequest(c.env.DB, requestId, {
      status: "pending",
      discord_message_id: msg.id,
    });
  }

  // Register with Durable Object
  const doId = c.env.SESSION_DO.idFromName(body.session_id);
  const stub = c.env.SESSION_DO.get(doId);
  await stub.fetch(new Request(`http://do/approval/request/${requestId}`, { method: "POST" }));

  return c.json({ request_id: requestId });
});

// Approval poll (long-poll)
api.get("/approval/poll/:id", async (c) => {
  const requestId = c.req.param("id");
  const timeout = c.req.query("timeout") || "30000";

  // We need the session_id to reach the right DO. Look it up from D1.
  const approval = await c.env.DB
    .prepare("SELECT session_id FROM approval_requests WHERE id = ?")
    .bind(requestId)
    .first<{ session_id: string }>();

  if (!approval) {
    return c.json({ error: "Approval request not found" }, 404);
  }

  const doId = c.env.SESSION_DO.idFromName(approval.session_id);
  const stub = c.env.SESSION_DO.get(doId);
  const res = await stub.fetch(
    new Request(`http://do/approval/poll/${requestId}?timeout=${timeout}`)
  );

  const result = (await res.json()) as ApprovalResponse;
  return c.json(result);
});

app.route("/api", api);

// ─── Discord Interactions Endpoint ───

app.post("/discord/interactions", async (c) => {
  // Verify Discord signature
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  const rawBody = await c.req.text();

  if (!signature || !timestamp) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const isValid = await verifyDiscordSignature(
    c.env.DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    rawBody
  );
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const interaction = JSON.parse(rawBody);

  // Respond to Discord's ping
  if (interaction.type === 1) {
    return c.json({ type: 1 });
  }

  // Button click
  if (interaction.type === 3) {
    const customId: string = interaction.data.custom_id;

    if (customId.startsWith("approve:") || customId.startsWith("deny:")) {
      const [action, requestId] = customId.split(":");
      const decision: "approve" | "deny" = action === "approve" ? "approve" : "deny";
      const label = decision === "approve" ? "✅ Approved" : "❌ Denied";

      // Resolve in DO
      const approval = await c.env.DB
        .prepare("SELECT session_id FROM approval_requests WHERE id = ?")
        .bind(requestId)
        .first<{ session_id: string }>();

      if (approval) {
        const doId = c.env.SESSION_DO.idFromName(approval.session_id);
        const stub = c.env.SESSION_DO.get(doId);
        await stub.fetch(
          new Request(`http://do/approval/respond/${requestId}`, {
            method: "POST",
            body: JSON.stringify({ decision } satisfies ApprovalResponse),
          })
        );

        // Update D1
        await updateApprovalRequest(c.env.DB, requestId, { status: decision === "approve" ? "approved" : "denied" });
      }

      // Update the Discord message — remove buttons, show result
      return c.json({
        type: 7, // UPDATE_MESSAGE
        data: {
          content: `${label} by ${c.env.DISPATCH_USER_NAME || 'User'}`,
          embeds: interaction.message?.embeds || [],
          components: [],
        },
      });
    }

    if (customId.startsWith("option:")) {
      const parts = customId.split(":");
      const requestId = parts[1];
      // Get the button label from the clicked component
      const clickedLabel = interaction.message?.components?.[0]?.components
        ?.find((comp: { custom_id: string }) => comp.custom_id === customId)?.label || "Selected option";

      const approval = await c.env.DB
        .prepare("SELECT session_id FROM approval_requests WHERE id = ?")
        .bind(requestId)
        .first<{ session_id: string }>();

      if (approval) {
        const doId = c.env.SESSION_DO.idFromName(approval.session_id);
        const stub = c.env.SESSION_DO.get(doId);
        await stub.fetch(
          new Request(`http://do/approval/respond/${requestId}`, {
            method: "POST",
            body: JSON.stringify({ decision: "approve", message: clickedLabel } satisfies ApprovalResponse),
          })
        );
        await updateApprovalRequest(c.env.DB, requestId, { status: "approved", response_message: clickedLabel });
      }

      return c.json({
        type: 7,
        data: {
          content: `💬 ${c.env.DISPATCH_USER_NAME || 'User'} selected: "${clickedLabel}"`,
          embeds: interaction.message?.embeds || [],
          components: [],
        },
      });
    }

    if (customId.startsWith("respond:")) {
      const requestId = customId.split(":")[1];
      return c.json(buildModal(requestId));
    }
  }

  // Modal submit
  if (interaction.type === 5) {
    const customId: string = interaction.data.custom_id;
    if (customId.startsWith("modal:")) {
      const requestId = customId.split(":")[1];
      const message = interaction.data.components?.[0]?.components?.[0]?.value || "";

      const approval = await c.env.DB
        .prepare("SELECT session_id FROM approval_requests WHERE id = ?")
        .bind(requestId)
        .first<{ session_id: string }>();

      if (approval) {
        const doId = c.env.SESSION_DO.idFromName(approval.session_id);
        const stub = c.env.SESSION_DO.get(doId);
        await stub.fetch(
          new Request(`http://do/approval/respond/${requestId}`, {
            method: "POST",
            body: JSON.stringify({ decision: "approve", message } satisfies ApprovalResponse),
          })
        );

        await updateApprovalRequest(c.env.DB, requestId, {
          status: "approved",
          response_message: message,
        });
      }

      return c.json({
        type: 7,
        data: {
          content: `✅ Approved with message: "${message.slice(0, 100)}"`,
          embeds: interaction.message?.embeds || [],
          components: [],
        },
      });
    }
  }

  return c.json({ type: 1 });
});

// ─── Discord Signature Verification ───

async function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToUint8Array(publicKey),
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );

    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + body);

    return await crypto.subtle.verify("Ed25519", key, hexToUint8Array(signature), message);
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Export DO and default
export { SessionDO } from "./durable/session";
export default app;
