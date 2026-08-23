import type { Book, BookConfig, ReadingStatus } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

export const DEFAULT_GOOGLE_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1uq-I5OWJTI_FkCw34r8ugxssdls16sqH?usp=drive_link';

export const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface GoogleDriveCloudSource {
  provider: 'google-drive';
  fileId: string;
  folderId: string;
  name: string;
  modifiedTime?: string;
}

export interface GoogleDriveBookFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  relativePath: string;
  progress?: GoogleDriveProgress;
}

export interface GoogleDriveProgress {
  fileId: string;
  current: number;
  total: number;
  location: string | null;
  readingStatus: ReadingStatus;
  lastReadAt: number;
  updatedAt: number;
}

export interface GoogleDriveStatus {
  connected: boolean;
  configured: boolean;
  email?: string;
  folderUrl?: string;
  folderName?: string;
  error?: string;
}

export const parseGoogleDriveFolderId = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (url.hostname !== 'drive.google.com') return null;
    const match = url.pathname.match(/^\/drive\/folders\/([A-Za-z0-9_-]+)(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

export const buildGoogleDriveConnectUrl = (folderUrl: string): string => {
  const params = new URLSearchParams({ folderUrl });
  return `/api/google-drive/connect?${params.toString()}`;
};

export const isSupportedDriveBook = (name: string): boolean => {
  const extension = name.split('.').pop()?.toLowerCase();
  return !!extension && SUPPORTED_BOOK_EXTS.includes(extension);
};

const escapeDriveQueryLiteral = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const buildDriveChildrenUrl = (folderId: string, pageToken?: string): string => {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set(
    'q',
    `'${escapeDriveQueryLiteral(folderId)}' in parents and trashed = false`,
  );
  url.searchParams.set(
    'fields',
    'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,capabilities(canDownload))',
  );
  url.searchParams.set('pageSize', '1000');
  url.searchParams.set('orderBy', 'folder,name_natural');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  return url.toString();
};

export const mergeRemoteDriveProgress = (
  local: BookConfig,
  remote: GoogleDriveProgress,
): BookConfig => {
  if ((local.cloudProgressUpdatedAt ?? 0) >= remote.updatedAt) return local;
  return {
    ...local,
    progress: [remote.current, remote.total],
    location: remote.location ?? local.location,
    cloudProgressUpdatedAt: remote.updatedAt,
  };
};

const readJson = async <T>(response: Response): Promise<T> => {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Google Drive request failed');
  return body;
};

export const getGoogleDriveStatus = async (): Promise<GoogleDriveStatus> =>
  readJson<GoogleDriveStatus>(await fetch('/api/google-drive/status', { cache: 'no-store' }));

export const getGoogleDriveBooks = async (): Promise<{
  folderId: string;
  folderName: string;
  folderUrl: string;
  books: GoogleDriveBookFile[];
}> => readJson(await fetch('/api/google-drive/books', { cache: 'no-store' }));

export const configureGoogleDriveFolder = async (folderUrl: string) =>
  readJson<{
    folderId: string;
    folderName: string;
    folderUrl: string;
    books: GoogleDriveBookFile[];
  }>(
    await fetch('/api/google-drive/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderUrl }),
    }),
  );

export const disconnectGoogleDrive = async (): Promise<void> => {
  await readJson(await fetch('/api/google-drive/disconnect', { method: 'POST' }));
};

export const downloadGoogleDriveBook = async (
  book: GoogleDriveBookFile,
  folderId: string,
): Promise<{ file: File; cloudSource: GoogleDriveCloudSource }> => {
  const response = await fetch(`/api/google-drive/books/${encodeURIComponent(book.id)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    let message = 'Could not download this book';
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // The upstream Drive response may not be JSON.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  return {
    file: new File([blob], book.name, { type: book.mimeType, lastModified: Date.now() }),
    cloudSource: {
      provider: 'google-drive',
      fileId: book.id,
      folderId,
      name: book.name,
      modifiedTime: book.modifiedTime ?? undefined,
    },
  };
};

export const pullGoogleDriveProgress = async (
  envConfig: EnvConfigType,
  book: Book,
): Promise<void> => {
  if (book.cloudSource?.provider !== 'google-drive') return;
  const response = await fetch(
    `/api/google-drive/progress?fileId=${encodeURIComponent(book.cloudSource.fileId)}`,
    { cache: 'no-store' },
  );
  if (response.status === 401 || response.status === 404) return;
  const { progress } = await readJson<{ progress: GoogleDriveProgress | null }>(response);
  if (!progress) return;

  const appService = await envConfig.getAppService();
  const settings = useSettingsStore.getState().settings;
  const localConfig = await appService.loadBookConfig(book, settings);
  const merged = mergeRemoteDriveProgress(localConfig, progress);
  if (merged === localConfig) return;

  const updatedBook: Book = {
    ...book,
    progress: merged.progress,
    readingStatus: progress.readingStatus,
    readingStatusUpdatedAt: progress.updatedAt,
    updatedAt: progress.lastReadAt,
  };
  await appService.saveBookConfig(updatedBook, merged, settings);
  const { library, setLibrary } = useLibraryStore.getState();
  setLibrary(library.map((item) => (item.hash === book.hash ? updatedBook : item)));
};

export const pushGoogleDriveProgress = async (
  book: Book,
  config: BookConfig,
): Promise<number | null> => {
  if (book.cloudSource?.provider !== 'google-drive' || !config.progress) return null;
  const updatedAt = config.cloudProgressUpdatedAt ?? Date.now();
  const [current, total] = config.progress;
  const readingStatus: ReadingStatus =
    book.readingStatus ?? (current >= total ? 'finished' : current > 0 ? 'reading' : 'unread');
  const response = await fetch('/api/google-drive/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId: book.cloudSource.fileId,
      current,
      total,
      location: config.location ?? null,
      readingStatus,
      updatedAt,
    }),
  });
  if (response.status === 401) return null;
  await readJson(response);
  return updatedAt;
};
