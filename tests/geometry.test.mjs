// Geometry behind the drawn skeleton: screen mapping, bone layout, outlines, smoothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFit, toScreen, handSkeleton, boneOutline, halfWidth, PointSmoother, len, sub } from '../app/js/geometry.js';

// A plausible open hand (screen pixels), palm facing the camera, fingers up.
const HAND = [
  [200, 400], // 0 wrist
  [150, 370], [120, 330], [105, 290], [95, 255], // thumb
  [165, 280], [155, 220], [150, 185], [146, 155], // index
  [200, 270], [200, 205], [200, 165], [200, 130], // middle
  [235, 280], [242, 222], [246, 186], [249, 156], // ring
  [265, 295], [278, 250], [285, 222], [290, 198], // pinky
].map(([x, y]) => ({ x, y }));

test('cover fit fills the screen and keeps the aspect ratio', () => {
  const f = coverFit(1280, 720, 390, 844); // landscape camera on a portrait phone
  assert.ok(f.srcW * f.scale >= f.dstW - 1e-9 && f.srcH * f.scale >= f.dstH - 1e-9);
  // The centre of the camera picture lands in the centre of the screen.
  const c = toScreen({ x: 0.5, y: 0.5 }, f);
  assert.ok(Math.abs(c.x - 195) < 1e-6 && Math.abs(c.y - 422) < 1e-6);
  // Mirroring flips x around the screen centre.
  const p = toScreen({ x: 0.6, y: 0.5 }, f); const m = toScreen({ x: 0.6, y: 0.5 }, f, true);
  assert.ok(Math.abs(p.x + m.x - 390) < 1e-6 && p.y === m.y);
});

test('a hand gets the expected bones: 4 fingers x 4, thumb 3, radius and ulna, 9 wrist bones', () => {
  const sk = handSkeleton(HAND);
  assert.equal(sk.bones.length, 4 * 4 + 3 + 2);
  assert.equal(sk.bones.filter((b) => b.kind === 'tip').length, 5);
  assert.equal(sk.bones.filter((b) => b.kind === 'forearm').length, 2);
  assert.equal(sk.carpals.length, 9);
  assert.ok(Math.abs(sk.scale - len(sub(HAND[9], HAND[0]))) < 1e-9);
});

test('bones scale with the hand and fingertips are thinner than knuckles', () => {
  const big = handSkeleton(HAND.map((p) => ({ x: p.x * 2, y: p.y * 2 })));
  const small = handSkeleton(HAND);
  big.bones.forEach((b, i) => assert.ok(Math.abs(b.w - 2 * small.bones[i].w) < 1e-9));
  const index = small.bones.slice(0, 4);
  assert.ok(index[0].w > index[3].w);
});

test('bone outlines are closed shapes that leave a joint space', () => {
  const bone = { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, w: 20, kind: 'shaft' };
  const o = boneOutline(bone);
  assert.ok(o.points.length > 20);
  assert.ok(o.a.y > 0 && o.b.y < 100, 'shortened at both ends');
  // Flared ends, narrow middle.
  assert.ok(halfWidth(0, 20, 'shaft') > halfWidth(0.5, 20, 'shaft'));
  // Too short to draw: no outline rather than an inside-out shape.
  assert.equal(boneOutline({ a: { x: 0, y: 0 }, b: { x: 0, y: 5 }, w: 20, kind: 'shaft' }).points.length, 0);
});

test('the smoother follows a still hand closely and settles on it', () => {
  const s = new PointSmoother();
  const at = (x) => [{ x, y: 0.5, z: 0 }];
  s.push(at(0.5));
  let p;
  for (let i = 0; i < 20; i++) p = s.push(at(0.6));
  assert.ok(Math.abs(p[0].x - 0.6) < 1e-3);
  // A fast jump is followed more quickly than a small jitter.
  const a = new PointSmoother(); a.push(at(0.5)); const slow = a.push(at(0.505))[0].x - 0.5;
  const b = new PointSmoother(); b.push(at(0.5)); const fast = b.push(at(0.7))[0].x - 0.5;
  assert.ok(fast / 0.2 > slow / 0.005);
});
