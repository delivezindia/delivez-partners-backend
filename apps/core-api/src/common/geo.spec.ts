import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bearingDeg } from './geo';

describe('bearingDeg', () => {
  const [lat, lng] = [26.85, 81.0];
  it('points the four ways', () => {
    assert.equal(bearingDeg(lat, lng, lat + 0.01, lng), 0);
    assert.equal(bearingDeg(lat, lng, lat, lng + 0.01), 90);
    assert.equal(bearingDeg(lat, lng, lat - 0.01, lng), 180);
    assert.equal(bearingDeg(lat, lng, lat, lng - 0.01), 270);
  });

  it('stays in 0–359', () => {
    const b = bearingDeg(lat, lng, lat + 0.01, lng - 0.0001);
    assert.ok(b >= 350 && b < 360, String(b));
    assert.equal(bearingDeg(lat, lng, lat, lng), 0);
  });
});
