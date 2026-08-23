import { clearCookie, DRIVE_SESSION_COOKIE, readCookie } from '@/server/googleDrive/cookies';
import { deleteDriveSession } from '@/server/googleDrive/store';

export const runtime = 'edge';

export async function POST(request: Request): Promise<Response> {
  const sessionId = readCookie(request, DRIVE_SESSION_COOKIE);
  if (sessionId) await deleteDriveSession(sessionId);
  return Response.json(
    { disconnected: true },
    { headers: { 'Set-Cookie': clearCookie(DRIVE_SESSION_COOKIE) } },
  );
}
