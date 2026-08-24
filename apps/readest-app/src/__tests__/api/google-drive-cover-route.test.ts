import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  getDriveAccess: vi.fn(),
  getConfiguredFolder: vi.fn(),
  assertFileInFolder: vi.fn(),
}));

vi.mock('@/server/googleDrive/service', () => serviceMocks);

import { GET } from '@/app/api/google-drive/books/[fileId]/cover/route';

describe('Google Drive cover route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getDriveAccess.mockResolvedValue({
      session: { session_id: 'session-1' },
      accessToken: 'drive-token',
    });
    serviceMocks.getConfiguredFolder.mockReturnValue({ id: 'folder-1' });
  });

  it('proxies a Drive thumbnail without downloading the book', async () => {
    serviceMocks.assertFileInFolder.mockResolvedValue({
      id: 'file-1',
      name: 'Book.epub',
      mimeType: 'application/epub+zip',
      hasThumbnail: true,
      thumbnailLink: 'https://drive.google.com/thumbnail?id=file-1',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );

    const response = await GET(new Request('https://reader.example/api/cover'), {
      params: Promise.resolve({ fileId: 'file-1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://drive.google.com/thumbnail?id=file-1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer drive-token' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
  });

  it('returns not found when Drive has no thumbnail', async () => {
    serviceMocks.assertFileInFolder.mockResolvedValue({
      id: 'file-2',
      name: 'Notes.txt',
      mimeType: 'text/plain',
      hasThumbnail: false,
    });

    const response = await GET(new Request('https://reader.example/api/cover'), {
      params: Promise.resolve({ fileId: 'file-2' }),
    });

    expect(response.status).toBe(404);
  });
});
