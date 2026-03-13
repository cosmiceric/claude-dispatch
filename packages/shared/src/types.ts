// ─── Hook I/O ───

export interface PreToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PreToolUseOutput {
  decision?: "approve" | "deny";
  reason?: string;
  suppressPrompt?: boolean;
}

export interface PostToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result?: unknown;
}

export interface SessionStartInput {
  session_id: string;
  cwd: string;
}

export interface SessionEndInput {
  session_id: string;
  cwd: string;
}

export interface NotificationInput {
  session_id: string;
  message: string;
}

// ─── API Types ───

export interface Session {
  id: string;
  cwd: string;
  started_at: string;
  ended_at: string | null;
  status: "active" | "ended";
}

export interface Event {
  id?: number;
  session_id: string;
  type: "tool_use" | "tool_result" | "notification" | "stop";
  tool_name?: string;
  summary?: string;
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  session_id: string;
  tool_name: string;
  tool_input_summary: string;
  discord_message_id?: string;
  status: "pending" | "approved" | "denied";
  response_message?: string;
  created_at: string;
  resolved_at?: string;
}

export interface ApprovalResponse {
  decision: "approve" | "deny";
  message?: string;
}

// ─── API Request/Response ───

export interface StartSessionBody {
  cwd: string;
}

export interface CreateEventBody {
  session_id: string;
  type: Event["type"];
  tool_name?: string;
  summary?: string;
}

export interface CreateApprovalBody {
  session_id: string;
  tool_name: string;
  tool_input_summary: string;
  cwd: string;
}

export interface CreateApprovalResponse {
  request_id: string;
}
