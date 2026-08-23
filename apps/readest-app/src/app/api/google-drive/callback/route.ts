import { DEFAULT_GOOGLE_DRIVE_FOLDER_URL } from '@/services/googleDriveSource';
import { encryptToken } from '@/server/googleDrive/crypto';
import {
  clearCookie,
  DRIVE_OAUTH_STATE_COOKIE,
  DRIVE_OAUTH_VERIFIER_COOKIE,
  DRIVE_PENDING_FOLDER_COOKIE,
  DRIVE_SESSION_COOKIE,
  getOrCreateSessionId,
  readCookie,
  secureCookie,
} from '@/server/googleDrive/cookies';
import { resolveFolderLink } from '@/server/googleDrive/service';
import {
  getDriveSession,
  getGoogleDriveCredentials,
  saveDriveSession,
} from '@/server/googleDrive/store';

export const runtime = 'edge';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error_description?: string;
}

interface UserInfo {
  sub?: string;
  email?: string;
}

const libraryRedirect = (request: Request, result: 'connected' | 'error', message?: string) => {
  const url = new URL('/library', request.url);
  url.searchParams.set('drive', result);
  if (message) url.searchParams.set('message', message);
  return url;
};

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  const expectedState = readCookie(request, DRIVE_OAUTH_STATE_COOKIE);
  const verifier = readCookie(request, DRIVE_OAUTH_VERIFIER_COOKIE);
  const requestedFolderUrl =
    readCookie(request, DRIVE_PENDING_FOLDER_COOKIE) ?? DEFAULT_GOOGLE_DRIVE_FOLDER_URL;
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie(DRIVE_OAUTH_STATE_COOKIE));
  headers.append('Set-Cookie', clearCookie(DRIVE_OAUTH_VERIFIER_COOKIE));
  headers.append('Set-Cookie', clearCookie(DRIVE_PENDING_FOLDER_COOKIE));

  try {
    if (!code || !state || !expectedState || state !== expectedState || !verifier) {
      throw new Error('Google Drive sign-in could not be verified');
    }
    const {
      clientId,
      clientSecret,
      redirectUri: configuredRedirectUri,
    } = getGoogleDriveCredentials();
    const redirectUri = configuredRedirectUri || `${requestUrl.origin}/api/google-drive/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !tokens.access_token) {
      throw new Error(tokens.error_description || 'Google Drive sign-in failed');
    }

    const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = (await userResponse.json()) as UserInfo;
    if (!userResponse.ok || !user.sub) throw new Error('Could not identify the Google account');

    const { sessionId } = getOrCreateSessionId(request);
    const existing = await getDriveSession(sessionId);
    const refreshTokenEnc = tokens.refresh_token
      ? await encryptToken(tokens.refresh_token, clientSecret)
      : existing?.refresh_token_enc;
    if (!refreshTokenEnc) throw new Error('Google did not return a long-lived connection');

    const folder = await resolveFolderLink(requestedFolderUrl, tokens.access_token);

    const now = Date.now();
    await saveDriveSession({
      session_id: sessionId,
      google_sub: user.sub,
      google_email: user.email ?? '',
      access_token_enc: await encryptToken(tokens.access_token, clientSecret),
      refresh_token_enc: refreshTokenEnc,
      granted_scope: tokens.scope ?? '',
      token_expires_at: now + (tokens.expires_in ?? 3_600) * 1_000,
      folder_id: folder.id,
      folder_url: folder.url,
      folder_name: folder.name,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    headers.append('Set-Cookie', secureCookie(DRIVE_SESSION_COOKIE, sessionId, 31_536_000));
    headers.set('Location', libraryRedirect(request, 'connected').toString());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Drive sign-in failed';
    headers.set('Location', libraryRedirect(request, 'error', message).toString());
    return new Response(null, { status: 302, headers });
  }
}
