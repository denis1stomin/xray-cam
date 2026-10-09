// Pure geometry: mapping camera coordinates to the screen, the hand skeleton
// layout built from MediaPipe's 21 hand landmarks, bone outlines and smoothing.
// No DOM here, so it can be unit tested.
//
// MediaPipe hand landmarks:
//   0 wrist
//   1-4   thumb  (CMC, MCP, IP, tip)
//   5-8   index  (MCP, PIP, DIP, tip)
//   9-12  middle, 13-16 ring, 17-20 pinky (same order)

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const len = (a) => Math.hypot(a.x, a.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a) => ({ x: -a.y, y: a.x });

// "object-fit: cover" of a srcW x srcH frame into a dstW x dstH screen.
export function coverFit(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  return { scale, ox: (dstW - srcW * scale) / 2, oy: (dstH - srcH * scale) / 2, srcW, srcH, dstW, dstH };
}

// A normalised landmark (0..1 of the camera frame) to screen pixels.
// `mirror` flips horizontally, as the front camera is shown like a mirror.
export function toScreen(p, fit, mirror = false) {
  const x = fit.ox + p.x * fit.srcW * fit.scale;
  const y = fit.oy + p.y * fit.srcH * fit.scale;
  return { x: mirror ? fit.dstW - x : x, y };
}

// Bone widths relative to the hand length (wrist to middle-finger knuckle).
const W = { meta: 0.085, prox: 0.08, mid: 0.068, dist: 0.058 };
const FINGERS = [
  { mcp: 5, k: 1.0 }, // index
  { mcp: 9, k: 1.04 }, // middle
  { mcp: 13, k: 0.96 }, // ring
  { mcp: 17, k: 0.84 }, // pinky
];

// The skeleton for one hand from 21 screen points:
// { scale, bones: [{ a, b, w, kind }], carpals: [{ c, rx, ry, rot }] }.
// kind: 'shaft' (long bone), 'tip' (distal phalanx), 'forearm'.
export function handSkeleton(pts) {
  const wrist = pts[0];
  const L = len(sub(pts[9], wrist)) || 1;
  const bones = [];
  const bone = (a, b, w, kind = 'shaft') => bones.push({ a, b, w: w * L, kind });

  // Fingers: metacarpal from the carpus to the knuckle, then the phalanges.
  for (const f of FINGERS) {
    const mcp = pts[f.mcp];
    const base = lerp(wrist, mcp, 0.3);
    bone(base, mcp, W.meta * f.k);
    bone(mcp, pts[f.mcp + 1], W.prox * f.k);
    bone(pts[f.mcp + 1], pts[f.mcp + 2], W.mid * f.k);
    bone(pts[f.mcp + 2], pts[f.mcp + 3], W.dist * f.k, 'tip');
  }
  // Thumb: metacarpal (CMC to MCP), proximal and distal phalanx.
  bone(pts[1], pts[2], 0.095);
  bone(pts[2], pts[3], 0.085);
  bone(pts[3], pts[4], 0.07, 'tip');

  // Forearm: radius on the thumb side, ulna on the little-finger side,
  // running away from the hand.
  const dir = norm(sub(wrist, lerp(pts[5], pts[17], 0.5)));
  const side = norm(sub(pts[5], pts[17]));
  const start = add(wrist, mul(dir, 0.16 * L));
  const radius = add(start, mul(side, 0.13 * L));
  const ulna = add(start, mul(side, -0.12 * L));
  bones.push({ a: radius, b: add(radius, mul(dir, 1.7 * L)), w: 0.17 * L, kind: 'forearm' });
  bones.push({ a: ulna, b: add(ulna, mul(dir, 1.75 * L)), w: 0.125 * L, kind: 'forearm' });

  // Carpus: two rows of small rounded bones between the forearm and the metacarpals.
  const carpals = [];
  const bases = FINGERS.map((f) => lerp(wrist, pts[f.mcp], 0.3));
  // t: from the wrist line (0) to the metacarpal bases (1); s: thumb side (0) to little-finger side (1).
  const rows = [
    { t: 0.72, xs: [0.0, 0.33, 0.66, 1.0], r: 0.075 }, // distal row
    { t: 0.3, xs: [0.08, 0.38, 0.68, 0.95], r: 0.068 }, // proximal row
  ];
  const ang = Math.atan2(dir.y, dir.x);
  for (const row of rows) {
    for (const s of row.xs) {
      const top = lerp(bases[0], bases[3], s);
      const bottom = add(wrist, mul(side, (0.5 - s) * 0.42 * L));
      carpals.push({ c: lerp(bottom, top, row.t), rx: row.r * L * (0.9 + 0.25 * Math.sin(s * 7)), ry: row.r * L * 0.8, rot: ang });
    }
  }
  // Trapezium: the wrist bone the thumb's metacarpal sits on.
  const trapezium = lerp(pts[1], lerp(wrist, bases[0], 0.6), 0.45);
  carpals.push({ c: trapezium, rx: 0.07 * L, ry: 0.06 * L, rot: Math.atan2(pts[2].y - pts[1].y, pts[2].x - pts[1].x) });
  return { scale: L, bones, carpals };
}

