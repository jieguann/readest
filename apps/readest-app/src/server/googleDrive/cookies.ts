import { randomToken } from './crypto';

export const DRIVE_SESSION_COOKIE = 'readest_drive_session';
export const DRIVE_OAUTH_STATE_COOKIE = 'readest_drive_oauth_state';
export const DRIVE_OAUTH_VERIFIER_COOKIE = 'readest_drive_oauth_verifier';
export const DRIVE_PENDING_FOLDER_COOKIE = 'readest_drive_pending_folder';

export const readCookie = (request: Request, name: string): string | null => {
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
};

export const secureCookie = (name: string, value: string, maxAge: number): string =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const clearCookie = (name: string): string =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export const getOrCreateSessionId = (request: Request): { sessionId: string; created: boolean } => {
  const existing = readCookie(request, DRIVE_SESSION_COOKIE);
  return existing
    ? { sessionId: existing, created: false }
    : { sessionId: randomToken(), created: true };
};
