import { describe, expect, it } from 'vitest';
import type { Book, BookConfig } from '@/types/book';
import {
  buildGoogleDriveConnectUrl,
  buildDriveChildrenUrl,
  DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
  isGoogleDriveCatalogBook,
  isSupportedDriveBook,
  mergeGoogleDriveCatalog,
  mergeRemoteDriveProgress,
  parseGoogleDriveFolderId,
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
});
