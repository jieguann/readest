import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PWAServiceWorkerRegistration from '@/components/PWAServiceWorkerRegistration';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PWAServiceWorkerRegistration', () => {
  it('registers the root service worker for standalone installation', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    });

    render(<PWAServiceWorkerRegistration />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    });
  });
});
