'use client';

import { useEffect, useMemo, useState } from 'react';
import { MdCloudDone, MdCloudDownload, MdFolder, MdRefresh, MdSearch } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import Spinner from '@/components/Spinner';
import { useLibraryStore } from '@/store/libraryStore';
import type { SelectedFile } from '@/hooks/useFileSelector';
import {
  buildGoogleDriveConnectUrl,
  configureGoogleDriveFolder,
  DEFAULT_GOOGLE_DRIVE_FOLDER_URL,
  disconnectGoogleDrive,
  downloadGoogleDriveBook,
  getGoogleDriveBooks,
  getGoogleDriveStatus,
  parseGoogleDriveFolderId,
  type GoogleDriveBookFile,
  type GoogleDriveStatus,
} from '@/services/googleDriveSource';

interface GoogleDriveSourceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (files: SelectedFile[]) => Promise<void>;
}

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '';
  if (bytes < 1_024 * 1_024) return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
  return `${(bytes / 1_024 / 1_024).toFixed(1)} MB`;
};

const readingLabel = (book: GoogleDriveBookFile): string | null => {
  if (!book.progress) return null;
  if (book.progress.readingStatus === 'finished') return 'Finished';
  const percentage = Math.min(
    100,
    Math.max(0, Math.round((book.progress.current / book.progress.total) * 100)),
  );
  return `Reading ${percentage}%`;
};

