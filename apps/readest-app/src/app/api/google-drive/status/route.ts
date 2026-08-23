import { DEFAULT_GOOGLE_DRIVE_FOLDER_URL } from '@/services/googleDriveSource';
import { DRIVE_SESSION_COOKIE, readCookie } from '@/server/googleDrive/cookies';
import { getDriveSession, getGoogleDriveCredentials } from '@/server/googleDrive/store';

export const runtime = 'edge';

export async function GET(request: Request): Promise<Response> {
  try {
    getGoogleDriveCredentials();
    const sessionId = readCookie(request, DRIVE_SESSION_COOKIE);
    const session = sessionId ? await getDriveSession(sessionId) : null;
    return Response.json(
      session
        ? {
            connected: true,
            configured: true,
            email: session.google_email,
            folderUrl: session.folder_url ?? DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
            folderName: session.folder_name ?? 'Readest Books',
          }
        : { connected: false, configured: true, folderUrl: DEFAULT_GOOGLE_DRIVE_FOLDER_URL },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        connected: false,
        configured: false,
        folderUrl: DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
        error: error instanceof Error ? error.message : 'Google Drive is not configured',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
