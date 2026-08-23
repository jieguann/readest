import type { GoogleDriveProgress } from '@/services/googleDriveSource';
import type { ReadingStatus } from '@/types/book';
import { getDriveAccess } from '@/server/googleDrive/service';
import { getDriveProgress, listDriveProgress, saveDriveProgress } from '@/server/googleDrive/store';

export const runtime = 'edge';

const READING_STATUSES = new Set<ReadingStatus>(['unread', 'reading', 'finished', 'abandoned']);

export async function GET(request: Request): Promise<Response> {
  try {
    const { session } = await getDriveAccess(request);
    const fileId = new URL(request.url).searchParams.get('fileId');
    return Response.json(
      fileId
        ? { progress: await getDriveProgress(session.google_sub, fileId) }
        : { progress: await listDriveProgress(session.google_sub) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load reading progress';
    return Response.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { session } = await getDriveAccess(request);
    const body = (await request.json()) as Partial<GoogleDriveProgress>;
    if (
      !body.fileId ||
      typeof body.current !== 'number' ||
      typeof body.total !== 'number' ||
      typeof body.updatedAt !== 'number' ||
      !body.readingStatus ||
      !READING_STATUSES.has(body.readingStatus)
    ) {
      return Response.json({ error: 'Reading progress is invalid' }, { status: 400 });
    }
    const progress: GoogleDriveProgress = {
      fileId: body.fileId,
      current: Math.max(0, Math.round(body.current)),
      total: Math.max(1, Math.round(body.total)),
      location: typeof body.location === 'string' ? body.location : null,
      readingStatus: body.readingStatus,
      lastReadAt: Date.now(),
      updatedAt: body.updatedAt,
    };
    await saveDriveProgress(session.google_sub, progress);
    return Response.json({ saved: true, progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save reading progress';
    return Response.json({ error: message }, { status: 401 });
  }
}
