import {
  buildDriveChildrenUrl,
  DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
  GOOGLE_DRIVE_FOLDER_MIME,
  isSupportedDriveBook,
  parseGoogleDriveFolderId,
  type GoogleDriveBookFile,
} from '@/services/googleDriveSource';
import { decryptToken, encryptToken } from './crypto';
import { DRIVE_SESSION_COOKIE, readCookie } from './cookies';
import {
  getDriveSession,
  getGoogleDriveCredentials,
  updateDriveSessionTokens,
  type DriveSessionRecord,
} from './store';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const MAX_DRIVE_ITEMS = 2_000;
const MAX_FOLDER_DEPTH = 16;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DriveFileResponse {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  hasThumbnail?: boolean;
  thumbnailLink?: string;
  capabilities?: { canDownload?: boolean };
  trashed?: boolean;
}

interface DriveListResponse {
  nextPageToken?: string;
  files?: DriveFileResponse[];
  error?: { message?: string };
}

const driveFetch = async <T>(url: string, accessToken: string): Promise<T> => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || 'Google Drive request failed');
  return body;
};

const driveErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message || 'Google Drive request failed';
  } catch {
    return 'Google Drive request failed';
  }
};

const refreshAccessToken = async (
  session: DriveSessionRecord,
  clientId: string,
  clientSecret: string,
): Promise<string> => {
  const refreshToken = await decryptToken(session.refresh_token_enc, clientSecret);
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = (await response.json()) as TokenResponse;
  if (!response.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || 'Google Drive sign-in expired');
  }
  const expiresAt = Date.now() + (tokens.expires_in ?? 3_600) * 1_000;
  await updateDriveSessionTokens(
    session.session_id,
    await encryptToken(tokens.access_token, clientSecret),
    session.refresh_token_enc,
    expiresAt,
  );
  return tokens.access_token;
};

export const getDriveAccess = async (
  request: Request,
): Promise<{ session: DriveSessionRecord; accessToken: string }> => {
  const sessionId = readCookie(request, DRIVE_SESSION_COOKIE);
  if (!sessionId) throw new Error('Connect Google Drive first');
  const session = await getDriveSession(sessionId);
  if (!session) throw new Error('Connect Google Drive first');
  const { clientId, clientSecret } = getGoogleDriveCredentials();
  const accessToken =
    session.token_expires_at > Date.now() + 60_000
      ? await decryptToken(session.access_token_enc, clientSecret)
      : await refreshAccessToken(session, clientId, clientSecret);
  return { session, accessToken };
};

export const getFolderMetadata = async (
  folderId: string,
  accessToken: string,
): Promise<{ id: string; name: string }> => {
  const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(folderId)}`);
  url.searchParams.set('fields', 'id,name,mimeType,trashed');
  url.searchParams.set('supportsAllDrives', 'true');
  const folder = await driveFetch<DriveFileResponse & { trashed?: boolean }>(
    url.toString(),
    accessToken,
  );
  if (folder.trashed || folder.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
    throw new Error('That link is not an accessible Google Drive folder');
  }
  return { id: folder.id, name: folder.name };
};

export const resolveFolderLink = async (
  folderUrl: string,
  accessToken: string,
): Promise<{ id: string; name: string; url: string }> => {
  const id = parseGoogleDriveFolderId(folderUrl);
  if (!id) throw new Error('Paste a valid Google Drive folder link');
  const folder = await getFolderMetadata(id, accessToken);
  return { ...folder, url: folderUrl };
};

const listFolderPage = async (
  folderId: string,
  accessToken: string,
  pageToken?: string,
): Promise<DriveListResponse> =>
  driveFetch<DriveListResponse>(buildDriveChildrenUrl(folderId, pageToken), accessToken);

export const listDriveBooks = async (
  folderId: string,
  accessToken: string,
): Promise<GoogleDriveBookFile[]> => {
  const books: GoogleDriveBookFile[] = [];
  const queue: Array<{ id: string; path: string; depth: number }> = [
    { id: folderId, path: '', depth: 0 },
  ];
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_DRIVE_ITEMS) {
    const folder = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const page = await listFolderPage(folder.id, accessToken, pageToken);
      for (const file of page.files ?? []) {
        inspected += 1;
        if (inspected > MAX_DRIVE_ITEMS) break;
        const relativePath = folder.path ? `${folder.path}/${file.name}` : file.name;
        if (file.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
          if (folder.depth < MAX_FOLDER_DEPTH) {
            queue.push({ id: file.id, path: relativePath, depth: folder.depth + 1 });
          }
        } else if (file.capabilities?.canDownload !== false && isSupportedDriveBook(file.name)) {
          books.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType || 'application/octet-stream',
            size: file.size ? Number(file.size) : null,
            modifiedTime: file.modifiedTime ?? null,
            relativePath,
            hasThumbnail: file.hasThumbnail === true,
          });
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken && inspected < MAX_DRIVE_ITEMS);
  }

  return books;
};

const getFileMetadata = async (fileId: string, accessToken: string): Promise<DriveFileResponse> => {
  const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`);
  url.searchParams.set(
    'fields',
    'id,name,mimeType,size,modifiedTime,parents,trashed,hasThumbnail,thumbnailLink,capabilities(canDownload)',
  );
  url.searchParams.set('supportsAllDrives', 'true');
  return driveFetch<DriveFileResponse>(url.toString(), accessToken);
};

