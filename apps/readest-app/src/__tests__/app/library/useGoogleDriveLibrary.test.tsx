import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';

const appService = vi.hoisted(() => ({
  saveLibraryBooks: vi.fn(async () => {}),
}));

const envConfig = vi.hoisted(() => ({
  getAppService: vi.fn(async () => appService),
}));

const driveMocks = vi.hoisted(() => ({
  getGoogleDriveStatus: vi.fn<() => Promise<{ connected: boolean; configured: boolean }>>(),
  getGoogleDriveBooks: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig }),
}));

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: () => true,
  isTauriAppPlatform: () => false,
}));

vi.mock('@/services/googleDriveSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/googleDriveSource')>()),
  ...driveMocks,
}));

import { useGoogleDriveLibrary } from '@/app/library/hooks/useGoogleDriveLibrary';
import { useLibraryStore } from '@/store/libraryStore';

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: hash,
  author: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('fixed Google Drive library startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveMocks.getGoogleDriveStatus.mockImplementation(() => new Promise<never>(() => {}));
    driveMocks.getGoogleDriveBooks.mockReset();
    useLibraryStore.setState({
      library: [
        makeBook('demo', { url: 'https://cdn.readest.com/books/hamlet.epub' }),
        makeBook('stale-drive-copy', {
          url: 'https://reader.example/api/google-drive/books/old-file',
          cloudSource: {
            provider: 'google-drive',
            fileId: 'old-file',
            folderId: 'folder',
            name: 'Same book.epub',
            modifiedTime: '2026-08-20T00:00:00.000Z',
          },
        }),
        makeBook('current-drive-copy', {
          url: 'https://reader.example/api/google-drive/books/current-file',
          cloudSource: {
            provider: 'google-drive',
            fileId: 'current-file',
            folderId: 'folder',
            name: 'Same book.epub',
            modifiedTime: '2026-08-23T00:00:00.000Z',
          },
        }),
        makeBook('personal'),
      ],
      libraryLoaded: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('removes cached demo books before waiting for Drive', async () => {
    const { unmount } = renderHook(() => useGoogleDriveLibrary(true));

    expect(useLibraryStore.getState().library.map((book) => book.hash)).toEqual([
      'current-drive-copy',
      'personal',
    ]);
    await waitFor(() => expect(appService.saveLibraryBooks).toHaveBeenCalled());
    unmount();
  });

  it('replaces stale cached catalog rows after a connected refresh', async () => {
    driveMocks.getGoogleDriveStatus.mockResolvedValue({ connected: true, configured: true });
    driveMocks.getGoogleDriveBooks.mockResolvedValue({
      folderId: 'folder',
      folderName: 'Readest Books',
      folderUrl: 'https://drive.google.com/drive/folders/folder',
      books: [
        {
          id: 'current-file',
          name: 'Same book.epub',
          mimeType: 'application/epub+zip',
          size: 100,
          modifiedTime: '2026-08-23T00:00:00.000Z',
          relativePath: 'Same book.epub',
        },
      ],
    });

    const { unmount } = renderHook(() => useGoogleDriveLibrary(true));

    await waitFor(() =>
      expect(appService.saveLibraryBooks).toHaveBeenCalledWith(expect.any(Array), {
        replace: true,
      }),
    );
    unmount();
  });
});
