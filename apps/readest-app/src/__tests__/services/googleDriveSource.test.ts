import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book, BookConfig } from '@/types/book';
import {
  buildGoogleDriveConnectUrl,
  buildDriveChildrenUrl,
  DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
  isGoogleDriveCatalogBook,
  isSupportedDriveBook,
  deleteGoogleDriveBook,
  mergeGoogleDriveCatalog,
  mergeRemoteDriveProgress,
  parseGoogleDriveFolderId,
  prepareCachedGoogleDriveLibrary,
  uploadGoogleDriveBook,
  type GoogleDriveBookFile,
} from '@/services/googleDriveSource';

const makeBook = (overrides: Partial<Book>): Book => ({
  hash: 'local-book',
  format: 'EPUB',
  title: 'Local book',
  author: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const makeDriveFile = (
  id: string,
  name: string,
  overrides: Partial<GoogleDriveBookFile> = {},
): GoogleDriveBookFile => ({
  id,
  name,
  mimeType: 'application/epub+zip',
  size: 1_024,
  modifiedTime: '2026-08-23T12:00:00.000Z',
  relativePath: name,
  ...overrides,
});

describe('Google Drive book source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts the configured folder id from a shared folder link', () => {
    expect(
      parseGoogleDriveFolderId(
        'https://drive.google.com/drive/folders/1uq-I5OWJTI_FkCw34r8ugxssdls16sqH?usp=drive_link',
      ),
    ).toBe('1uq-I5OWJTI_FkCw34r8ugxssdls16sqH');
  });

  it('rejects links that do not point to a Drive folder', () => {
    expect(parseGoogleDriveFolderId('https://drive.google.com/file/d/abc/view')).toBeNull();
    expect(parseGoogleDriveFolderId('not a link')).toBeNull();
  });

  it('starts the single Google permission step for the fixed folder', () => {
    expect(buildGoogleDriveConnectUrl()).toBe('/api/google-drive/connect');
  });

  it('mirrors the fixed Drive catalog without sample books or duplicate downloaded books', () => {
    const demo = makeBook({
      hash: 'demo',
      url: 'https://cdn.readest.com/books/hamlet.epub',
      title: 'Hamlet',
    });
    const downloaded = makeBook({
      hash: 'downloaded',
      title: 'Downloaded',
      cloudSource: {
        provider: 'google-drive',
        fileId: 'file-1',
        folderId: 'folder',
        name: 'downloaded.epub',
      },
    });
    const staleCatalogBook = makeBook({
      hash: 'stale',
      title: 'Deleted from Drive',
      url: 'https://reader.example/api/google-drive/books/file-2',
      cloudSource: {
        provider: 'google-drive',
        fileId: 'file-2',
        folderId: 'folder',
        name: 'deleted.epub',
      },
    });

    const result = mergeGoogleDriveCatalog(
      [demo, makeBook({ hash: 'personal' }), downloaded, staleCatalogBook],
      [
        makeDriveFile('file-1', 'downloaded.epub'),
        makeDriveFile('file-3', 'Cloud Book.pdf', {
          mimeType: 'application/pdf',
          hasThumbnail: true,
          progress: {
            fileId: 'file-3',
            current: 25,
            total: 100,
            location: null,
            readingStatus: 'reading',
            lastReadAt: 30,
            updatedAt: 30,
          },
        }),
      ],
      'folder',
      'https://reader.example',
    );

    expect(result.map((book) => book.hash)).toContain('personal');
    expect(result.map((book) => book.hash)).toContain('downloaded');
    expect(result.some((book) => book.hash === 'demo')).toBe(false);
    expect(result.some((book) => book.hash === 'stale')).toBe(false);
    const cloudBook = result.find((book) => isGoogleDriveCatalogBook(book));
    expect(cloudBook).toMatchObject({
      title: 'Cloud Book',
      format: 'PDF',
      progress: [25, 100],
      readingStatus: 'reading',
      url: 'https://reader.example/api/google-drive/books/file-3',
      coverImageUrl: 'https://reader.example/api/google-drive/books/file-3/cover',
    });
  });

  it('adds, renames, and removes cloud-only books when the folder changes', () => {
    const first = mergeGoogleDriveCatalog(
      [],
      [makeDriveFile('one', 'First.epub'), makeDriveFile('two', 'Second.epub')],
      'folder',
      'https://reader.example',
    );
    const refreshed = mergeGoogleDriveCatalog(
      first,
      [makeDriveFile('one', 'Renamed.epub'), makeDriveFile('three', 'Third.epub')],
      'folder',
      'https://reader.example',
    );

    expect(
      refreshed
        .filter(isGoogleDriveCatalogBook)
        .map((book) => [book.cloudSource?.fileId, book.title]),
    ).toEqual([
      ['one', 'Renamed'],
      ['three', 'Third'],
    ]);
    expect(DEFAULT_GOOGLE_DRIVE_FOLDER_URL).toContain('/1uq-I5OWJTI_FkCw34r8ugxssdls16sqH');
  });

  it('hides stale cached copies of the same Drive path before the first refresh', () => {
    const cachedDriveBook = (hash: string, fileId: string, modifiedTime: string): Book =>
      makeBook({
        hash,
        title: 'Same book',
        url: `https://reader.example/api/google-drive/books/${fileId}`,
        cloudSource: {
          provider: 'google-drive',
          fileId,
          folderId: 'folder',
          name: 'Same book.epub',
          relativePath: 'Shelf/Same book.epub',
          modifiedTime,
        },
      });

    const result = prepareCachedGoogleDriveLibrary([
      cachedDriveBook('old', 'old-file', '2026-08-20T00:00:00.000Z'),
      makeBook({ hash: 'personal' }),
      cachedDriveBook('current', 'current-file', '2026-08-23T00:00:00.000Z'),
    ]);

    expect(result.map((book) => book.hash)).toEqual(['personal', 'current']);
  });

  it('lists only formats Readest can open', () => {
    expect(isSupportedDriveBook('book.epub')).toBe(true);
    expect(isSupportedDriveBook('book.PDF')).toBe(true);
    expect(isSupportedDriveBook('cover.jpg')).toBe(false);
  });

  it('builds a children query without widening beyond the selected folder', () => {
    const url = new URL(buildDriveChildrenUrl("folder'id"));
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    expect(url.searchParams.get('q')).toBe("'folder\\'id' in parents and trashed = false");
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(url.searchParams.get('fields')).toContain('hasThumbnail');
  });

  it('applies newer cloud progress while preserving local notes and settings', () => {
    const local: BookConfig = {
      progress: [2, 100],
      location: 'epubcfi(/6/2)',
      booknotes: [],
      viewSettings: { scrolled: true },
      cloudProgressUpdatedAt: 10,
      updatedAt: 50,
    };

    expect(
      mergeRemoteDriveProgress(local, {
        fileId: 'drive-file',
        current: 25,
        total: 100,
        location: 'epubcfi(/6/20)',
        readingStatus: 'reading',
        lastReadAt: 20,
        updatedAt: 20,
      }),
    ).toEqual({
      ...local,
      progress: [25, 100],
      location: 'epubcfi(/6/20)',
      cloudProgressUpdatedAt: 20,
    });
  });

  it('keeps newer local progress', () => {
    const local: BookConfig = {
      progress: [40, 100],
      location: 'epubcfi(/6/30)',
      cloudProgressUpdatedAt: 30,
      updatedAt: 30,
    };
    expect(
      mergeRemoteDriveProgress(local, {
        fileId: 'drive-file',
        current: 25,
        total: 100,
        location: 'epubcfi(/6/20)',
        readingStatus: 'reading',
        lastReadAt: 20,
        updatedAt: 20,
      }),
    ).toBe(local);
  });

  it('uploads a selected book into the configured Drive folder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          book: makeDriveFile('uploaded-file', 'Uploaded.epub'),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['book'], 'Uploaded.epub', { type: 'application/epub+zip' });

    await expect(uploadGoogleDriveBook(file)).resolves.toMatchObject({
      id: 'uploaded-file',
      name: 'Uploaded.epub',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/google-drive/books',
      expect.objectContaining({
        method: 'PUT',
        body: file,
        headers: expect.objectContaining({
          'X-Readest-File-Name': encodeURIComponent(file.name),
          'X-Readest-File-Size': String(file.size),
        }),
      }),
    );
  });

  it('deletes a Drive-backed book through its Drive file id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const book = makeBook({
      cloudSource: {
        provider: 'google-drive',
        fileId: 'drive-file',
        folderId: 'folder',
        name: 'Book.epub',
      },
    });

    await expect(deleteGoogleDriveBook(book)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/google-drive/books/drive-file', {
      method: 'DELETE',
    });
  });
});
