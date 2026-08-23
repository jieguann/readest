import {
  assertFileInFolder,
  driveMediaUrl,
  getConfiguredFolder,
  getDriveAccess,
} from '@/server/googleDrive/service';

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
