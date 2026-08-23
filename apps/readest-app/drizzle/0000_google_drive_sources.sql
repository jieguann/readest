CREATE TABLE IF NOT EXISTS google_drive_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  google_sub TEXT NOT NULL,
  google_email TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  granted_scope TEXT NOT NULL DEFAULT '',
  token_expires_at INTEGER NOT NULL,
  folder_id TEXT,
  folder_url TEXT,
  folder_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS google_drive_progress (
  google_sub TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  current_page INTEGER NOT NULL,
  total_pages INTEGER NOT NULL,
  location TEXT,
  reading_status TEXT NOT NULL,
  last_read_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (google_sub, drive_file_id)
);
