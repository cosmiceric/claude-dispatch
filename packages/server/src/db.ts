import type { Session, Event, ApprovalRequest } from "@dispatch/shared";

export async function insertSession(db: D1Database, session: Omit<Session, "ended_at">) {
  await db
    .prepare("INSERT INTO sessions (id, cwd, started_at, status) VALUES (?, ?, ?, ?)")
    .bind(session.id, session.cwd, session.started_at, session.status)
    .run();
}

export async function endSession(db: D1Database, id: string) {
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE sessions SET ended_at = ?, status = 'ended' WHERE id = ?")
    .bind(now, id)
    .run();
}

export async function getSession(db: D1Database, id: string): Promise<Session | null> {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<Session>();
}

export async function insertEvent(db: D1Database, event: Omit<Event, "id">) {
  await db
    .prepare(
      "INSERT INTO events (session_id, type, tool_name, summary, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(event.session_id, event.type, event.tool_name ?? null, event.summary ?? null, event.created_at)
    .run();
}

export async function insertApprovalRequest(db: D1Database, req: ApprovalRequest) {
  await db
    .prepare(
      `INSERT INTO approval_requests (id, session_id, tool_name, tool_input_summary, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(req.id, req.session_id, req.tool_name, req.tool_input_summary, req.status, req.created_at)
    .run();
}

export async function updateApprovalRequest(
  db: D1Database,
  id: string,
  updates: { status: string; response_message?: string; discord_message_id?: string }
) {
  const now = new Date().toISOString();
  if (updates.discord_message_id) {
    await db
      .prepare("UPDATE approval_requests SET discord_message_id = ? WHERE id = ?")
      .bind(updates.discord_message_id, id)
      .run();
  }
  if (updates.status !== "pending") {
    await db
      .prepare(
        "UPDATE approval_requests SET status = ?, response_message = ?, resolved_at = ? WHERE id = ?"
      )
      .bind(updates.status, updates.response_message ?? null, now, id)
      .run();
  }
}

export async function getApprovalRequest(db: D1Database, id: string): Promise<ApprovalRequest | null> {
  return db.prepare("SELECT * FROM approval_requests WHERE id = ?").bind(id).first<ApprovalRequest>();
}

export async function getSessionStats(db: D1Database, sessionId: string) {
  const result = await db
    .prepare("SELECT COUNT(*) as tool_count FROM events WHERE session_id = ? AND type = 'tool_use'")
    .bind(sessionId)
    .first<{ tool_count: number }>();
  return { tool_count: result?.tool_count ?? 0 };
}
