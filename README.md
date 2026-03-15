# Claude Dispatch

Discord-powered remote approvals and monitoring for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Get notified on Discord when Claude needs permission to run a tool, and approve or deny from your phone — even when you're away from your desk.

## How It Works

```
Claude Code ──hook──▶ Dispatch Hooks ──POST──▶ Cloudflare Worker ──▶ Discord
                          ▲                         │
                          │                         │
                     long-poll                 button click
                          │                         │
                          ◀─────────────────────────┘
```

1. Claude Code triggers a **PreToolUse** hook before running any tool
2. The hook sends the tool details to a **Cloudflare Worker** (D1 + Durable Objects)
3. The worker posts an embed to **Discord** with Approve / Deny / Respond buttons
4. The hook **long-polls** the worker until you click a button
5. Your decision is relayed back to Claude Code

Safe tools (Read, Glob, Grep, etc.) are auto-allowed by default — only tools that modify things require approval.

## Prerequisites

- **Cloudflare account** (free tier works)
- **Discord server** where you can add a bot
- **Node.js 20+**
- **Claude Code** installed and working

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name (e.g. "Dispatch")
3. Go to **Bot** → click **Reset Token** → copy the **bot token**
4. Go to **General Information** → copy the **Application ID** and **Public Key**
5. Go to **Bot** → enable **Message Content Intent**
6. Invite the bot to your server:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=2048
   ```
   (2048 = Send Messages)
7. In Discord, right-click the channel you want notifications in → **Copy Channel ID**
   (Enable Developer Mode in Discord Settings → App Settings → Advanced if you don't see this)

You'll enter all of these values during setup.

## Quick Start

```bash
git clone https://github.com/cosmiceric/claude-dispatch.git
cd claude-dispatch
npm install
npm run setup
```

The setup wizard will walk you through everything: creating the D1 database, setting secrets, deploying the worker, and configuring Claude Code hooks.

After setup, **set the Interactions Endpoint URL** in your Discord app settings to:
```
https://dispatch.YOUR-SUBDOMAIN.workers.dev/discord/interactions
```
(The setup script will print the exact URL.)

## Usage

Toggle Dispatch on/off inside Claude Code:

```
/dispatch
```

When on, every tool call that isn't auto-allowed will show up in Discord with approve/deny buttons. Questions from Claude (via `AskUserQuestion`) also appear in Discord with a respond button.

## Configuration

### Environment Variables

These are set automatically by the setup script in `~/.claude/settings.json`:

| Variable | Description |
|----------|-------------|
| `DISPATCH_URL` | Your deployed worker URL |
| `DISPATCH_API_KEY` | API key for authenticating hooks → worker |
| `DISPATCH_USER_NAME` | Your name (shown in Discord messages) |
| `DISPATCH_AUTO_ALLOW` | Comma-separated list of tools to auto-approve (default: `Read,Glob,Grep,WebFetch,WebSearch,Agent`) |

### Auto-Allow List

By default, read-only tools are auto-allowed. Customize by setting `DISPATCH_AUTO_ALLOW` in your Claude Code settings env:

```json
{
  "env": {
    "DISPATCH_AUTO_ALLOW": "Read,Glob,Grep,WebFetch,WebSearch,Agent,Bash"
  }
}
```

### Toggle File

Dispatch reads `~/.dispatch-enabled` to check if it's active. The `/dispatch` command toggles this file between `true` and `false`.

## License

MIT