export const assertFileInFolder = async (
  fileId: string,
  folderId: string,
  accessToken: string,
): Promise<DriveFileResponse> => {
  const file = await getFileMetadata(fileId, accessToken);
  if (!isSupportedDriveBook(file.name) || file.capabilities?.canDownload === false) {
    throw new Error('This file cannot be opened as a book');
  }

  const pending = [...(file.parents ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0 && visited.size < 64) {
    const parentId = pending.shift()!;
    if (parentId === folderId) return file;
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    const parent = await getFileMetadata(parentId, accessToken);
    pending.push(...(parent.parents ?? []));
  }
  throw new Error('That book is outside the configured Drive folder');
};

export const driveMediaUrl = (fileId: string): string =>
  `${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

const escapeDriveQueryLiteral = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const findRootBookByName = async (
  folderId: string,
  name: string,
  accessToken: string,
): Promise<DriveFileResponse | null> => {
  const url = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);
  url.searchParams.set(
    'q',
    `'${escapeDriveQueryLiteral(folderId)}' in parents and name = '${escapeDriveQueryLiteral(name)}' and trashed = false`,
  );
  url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime,parents,hasThumbnail)');
  url.searchParams.set('pageSize', '2');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  const result = await driveFetch<DriveListResponse>(url.toString(), accessToken);
  return (
    result.files?.find(
      (file) => file.mimeType !== GOOGLE_DRIVE_FOLDER_MIME && isSupportedDriveBook(file.name),
    ) ?? null
  );
};

const toDriveBookFile = (file: DriveFileResponse): GoogleDriveBookFile => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType || 'application/octet-stream',
  size: file.size ? Number(file.size) : null,
  modifiedTime: file.modifiedTime ?? null,
  relativePath: file.name,
  hasThumbnail: file.hasThumbnail === true,
});

export const uploadDriveBook = async (
  folderId: string,
  name: string,
  mimeType: string,
  data: ArrayBuffer,
  accessToken: string,
): Promise<GoogleDriveBookFile> => {
  if (!isSupportedDriveBook(name)) throw new Error('This file cannot be opened as a book');
  const existing = await findRootBookByName(folderId, name, accessToken);
  const uploadUrl = new URL(
    existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}`
      : 'https://www.googleapis.com/upload/drive/v3/files',
  );
  uploadUrl.searchParams.set('uploadType', 'resumable');
  uploadUrl.searchParams.set('supportsAllDrives', 'true');
  uploadUrl.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime,parents,hasThumbnail');
  const initiation = await fetch(uploadUrl.toString(), {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(data.byteLength),
    },
    body: JSON.stringify(existing ? { name } : { name, parents: [folderId] }),
  });
  if (!initiation.ok) throw new Error(await driveErrorMessage(initiation));
  const sessionUrl = initiation.headers.get('Location');
  if (!sessionUrl) throw new Error('Google Drive did not start the upload');

  const uploaded = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(data.byteLength),
    },
    body: data,
  });
  if (!uploaded.ok) throw new Error(await driveErrorMessage(uploaded));
  return toDriveBookFile((await uploaded.json()) as DriveFileResponse);
};

export const trashDriveBook = async (
  fileId: string,
  folderId: string,
  accessToken: string,
): Promise<void> => {
  await assertFileInFolder(fileId, folderId, accessToken);
  const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
  });
  if (!response.ok) throw new Error(await driveErrorMessage(response));
};

export const getConfiguredFolder = (
  session: DriveSessionRecord,
): { id: string; url: string; name: string } => {
  const id = parseGoogleDriveFolderId(DEFAULT_GOOGLE_DRIVE_FOLDER_URL);
  if (!id) throw new Error('Google Drive folder is not configured');
  return {
    id,
    url: DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
    name: session.folder_id === id ? (session.folder_name ?? 'Readest Books') : 'Readest Books',
  };
};
