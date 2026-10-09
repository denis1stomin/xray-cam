// Draws X-ray style hands on a 2D canvas: a soft-tissue glow around the hand,
// then bones with bright edges (cortex), a darker canal down the middle and
// joint gaps, as they look on a radiograph.
import { handSkeleton, boneOutline, lerp } from './geometry.js';

const FINGER_CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const PALM = [0, 1, 2, 5, 9, 13, 17];

function path(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function createBoneRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // Soft tissue is drawn solid on its own layer, then laid over at low opacity,
  // so overlapping fingers do not add up into bright blobs.
  const tissue = document.createElement('canvas');
  const tctx = tissue.getContext('2d');

  function drawTissue(pts, L) {
    tctx.save();
    tctx.lineCap = 'round'; tctx.lineJoin = 'round';
    tctx.fillStyle = tctx.strokeStyle = '#cfe4ff';
    tctx.shadowColor = '#cfe4ff'; tctx.shadowBlur = 0.12 * L;
    path(tctx, PALM.map((i) => pts[i])); tctx.fill();
    tctx.lineWidth = 0.42 * L; tctx.stroke();
    FINGER_CHAINS.forEach((chain, f) => {
      tctx.lineWidth = (f === 0 ? 0.26 : f === 4 ? 0.19 : 0.22) * L;
      tctx.beginPath();
      chain.forEach((i, k) => (k ? tctx.lineTo(pts[i].x, pts[i].y) : tctx.moveTo(pts[i].x, pts[i].y)));
      tctx.stroke();
    });
    tctx.restore();
  }

  function drawBone(bone, L) {
    const o = boneOutline(bone);
    if (!o.points.length) return;
    ctx.save();
    ctx.shadowColor = 'rgba(170, 215, 255, 0.75)';
    ctx.shadowBlur = 0.07 * L;
    ctx.fillStyle = 'rgba(225, 238, 255, 0.58)';
    path(ctx, o.points); ctx.fill();
    ctx.shadowBlur = 0;
    // Cortex: the dense outer wall of the bone shows as a bright rim.
    ctx.lineWidth = Math.max(1, bone.w * 0.11);
    ctx.strokeStyle = 'rgba(250, 253, 255, 0.9)';
    ctx.stroke();
    // Medullary canal: a darker core along the shaft.
    if (bone.kind !== 'tip') {
      ctx.lineCap = 'round';
      ctx.lineWidth = bone.w * 0.26;
      ctx.strokeStyle = 'rgba(40, 70, 105, 0.32)';
      const a = lerp(o.a, o.b, 0.22); const b = lerp(o.a, o.b, 0.78);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Forearm bones dissolve as they run away from the wrist: erase along a gradient.
    if (bone.kind === 'forearm') {
      const g = ctx.createLinearGradient(o.a.x, o.a.y, o.b.x, o.b.y);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0.6)'); g.addColorStop(0.9, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g; ctx.strokeStyle = g; ctx.lineWidth = bone.w * 0.5;
      path(ctx, o.points); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCarpal(c, L) {
    ctx.save();
    ctx.shadowColor = 'rgba(170, 215, 255, 0.7)'; ctx.shadowBlur = 0.05 * L;
    ctx.fillStyle = 'rgba(225, 238, 255, 0.5)';
    ctx.beginPath(); ctx.ellipse(c.c.x, c.c.y, c.rx, c.ry, c.rot, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, c.rx * 0.16); ctx.strokeStyle = 'rgba(250, 253, 255, 0.8)'; ctx.stroke();
    ctx.restore();
  }

  return {
    resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (tissue.width !== w || tissue.height !== h) { tissue.width = w; tissue.height = h; }
    },
    // hands: [{ pts: [21 screen points], alpha }]
    draw(hands) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!hands.length) return;
      tctx.clearRect(0, 0, tissue.width, tissue.height);
      for (const h of hands) {
        const sk = handSkeleton(h.pts);
        drawTissue(h.pts, sk.scale);
        h.sk = sk;
      }
      ctx.save();
      // The camera picture already shows the hand's outline; this only adds a little density.
      ctx.globalAlpha = 0.09 * Math.max(...hands.map((h) => h.alpha));
      ctx.drawImage(tissue, 0, 0);
      ctx.restore();
      for (const h of hands) {
        ctx.save();
        ctx.globalAlpha = h.alpha;
        const { bones, carpals, scale } = h.sk;
        // Forearm first, then the wrist, then the hand bones on top.
        bones.filter((b) => b.kind === 'forearm').forEach((b) => drawBone(b, scale));
        carpals.forEach((c) => drawCarpal(c, scale));
        bones.filter((b) => b.kind !== 'forearm').forEach((b) => drawBone(b, scale));
        ctx.restore();
      }
    },
  };
}
