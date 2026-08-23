import { env } from 'cloudflare:workers';
import type { GoogleDriveProgress } from '@/services/googleDriveSource';
import type { ReadingStatus } from '@/types/book';

type D1Value = string | number | null;

interface D1Result<T> {
  results?: T[];
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface GoogleDriveBindings {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
}

export interface DriveSessionRecord {
  session_id: string;
  google_sub: string;
  google_email: string;
  access_token_enc: string;
  refresh_token_enc: string;
  granted_scope: string;
  token_expires_at: number;
  folder_id: string | null;
  folder_url: string | null;
  folder_name: string | null;
  created_at: number;
  updated_at: number;
}

interface DriveProgressRecord {
  google_sub: string;
  drive_file_id: string;
  current_page: number;
  total_pages: number;
  location: string | null;
  reading_status: ReadingStatus;
  last_read_at: number;
  updated_at: number;
}

let schemaPromise: Promise<void> | null = null;

export const getGoogleDriveBindings = (): GoogleDriveBindings => env as GoogleDriveBindings;

export const getGoogleDriveCredentials = (): {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
} => {
  const bindings = getGoogleDriveBindings();
  if (!bindings.GOOGLE_CLIENT_ID || !bindings.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google Drive connection is not configured yet');
  }
  return {
    clientId: bindings.GOOGLE_CLIENT_ID,
    clientSecret: bindings.GOOGLE_CLIENT_SECRET,
    redirectUri: bindings.GOOGLE_OAUTH_REDIRECT_URI,
  };
};

const database = (): D1Database => {
  const db = getGoogleDriveBindings().DB;
  if (!db) throw new Error('Google Drive storage is not configured yet');
  return db;
};

const ensureSchema = async (): Promise<void> => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = database();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS google_drive_sessions (
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
          )`,
        )
        .run();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS google_drive_progress (
            google_sub TEXT NOT NULL,
            drive_file_id TEXT NOT NULL,
            current_page INTEGER NOT NULL,
            total_pages INTEGER NOT NULL,
            location TEXT,
            reading_status TEXT NOT NULL,
            last_read_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (google_sub, drive_file_id)
          )`,
        )
        .run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

export const getDriveSession = async (sessionId: string): Promise<DriveSessionRecord | null> => {
  await ensureSchema();
  return database()
    .prepare('SELECT * FROM google_drive_sessions WHERE session_id = ?')
    .bind(sessionId)
    .first<DriveSessionRecord>();
};

export const saveDriveSession = async (record: DriveSessionRecord): Promise<void> => {
  await ensureSchema();
  await database()
    .prepare(
      `INSERT INTO google_drive_sessions (
        session_id, google_sub, google_email, access_token_enc, refresh_token_enc,
        granted_scope, token_expires_at, folder_id, folder_url, folder_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        google_sub = excluded.google_sub,
        google_email = excluded.google_email,
        access_token_enc = excluded.access_token_enc,
        refresh_token_enc = excluded.refresh_token_enc,
        granted_scope = excluded.granted_scope,
        token_expires_at = excluded.token_expires_at,
        folder_id = excluded.folder_id,
        folder_url = excluded.folder_url,
        folder_name = excluded.folder_name,
        updated_at = excluded.updated_at`,
    )
    .bind(
      record.session_id,
      record.google_sub,
      record.google_email,
      record.access_token_enc,
      record.refresh_token_enc,
      record.granted_scope,
      record.token_expires_at,
      record.folder_id,
      record.folder_url,
      record.folder_name,
      record.created_at,
      record.updated_at,
    )
    .run();
};

export const updateDriveSessionTokens = async (
  sessionId: string,
  accessTokenEnc: string,
  refreshTokenEnc: string,
  expiresAt: number,
): Promise<void> => {
  await ensureSchema();
  await database()
    .prepare(
      `UPDATE google_drive_sessions
       SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, updated_at = ?
       WHERE session_id = ?`,
    )
    .bind(accessTokenEnc, refreshTokenEnc, expiresAt, Date.now(), sessionId)
    .run();
};

export const updateDriveFolder = async (
  sessionId: string,
  folderId: string,
  folderUrl: string,
  folderName: string,
): Promise<void> => {
  await ensureSchema();
  await database()
    .prepare(
      `UPDATE google_drive_sessions
       SET folder_id = ?, folder_url = ?, folder_name = ?, updated_at = ?
       WHERE session_id = ?`,
    )
    .bind(folderId, folderUrl, folderName, Date.now(), sessionId)
    .run();
};

export const deleteDriveSession = async (sessionId: string): Promise<void> => {
  await ensureSchema();
  await database()
    .prepare('DELETE FROM google_drive_sessions WHERE session_id = ?')
    .bind(sessionId)
    .run();
};

const toProgress = (row: DriveProgressRecord): GoogleDriveProgress => ({
  fileId: row.drive_file_id,
  current: row.current_page,
  total: row.total_pages,
  location: row.location,
  readingStatus: row.reading_status,
  lastReadAt: row.last_read_at,
  updatedAt: row.updated_at,
});

export const getDriveProgress = async (
  googleSub: string,
  fileId: string,
): Promise<GoogleDriveProgress | null> => {
  await ensureSchema();
  const row = await database()
    .prepare('SELECT * FROM google_drive_progress WHERE google_sub = ? AND drive_file_id = ?')
    .bind(googleSub, fileId)
    .first<DriveProgressRecord>();
  return row ? toProgress(row) : null;
};

export const listDriveProgress = async (googleSub: string): Promise<GoogleDriveProgress[]> => {
  await ensureSchema();
  const result = await database()
    .prepare('SELECT * FROM google_drive_progress WHERE google_sub = ? ORDER BY last_read_at DESC')
    .bind(googleSub)
    .all<DriveProgressRecord>();
  return (result.results ?? []).map(toProgress);
};

export const saveDriveProgress = async (
  googleSub: string,
  progress: GoogleDriveProgress,
): Promise<void> => {
  await ensureSchema();
  await database()
    .prepare(
      `INSERT INTO google_drive_progress (
        google_sub, drive_file_id, current_page, total_pages, location,
        reading_status, last_read_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_sub, drive_file_id) DO UPDATE SET
        current_page = CASE WHEN excluded.updated_at >= updated_at THEN excluded.current_page ELSE current_page END,
        total_pages = CASE WHEN excluded.updated_at >= updated_at THEN excluded.total_pages ELSE total_pages END,
        location = CASE WHEN excluded.updated_at >= updated_at THEN excluded.location ELSE location END,
        reading_status = CASE WHEN excluded.updated_at >= updated_at THEN excluded.reading_status ELSE reading_status END,
        last_read_at = MAX(last_read_at, excluded.last_read_at),
        updated_at = MAX(updated_at, excluded.updated_at)`,
    )
    .bind(
      googleSub,
      progress.fileId,
      progress.current,
      progress.total,
      progress.location,
      progress.readingStatus,
      progress.lastReadAt,
      progress.updatedAt,
    )
    .run();
};
