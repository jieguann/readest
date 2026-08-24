import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/googleDrive/cookies', () => ({
  DRIVE_SESSION_COOKIE: 'drive-session',
  readCookie: vi.fn(),
}));

vi.mock('@/server/googleDrive/crypto', () => ({
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
}));

vi.mock('@/server/googleDrive/store', () => ({
  getDriveSession: vi.fn(),
  getGoogleDriveCredentials: vi.fn(),
  updateDriveSessionTokens: vi.fn(),
}));

import { trashDriveBook, uploadDriveBook } from '@/server/googleDrive/service';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

describe('Google Drive book mutations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new book in the fixed folder with a resumable upload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { Location: 'https://upload.example/session' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'new-file',
          name: 'New Book.epub',
          mimeType: 'application/epub+zip',
          size: '4',
          modifiedTime: '2026-08-24T00:00:00.000Z',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const data = new TextEncoder().encode('book').buffer;

    await expect(
      uploadDriveBook('folder-id', 'New Book.epub', 'application/epub+zip', data, 'token'),
    ).resolves.toMatchObject({
      id: 'new-file',
      name: 'New Book.epub',
      relativePath: 'New Book.epub',
    });

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: 'New Book.epub',
      parents: ['folder-id'],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://upload.example/session',
      expect.objectContaining({ method: 'PUT', body: data }),
    );
  });

  it('replaces a same-name root book instead of creating a duplicate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            {
              id: 'existing-file',
              name: 'Same.epub',
              mimeType: 'application/epub+zip',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { Location: 'https://upload.example/existing-session' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'existing-file',
          name: 'Same.epub',
          mimeType: 'application/epub+zip',
          size: '4',
          modifiedTime: '2026-08-24T00:00:00.000Z',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await uploadDriveBook(
      'folder-id',
      'Same.epub',
      'application/epub+zip',
      new TextEncoder().encode('book').buffer,
      'token',
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/existing-file');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH' });
  });

  it('moves a configured-folder book to Drive trash', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'drive-file',
          name: 'Book.epub',
          mimeType: 'application/epub+zip',
          parents: ['folder-id'],
          capabilities: { canDownload: true },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'drive-file', trashed: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(trashDriveBook('drive-file', 'folder-id', 'token')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/drive-file?'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ trashed: true }),
      }),
    );
  });
});
