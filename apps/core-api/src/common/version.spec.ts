import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeBuild } from './version';

describe('describeBuild', () => {
  const checkout = (commit: string | null) => ({ commit, commitDate: null });
  const built = (commit: string) => ({ commit, commitDate: '2026-11-02T10:00:00+05:30', builtAt: '2026-11-02T10:05:00Z' });

  it('reports the commit the running code was built from', () => {
    const b = describeBuild('0.1.0', built('e50747e'), checkout('e50747e'));
    assert.equal(b.commit, 'e50747e');
    assert.equal(b.stale, false);
  });

  it('flags old code: the folder was pulled to a newer commit but not built', () => {
    const b = describeBuild('0.1.0', built('043d8b6'), checkout('e50747e'));
    assert.equal(b.commit, '043d8b6', 'shows what is really running');
    assert.equal(b.checkout, 'e50747e');
    assert.equal(b.stale, true);
  });

  it('falls back to the folder commit when there is no build record (dev, older builds)', () => {
    const b = describeBuild('0.1.0', null, checkout('abc1234'));
    assert.equal(b.commit, 'abc1234');
    assert.equal(b.builtAt, null);
    assert.equal(b.stale, false);
  });
});
