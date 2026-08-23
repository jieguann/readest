import { describe, expect, it } from 'vitest';
import type { BookConfig } from '@/types/book';
import {
  buildGoogleDriveConnectUrl,
  buildDriveChildrenUrl,
  isSupportedDriveBook,
  mergeRemoteDriveProgress,
  parseGoogleDriveFolderId,
} from '@/services/googleDriveSource';

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

  it('starts the single Google permission step with the selected folder link', () => {
    expect(
      buildGoogleDriveConnectUrl(
        'https://drive.google.com/drive/folders/1uq-I5OWJTI_FkCw34r8ugxssdls16sqH?usp=drive_link',
      ),
    ).toBe(
      '/api/google-drive/connect?folderUrl=https%3A%2F%2Fdrive.google.com%2Fdrive%2Ffolders%2F1uq-I5OWJTI_FkCw34r8ugxssdls16sqH%3Fusp%3Ddrive_link',
    );
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
