import { useCallback, useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { isWebAppPlatform } from '@/services/environment';
import {
  getGoogleDriveBooks,
  getGoogleDriveStatus,
  isGoogleDriveCatalogBook,
  mergeGoogleDriveCatalog,
} from '@/services/googleDriveSource';
import { isDemoBook } from '@/services/demoBooks';
import { useLibraryStore } from '@/store/libraryStore';

const GOOGLE_DRIVE_REFRESH_INTERVAL_MS = 60_000;

export const useGoogleDriveLibrary = (enabled: boolean) => {
  const { envConfig } = useEnv();
  const isRefreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !isWebAppPlatform() || isRefreshing.current) return;
    isRefreshing.current = true;
    try {
      const currentLibrary = useLibraryStore.getState().library;
      let nextLibrary = currentLibrary.filter((book) => !isDemoBook(book));
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

      if (JSON.stringify(nextLibrary) === JSON.stringify(currentLibrary)) return;
      useLibraryStore.getState().setLibrary(nextLibrary);
      const appService = await envConfig.getAppService();
      await appService.saveLibraryBooks(nextLibrary);
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
