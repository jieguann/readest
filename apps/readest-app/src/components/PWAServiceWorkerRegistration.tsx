'use client';

import { useEffect } from 'react';

const PWAServiceWorkerRegistration = () => {
  useEffect(() => {
    const canRegister =
      'serviceWorker' in navigator &&
      (window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1');
    if (!canRegister) return;

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => {
        console.warn('Could not register the Readest service worker:', error);
      });
  }, []);

  return null;
};

export default PWAServiceWorkerRegistration;
