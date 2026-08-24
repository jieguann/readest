import {
  GOOGLE_DRIVE_MANAGE_SCOPE,
  isSupportedDriveBook,
  type GoogleDriveProgress,
} from '@/services/googleDriveSource';
import {
  getConfiguredFolder,
  getDriveAccess,
  listDriveBooks,
  resolveFolderLink,
  uploadDriveBook,
} from '@/server/googleDrive/service';
import { listDriveProgress, updateDriveFolder } from '@/server/googleDrive/store';

export const runtime = 'edge';

const responseForFolder = async (
  session: Awaited<ReturnType<typeof getDriveAccess>>['session'],
  accessToken: string,
) => {
  const folder = getConfiguredFolder(session);
  const [books, progress] = await Promise.all([
    listDriveBooks(folder.id, accessToken),
    listDriveProgress(session.google_sub),
  ]);
  const progressByFile = new Map<string, GoogleDriveProgress>(
    progress.map((item) => [item.fileId, item]),
  );
  return {
    folderId: folder.id,
    folderName: folder.name,
    folderUrl: folder.url,
    books: books
      .map((book) => ({ ...book, progress: progressByFile.get(book.id) }))
      .sort((left, right) => {
        const recent = (right.progress?.lastReadAt ?? 0) - (left.progress?.lastReadAt ?? 0);
        return recent || left.relativePath.localeCompare(right.relativePath);
      }),
  };
};

export async function GET(request: Request): Promise<Response> {
  try {
    const { session, accessToken } = await getDriveAccess(request);
    return Response.json(await responseForFolder(session, accessToken), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Google Drive books';
    const status = message.includes('Connect Google Drive') ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { session, accessToken } = await getDriveAccess(request);
    const body = (await request.json()) as { folderUrl?: string };
    const folder = await resolveFolderLink(body.folderUrl ?? '', accessToken);
    await updateDriveFolder(session.session_id, folder.id, folder.url, folder.name);
    return Response.json(
      await responseForFolder(
        {
          ...session,
          folder_id: folder.id,
          folder_url: folder.url,
          folder_name: folder.name,
        },
        accessToken,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not use that Drive folder';
    const status = message.includes('Connect Google Drive') ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const { session, accessToken } = await getDriveAccess(request);
    if (!session.granted_scope.split(/\s+/).includes(GOOGLE_DRIVE_MANAGE_SCOPE)) {
      return Response.json(
        { error: 'Reconnect Google Drive to allow uploads and deletions', reconnect: true },
        { status: 403 },
      );
    }
    const encodedName = request.headers.get('X-Readest-File-Name');
    if (!encodedName) throw new Error('Choose a book file to upload');
    let name: string;
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      throw new Error('That book filename is invalid');
    }
    if (!name || name.includes('/') || name.includes('\\') || !isSupportedDriveBook(name)) {
      throw new Error('This file cannot be opened as a book');
    }
    const data = await request.arrayBuffer();
    const expectedSize = Number(request.headers.get('X-Readest-File-Size'));
    if (Number.isFinite(expectedSize) && expectedSize !== data.byteLength) {
      throw new Error('The selected book was not uploaded completely');
    }
    const folder = getConfiguredFolder(session);
    const book = await uploadDriveBook(
      folder.id,
      name,
      request.headers.get('Content-Type') || 'application/octet-stream',
      data,
      accessToken,
    );
    return Response.json({ book }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not upload this book';
    const status = message.includes('Connect Google Drive') ? 401 : 400;
    return Response.json({ error: message }, { status });
  }
}
