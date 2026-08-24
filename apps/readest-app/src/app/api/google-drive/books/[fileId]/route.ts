import {
  assertFileInFolder,
  driveMediaUrl,
  getConfiguredFolder,
  getDriveAccess,
  trashDriveBook,
} from '@/server/googleDrive/service';
import { GOOGLE_DRIVE_MANAGE_SCOPE } from '@/services/googleDriveSource';

export const runtime = 'edge';

const safeDownloadName = (value: string): string => value.replace(/[\r\n"\\]/g, '_');

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await context.params;
    const { session, accessToken } = await getDriveAccess(request);
    const folder = getConfiguredFolder(session);
    const file = await assertFileInFolder(fileId, folder.id, accessToken);
    const upstream = await fetch(driveMediaUrl(fileId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!upstream.ok || !upstream.body)
      throw new Error('Google Drive could not download this book');
    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') || file.mimeType);
    headers.set('Content-Disposition', `attachment; filename="${safeDownloadName(file.name)}"`);
    headers.set('Cache-Control', 'private, no-store');
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not download this book';
    const status = message.includes('Connect Google Drive') ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await context.params;
    const { session, accessToken } = await getDriveAccess(request);
    if (!session.granted_scope.split(/\s+/).includes(GOOGLE_DRIVE_MANAGE_SCOPE)) {
      return Response.json(
        { error: 'Reconnect Google Drive to allow uploads and deletions', reconnect: true },
        { status: 403 },
      );
    }
    const folder = getConfiguredFolder(session);
    await trashDriveBook(fileId, folder.id, accessToken);
    return Response.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete this book';
    const status = message.includes('Connect Google Drive') ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}
