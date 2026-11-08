import { describe, expect, it } from 'vitest';
import { parseSyncPdf, parseSyncSource } from '../src/lib/synctex';

describe('SyncTeX results', () => {
  it('parses forward positions and uses the first match', () => {
    expect(
      parseSyncPdf(
        'SyncTeX result begin\nPage:1\nx:171.128296\ny:134.764618\nPage:2\nx:1\ny:2\nSyncTeX result end',
      ),
    ).toEqual({ page: 1, x: 171.128296, y: 134.764618 });
  });
  it('parses included paths containing colons and unknown columns', () => {
    expect(
      parseSyncSource(
        'SyncTeX result begin\nInput:/project/parts/a:b.tex\nLine:3\nColumn:-1\nSyncTeX result end',
      ),
    ).toEqual({ path: '/project/parts/a:b.tex', line: 2, column: 0 });
  });
  it('rejects missing, malformed and invalid results', () => {
    expect(parseSyncPdf('SyncTeX result begin\nPage:1\nx:5\nSyncTeX result end')).toBeNull();
    expect(parseSyncPdf('SyncTeX result begin\nPage:1\nx:NaN\ny:2\nSyncTeX result end')).toBeNull();
    expect(
      parseSyncSource(
        'SyncTeX result begin\nInput:/project/a.tex\nLine:0\nColumn:-1\nSyncTeX result end',
      ),
    ).toBeNull();
    expect(parseSyncSource('No result')).toBeNull();
  });
});
