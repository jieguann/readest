import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { isWebAppPlatform } from '@/services/environment';
import {
  getGoogleDriveBooks,
  getGoogleDriveStatus,
  isGoogleDriveCatalogBook,
  mergeGoogleDriveCatalog,
  prepareCachedGoogleDriveLibrary,
} from '@/services/googleDriveSource';
import { useLibraryStore } from '@/store/libraryStore';

const GOOGLE_DRIVE_REFRESH_INTERVAL_MS = 60_000;

export const useGoogleDriveLibrary = (enabled: boolean) => {
  const { envConfig } = useEnv();
  const isRefreshing = useRef(false);
  const needsExactPersistence = useRef(false);

  useLayoutEffect(() => {
    if (!enabled || !isWebAppPlatform()) return;
    const currentLibrary = useLibraryStore.getState().library;
    const nextLibrary = prepareCachedGoogleDriveLibrary(currentLibrary);
    if (nextLibrary.length === currentLibrary.length) return;

    needsExactPersistence.current = true;
    useLibraryStore.getState().setLibrary(nextLibrary);
    void envConfig
      .getAppService()
      .then((appService) => appService.saveLibraryBooks(nextLibrary))
      .catch((error) => console.warn('Could not remove cached demo books:', error));
  }, [enabled, envConfig]);

  const refresh = useCallback(async () => {
    if (!enabled || !isWebAppPlatform() || isRefreshing.current) return;
    isRefreshing.current = true;
    try {
      const currentLibrary = useLibraryStore.getState().library;
      let nextLibrary = prepareCachedGoogleDriveLibrary(currentLibrary);
      const status = await getGoogleDriveStatus();
      if (status.connected) {
        const catalog = await getGoogleDriveBooks();
        nextLibrary = mergeGoogleDriveCatalog(
          nextLibrary,
          catalog.books,
          catalog.folderId,
          window.location.origin,
        );
      } else {
        nextLibrary = nextLibrary.filter((book) => !isGoogleDriveCatalogBook(book));
      }

      const libraryChanged = JSON.stringify(nextLibrary) !== JSON.stringify(currentLibrary);
      if (!libraryChanged && !(status.connected && needsExactPersistence.current)) return;
      if (libraryChanged) useLibraryStore.getState().setLibrary(nextLibrary);
      const appService = await envConfig.getAppService();
      await appService.saveLibraryBooks(
        nextLibrary,
        status.connected ? { replace: true } : undefined,
      );
      if (status.connected) needsExactPersistence.current = false;
    } catch (error) {
      console.warn('Could not refresh the Google Drive library:', error);
    } finally {
      isRefreshing.current = false;
    }
  }, [enabled, envConfig]);

  useEffect(() => {
    if (!enabled || !isWebAppPlatform()) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), GOOGLE_DRIVE_REFRESH_INTERVAL_MS);
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, refresh]);

  return refresh;
};
