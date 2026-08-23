import { createPkceChallenge, randomToken } from '@/server/googleDrive/crypto';
import { parseGoogleDriveFolderId } from '@/services/googleDriveSource';
import {
  DRIVE_OAUTH_STATE_COOKIE,
  DRIVE_OAUTH_VERIFIER_COOKIE,
  DRIVE_PENDING_FOLDER_COOKIE,
  secureCookie,
} from '@/server/googleDrive/cookies';
import { getGoogleDriveCredentials } from '@/server/googleDrive/store';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  try {
    const { clientId, redirectUri: configuredRedirectUri } = getGoogleDriveCredentials();
    const requestUrl = new URL(request.url);
    const origin = requestUrl.origin;
    const folderUrl = requestUrl.searchParams.get('folderUrl')?.trim() ?? '';
    if (!parseGoogleDriveFolderId(folderUrl)) {
      return Response.json({ error: 'Paste a valid Google Drive folder link' }, { status: 400 });
    }
    const redirectUri = configuredRedirectUri || `${origin}/api/google-drive/callback`;
    const state = randomToken();
    const verifier = randomToken(48);
    const challenge = await createPkceChallenge(verifier);
    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set(
      'scope',
      'openid email https://www.googleapis.com/auth/drive.readonly',
    );
    authorizationUrl.searchParams.set('access_type', 'offline');
    authorizationUrl.searchParams.set('prompt', 'consent');
    authorizationUrl.searchParams.set('include_granted_scopes', 'true');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    const headers = new Headers({ Location: authorizationUrl.toString() });
    headers.append('Set-Cookie', secureCookie(DRIVE_OAUTH_STATE_COOKIE, state, 600));
    headers.append('Set-Cookie', secureCookie(DRIVE_OAUTH_VERIFIER_COOKIE, verifier, 600));
    headers.append('Set-Cookie', secureCookie(DRIVE_PENDING_FOLDER_COOKIE, folderUrl, 600));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Google Drive connection failed' },
      { status: 503 },
    );
  }
}
