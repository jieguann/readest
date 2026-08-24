import {
  assertFileInFolder,
  getConfiguredFolder,
  getDriveAccess,
} from '@/server/googleDrive/service';

export const runtime = 'edge';

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await context.params;
    const { session, accessToken } = await getDriveAccess(request);
    const folder = getConfiguredFolder(session);
    const file = await assertFileInFolder(fileId, folder.id, accessToken);
    if (!file.hasThumbnail || !file.thumbnailLink) {
      return Response.json({ error: 'This book does not have a Drive thumbnail' }, { status: 404 });
    }

    const upstream = await fetch(file.thumbnailLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!upstream.ok || !upstream.body) {
      throw new Error('Google Drive could not load this cover');
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=3600');
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load this cover';
    const status = message.includes('Connect Google Drive') ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}