// Half-width along a bone, t in 0..1: a narrow shaft that flares at both ends,
// with a rounded, slightly narrower tuft at a fingertip.
export function halfWidth(t, w, kind) {
  const s = Math.abs(2 * t - 1);
  if (kind === 'tip' && t > 0.5) return w * 0.5 * (0.6 + 0.25 * Math.sin(Math.PI * t));
  return w * 0.5 * (0.62 + 0.38 * s ** 3);
}

// Outline of one bone as a closed polygon, shortened at both ends so that
// neighbouring bones leave a joint space between them.
export function boneOutline(bone, steps = 12) {
  const gap = bone.kind === 'forearm' ? 0 : bone.w * 0.32;
  const axis = sub(bone.b, bone.a);
  const l = len(axis);
  if (l < gap * 2 + 1) return { a: bone.a, b: bone.b, points: [] };
  const d = norm(axis); const n = perp(d);
  const a = add(bone.a, mul(d, gap)); const b = sub(bone.b, mul(d, bone.kind === 'tip' ? gap * 0.3 : gap));
  const left = []; const right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = lerp(a, b, t); const h = halfWidth(t, bone.w, bone.kind);
    left.push(add(c, mul(n, h))); right.push(sub(c, mul(n, h)));
  }
  // Rounded caps: half circles at both ends.
  const cap = (c, h, from) => Array.from({ length: 7 }, (_, i) => {
    const ang = from + (Math.PI * (i + 1)) / 8;
    return add(c, add(mul(n, Math.cos(ang) * h), mul(d, Math.sin(ang) * h)));
  });
  const hb = halfWidth(1, bone.w, bone.kind); const ha = halfWidth(0, bone.w, bone.kind);
  const points = [...left, ...cap(b, hb, 0), ...right.reverse(), ...cap(a, ha, Math.PI)];
  return { a, b, points };
}

// Light jitter filter for landmarks: a "one euro"-style filter. Smooth when the
// hand is still, responsive when it moves fast. One instance per tracked hand.
export class PointSmoother {
  constructor({ minAlpha = 0.25, maxAlpha = 0.85, speedForMax = 0.04 } = {}) {
    Object.assign(this, { minAlpha, maxAlpha, speedForMax, prev: null });
  }
  reset() { this.prev = null; }
  // pts: [{x, y, z}] normalised; returns the smoothed copy.
  push(pts) {
    if (!this.prev || this.prev.length !== pts.length) { this.prev = pts.map((p) => ({ ...p })); return this.prev; }
    let speed = 0;
    for (let i = 0; i < pts.length; i++) speed = Math.max(speed, Math.hypot(pts[i].x - this.prev[i].x, pts[i].y - this.prev[i].y));
    const k = Math.min(1, speed / this.speedForMax);
    const alpha = this.minAlpha + (this.maxAlpha - this.minAlpha) * k;
    this.prev = pts.map((p, i) => ({
      x: this.prev[i].x + (p.x - this.prev[i].x) * alpha,
      y: this.prev[i].y + (p.y - this.prev[i].y) * alpha,
      z: (this.prev[i].z ?? 0) + ((p.z ?? 0) - (this.prev[i].z ?? 0)) * alpha,
    }));
    return this.prev;
  }
}