const GoogleDriveSourceDialog: React.FC<GoogleDriveSourceDialogProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const library = useLibraryStore((state) => state.library);
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [folderUrl, setFolderUrl] = useState(DEFAULT_GOOGLE_DRIVE_FOLDER_URL);
  const [folderId, setFolderId] = useState('');
  const [folderName, setFolderName] = useState('Readest Books');
  const [books, setBooks] = useState<GoogleDriveBookFile[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const installedIds = useMemo(
    () =>
      new Set(
        library
          .filter((book) => !book.deletedAt && book.cloudSource?.provider === 'google-drive')
          .map((book) => book.cloudSource!.fileId),
      ),
    [library],
  );

  const visibleBooks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? books.filter((book) => book.relativePath.toLowerCase().includes(normalized))
      : books;
  }, [books, query]);

  const selectedBooks = useMemo(
    () => books.filter((book) => selectedIds.has(book.id) && !installedIds.has(book.id)),
    [books, installedIds, selectedIds],
  );

  const loadBooks = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getGoogleDriveBooks();
      setFolderId(result.folderId);
      setFolderName(result.folderName);
      setFolderUrl(result.folderUrl);
      setBooks(result.books);
      setSelectedIds(
        (current) =>
          new Set(
            [...current].filter(
              (id) => result.books.some((book) => book.id === id) && !installedIds.has(id),
            ),
          ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Drive books');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    getGoogleDriveStatus()
      .then(async (nextStatus) => {
        setStatus(nextStatus);
        setFolderUrl(nextStatus.folderUrl ?? DEFAULT_GOOGLE_DRIVE_FOLDER_URL);
        if (nextStatus.connected) await loadBooks();
      })
      .catch((statusError: unknown) => {
        setError(
          statusError instanceof Error ? statusError.message : 'Could not check Google Drive',
        );
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleImportFolder = async () => {
    if (!parseGoogleDriveFolderId(folderUrl)) {
      setError('Paste a valid Google Drive folder link');
      return;
    }
    if (!status?.connected) {
      window.location.assign(buildGoogleDriveConnectUrl(folderUrl));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await configureGoogleDriveFolder(folderUrl);
      setFolderId(result.folderId);
      setFolderName(result.folderName);
      setFolderUrl(result.folderUrl);
      setBooks(result.books);
      setSelectedIds(new Set());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not use that folder');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (booksToDownload: GoogleDriveBookFile[]) => {
    if (booksToDownload.length === 0) return;
    setError(null);
    try {
      for (const book of booksToDownload) {
        setDownloadingId(book.id);
        const selected = await downloadGoogleDriveBook(book, folderId);
        await onImport([{ file: selected.file, cloudSource: selected.cloudSource }]);
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(book.id);
          return next;
        });
      }
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Could not add this book');
    } finally {
      setDownloadingId(null);
    }
  };

  const toggleSelected = (bookId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const availableIds = visibleBooks
      .filter((book) => !installedIds.has(book.id))
      .map((book) => book.id);
    const allSelected = availableIds.length > 0 && availableIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of availableIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectGoogleDrive();
      setStatus({ connected: false, configured: true, folderUrl });
      setBooks([]);
      setFolderId('');
      setSelectedIds(new Set());
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      id='google-drive-source-dialog'
      isOpen={isOpen}
      title='Google Drive Books'
      onClose={onClose}
      boxClassName='sm:h-[78%] sm:max-w-[720px]'
      contentClassName='!px-4 sm:!px-6'
    >
      <div className='flex min-h-full flex-col gap-4 pb-4'>
        {loading && !status ? (
          <div className='flex flex-1 items-center justify-center py-12'>
            <Spinner loading />
          </div>
        ) : status && !status.configured ? (
          <div className='eink-bordered bg-base-200 rounded-xl p-4'>
            <p className='font-semibold'>Google Drive needs to be configured</p>
            <p className='text-base-content/65 mt-2 text-sm'>{status.error}</p>
          </div>
        ) : (
          <>
            <div className='eink-bordered bg-base-200 rounded-xl p-4'>
              <div>
                <p className='font-semibold'>Import a Google Drive folder</p>
                <p className='text-base-content/65 mt-1 text-sm'>
                  Paste the folder link to add its book catalog. No book files are stored on this
                  device until you select them below and download them.
                </p>
              </div>
              <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
                <label className='input input-bordered eink-bordered flex min-h-10 flex-1 items-center gap-2'>
                  <MdFolder className='h-5 w-5 shrink-0' />
                  <input
                    aria-label='Google Drive folder link'
                    className='min-w-0 flex-1 text-sm'
                    value={folderUrl}
                    onChange={(event) => setFolderUrl(event.target.value)}
                  />
                </label>
                <button
                  type='button'
                  className='btn btn-contrast min-h-10'
                  onClick={handleImportFolder}
                  disabled={loading}
                >
                  {loading ? <span className='loading loading-spinner loading-xs' /> : null}
                  Import cloud library
                </button>
              </div>
              {status?.connected ? (
                <div className='mt-3 flex items-center justify-between gap-3'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <MdCloudDone className='h-5 w-5 shrink-0' />
                    <div className='min-w-0'>
                      <p className='truncate text-xs font-medium'>{folderName}</p>
                      <p className='text-base-content/55 truncate text-xs'>
                        {status.email || 'Google Drive connected'}
                      </p>
                    </div>
                  </div>
                  <button type='button' className='btn btn-ghost btn-sm' onClick={handleDisconnect}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <p className='text-base-content/55 mt-3 text-xs'>
                  Because this folder is private, Google will ask once for read-only permission
                  after you import the link.
                </p>
              )}
            </div>

            {error && (
              <div role='alert' className='alert alert-error text-sm'>
                {error}
              </div>
            )}

            {status?.connected && loading && books.length === 0 ? (
              <div className='flex flex-1 items-center justify-center py-12'>
                <Spinner loading />
              </div>
            ) : null}

            {status?.connected && folderId ? (
              <>
                <div className='flex items-center gap-2'>
                  <label className='input input-bordered eink-bordered flex min-h-10 flex-1 items-center gap-2'>
                    <MdSearch className='h-5 w-5' />
                    <input
                      aria-label='Search cloud books'
                      className='min-w-0 flex-1'
                      placeholder='Search cloud books'
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <button
                    type='button'
                    aria-label='Refresh Google Drive books'
                    className='btn btn-ghost btn-square eink-bordered'
                    onClick={loadBooks}
                    disabled={loading}
                  >
                    <MdRefresh className={loading ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                  </button>
                </div>

                <div className='flex items-center justify-between gap-3 text-xs'>
                  <div>
                    <span className='text-base-content/70 font-medium'>
                      {visibleBooks.length} books in cloud library
                    </span>
                    <span className='text-base-content/50 ms-2'>None downloaded automatically</span>
                  </div>
                  <button
                    type='button'
                    className='btn btn-ghost btn-xs'
                    onClick={toggleAllVisible}
                    disabled={visibleBooks.every((book) => installedIds.has(book.id))}
                  >
                    Select all
                  </button>
                </div>

                <div className='flex flex-col gap-2'>
                  {visibleBooks.map((book) => {
                    const installed = installedIds.has(book.id);
                    const progressLabel = readingLabel(book);
                    return (
                      <label
                        key={book.id}
                        className='eink-bordered border-base-300 flex items-center gap-3 rounded-xl border p-3'
                      >
                        <div className='bg-base-300 flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold uppercase'>
                          {book.name.split('.').pop()?.slice(0, 4)}
                        </div>
                        <div className='min-w-0 flex-1'>
                          <p className='truncate text-sm font-medium'>{book.name}</p>
                          <div className='text-base-content/55 mt-1 flex flex-wrap gap-x-2 text-xs'>
                            {formatBytes(book.size) && <span>{formatBytes(book.size)}</span>}
                            {progressLabel && <span className='font-medium'>{progressLabel}</span>}
                            {book.progress && (
                              <span>
                                Recently read{' '}
                                {new Date(book.progress.lastReadAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        {installed ? (
                          <span className='badge badge-outline shrink-0'>On device</span>
                        ) : (
                          <input
                            type='checkbox'
                            className='checkbox checkbox-sm eink-bordered shrink-0'
                            aria-label={`Select ${book.name} to download`}
                            checked={selectedIds.has(book.id)}
                            onChange={() => toggleSelected(book.id)}
                            disabled={downloadingId !== null}
                          />
                        )}
                      </label>
                    );
                  })}
                  {!loading && visibleBooks.length === 0 && (
                    <div className='text-base-content/60 py-8 text-center text-sm'>
                      No supported books found in this folder.
                    </div>
                  )}
                </div>

                <div className='bg-base-100 sticky bottom-0 mt-auto border-t border-base-300 py-3'>
                  <button
                    type='button'
                    className='btn btn-contrast min-h-11 w-full'
                    onClick={() => handleDownload(selectedBooks)}
                    disabled={selectedBooks.length === 0 || downloadingId !== null}
                  >
                    {downloadingId ? (
                      <span className='loading loading-spinner loading-sm' />
                    ) : (
                      <MdCloudDownload className='h-5 w-5' />
                    )}
                    {downloadingId
                      ? 'Downloading selected books…'
                      : `Download selected (${selectedBooks.length})`}
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
};

export default GoogleDriveSourceDialog;
