// Turns the current frame into an "X-ray film": the picture with a dark
// border, a lead side marker (L / R) and a label that says it is a toy.

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// layers: canvases drawn in order (the X-ray picture, then the bones).
// side: 'L' | 'R' | null.
export function filmFrame(layers, { side = null, date = new Date() } = {}) {
  const w = layers[0].width; const h = layers[0].height;
  const pad = Math.round(Math.min(w, h) * 0.035);
  const out = document.createElement('canvas');
  out.width = w + pad * 2; out.height = h + pad * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#05080d';
  ctx.fillRect(0, 0, out.width, out.height);
  for (const l of layers) ctx.drawImage(l, pad, pad, w, h);

  const u = Math.min(w, h) / 100; // one "unit" of the label layout
  // Lead side marker in the top corner, like on a real film.
  if (side) {
    const s = u * 11; const x = pad + u * 5; const y = pad + u * 5;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    roundRect(ctx, x, y, s, s, u * 1.2);
    ctx.lineWidth = u * 0.9; ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'; ctx.stroke();
    ctx.font = `700 ${u * 8}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(side, x + s / 2, y + s / 2 + u * 0.4);
    ctx.restore();
  }
  // Label in the bottom corner.
  ctx.save();
  ctx.fillStyle = 'rgba(205, 225, 245, 0.85)';
  ctx.font = `600 ${u * 3.4}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'bottom';
  const lines = ['X-RAY CAM', 'FOR FUN ONLY · NOT A MEDICAL IMAGE', stamp(date)];
  lines.forEach((t, i) => ctx.fillText(t, pad + u * 5, pad + h - u * 4 - (lines.length - 1 - i) * u * 4.6));
  ctx.restore();
  return out;
}

export const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));

// Share sheet when the browser supports sharing files (iPhone: "Save Image"),
// a download otherwise.
export async function shareOrSave(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'My X-ray' }); return 'shared'; } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
