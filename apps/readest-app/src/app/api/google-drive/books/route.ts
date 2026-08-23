import type { GoogleDriveProgress } from '@/services/googleDriveSource';
import {
  getConfiguredFolder,
  getDriveAccess,
  listDriveBooks,
  resolveFolderLink,
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
