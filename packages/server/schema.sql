CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  tool_name TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input_summary TEXT,
  discord_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  response_message TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
