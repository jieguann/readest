import { describe, expect, it } from 'vitest';

import { shouldShowReadestCloudOnlyDelete } from '@/app/library/utils/deleteOptions';

describe('fixed Drive web reader delete options', () => {
  it('hides Readest Cloud Only in the fixed Drive web reader', () => {
    expect(shouldShowReadestCloudOnlyDelete(true, true)).toBe(false);
  });

  it('keeps Readest Cloud Only on other platforms when Readest Cloud is active', () => {
    expect(shouldShowReadestCloudOnlyDelete(false, true)).toBe(true);
    expect(shouldShowReadestCloudOnlyDelete(false, false)).toBe(false);
  });
});
