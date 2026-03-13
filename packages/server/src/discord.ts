const DISCORD_API = "https://discord.com/api/v10";

interface DiscordEnv {
  DISCORD_BOT_TOKEN: string;
  DISCORD_CHANNEL_ID: string;
}

function headers(token: string) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

export async function sendMessage(env: DiscordEnv, content: string, embeds?: unknown[], components?: unknown[]) {
  const body: Record<string, unknown> = {};
  if (content) body.content = content;
  if (embeds?.length) body.embeds = embeds;
  if (components?.length) body.components = components;

  const res = await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: headers(env.DISCORD_BOT_TOKEN),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Discord send failed:", res.status, text);
    return null;
  }
  return (await res.json()) as { id: string };
}

export async function updateMessage(env: DiscordEnv, messageId: string, content: string, embeds?: unknown[], components?: unknown[]) {
  const body: Record<string, unknown> = {};
  if (content) body.content = content;
  if (embeds) body.embeds = embeds;
  if (components) body.components = components;

  await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages/${messageId}`, {
    method: "PATCH",
    headers: headers(env.DISCORD_BOT_TOKEN),
    body: JSON.stringify(body),
  });
}

function projectName(cwd: string): string {
  return cwd.split("/").pop() || cwd;
}

export function buildApprovalEmbed(toolName: string, inputSummary: string, sessionId: string, cwd: string) {
  return {
    title: `${projectName(cwd)} — Claude needs approval`,
    color: 0xf59e0b, // amber
    fields: [
      { name: "Tool", value: `\`${toolName}\``, inline: true },
      { name: "Project", value: `\`${projectName(cwd)}\``, inline: true },
      { name: "Details", value: inputSummary.slice(0, 1024) },
    ],
    footer: { text: `${sessionId.slice(0, 8)} · ${cwd}` },
    timestamp: new Date().toISOString(),
  };
}

export function buildApprovalButtons(requestId: string) {
  return [
    {
      type: 1, // ACTION_ROW
      components: [
        {
          type: 2, // BUTTON
          style: 2, // SECONDARY (grey)
          label: "Approve",
          emoji: { name: "✅" },
          custom_id: `approve:${requestId}`,
        },
        {
          type: 2,
          style: 2, // SECONDARY (grey)
          label: "Deny",
          emoji: { name: "❌" },
          custom_id: `deny:${requestId}`,
        },
        {
          type: 2,
          style: 2, // SECONDARY (grey)
          label: "Respond",
          emoji: { name: "💬" },
          custom_id: `respond:${requestId}`,
        },
      ],
    },
  ];
}

export function buildModal(requestId: string) {
  return {
    type: 9, // MODAL
    data: {
      title: "Respond to Claude",
      custom_id: `modal:${requestId}`,
      components: [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 4, // TEXT_INPUT
              custom_id: "message",
              label: "Message for Claude",
              style: 2, // PARAGRAPH
              placeholder: "Type a message to send to Claude...",
              required: true,
            },
          ],
        },
      ],
    },
  };
}

export async function sendSessionStartMessage(env: DiscordEnv, sessionId: string, cwd: string) {
  return sendMessage(env, `🟢 Session started in \`${projectName(cwd)}\` — \`${sessionId.slice(0, 8)}\``);
}

export async function sendSessionEndMessage(env: DiscordEnv, sessionId: string, cwd: string, toolCount: number, durationMin: number) {
  return sendMessage(
    env,
    `🔴 Session ended in \`${projectName(cwd)}\` (${durationMin} min, ${toolCount} tools) — \`${sessionId.slice(0, 8)}\``
  );
}

export async function sendToolUseMessage(env: DiscordEnv, toolName: string, summary: string, cwd: string) {
  return sendMessage(env, `🔧 \`${toolName}\` ${summary} in \`${projectName(cwd)}\``);
}
