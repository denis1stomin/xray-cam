// X-Ray Cam: camera -> X-ray look (WebGL) + hand tracking -> drawn bones.
import { coverFit, toScreen, PointSmoother } from './geometry.js';
import { createXray } from './xray.js';
import { createBoneRenderer } from './bones.js';
import { createTracker } from './hands.js';
import { filmFrame, toBlob, shareOrSave } from './snapshot.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const video = $('#video');
const xrayCanvas = $('#xray');
const bonesCanvas = $('#bones');
const ui = {
  start: $('#start'), go: $('#go'), status: $('#status'), hint: $('#hint'), fps: $('#fps'),
  flip: $('#flip'), shot: $('#shot'), info: $('#info'), about: $('#about'), aboutClose: $('#about-close'),
  photo: $('#photo'), photoImg: $('#photo-img'), photoSave: $('#photo-save'), photoClose: $('#photo-close'),
};

const S = {
  facing: 'environment', stream: null, running: false, tracker: null, trackerPromise: null,
  xray: null, bones: createBoneRenderer(bonesCanvas), fit: null, dpr: 1,
  lastVideoTime: -1, hands: new Map(), lastSeen: 0, snap: false, photoBlob: null,
  frames: 0, fpsAt: 0, detectMs: 0,
};

// ---------------------------------------------------------------- camera
async function openCamera() {
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: S.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  S.stream = stream;
  video.srcObject = stream;
  await video.play();
  S.lastVideoTime = -1;
  S.hands.clear();
}

function cameraError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError') return 'Camera access was blocked. On iPhone: Settings → Safari → Camera → Allow, then reload this page.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (!window.isSecureContext) return 'The camera only works over https.';
  return `Could not start the camera (${name || err}).`;
}

// ---------------------------------------------------------------- sizing
function resize() {
  S.dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(innerWidth * S.dpr); const h = Math.round(innerHeight * S.dpr);
  if (xrayCanvas.width !== w || xrayCanvas.height !== h) { xrayCanvas.width = w; xrayCanvas.height = h; }
  S.bones.resize(w, h);
}

// ---------------------------------------------------------------- tracking
// Hands fade in when found and fade out from their last pose when lost.
let nextHandId = 1;
function updateHands(found, now) {
  const seen = new Set();
  for (const h of found) {
    // Match each detection to the tracked hand whose wrist is closest
    // (labels alone are not enough: two hands can both read as "Right").
    let key = null; let best = 0.15;
    for (const [k, e] of S.hands) {
      if (seen.has(k) || !e.landmarks) continue;
      const d = Math.hypot(e.landmarks[0].x - h.landmarks[0].x, e.landmarks[0].y - h.landmarks[0].y);
      if (d < best) { best = d; key = k; }
    }
    if (key == null) { key = nextHandId++; S.hands.set(key, { smoother: new PointSmoother(), alpha: 0 }); }
    seen.add(key);
    const e = S.hands.get(key);
    e.label = h.label;
    e.landmarks = e.smoother.push(h.landmarks);
    e.seenAt = now;
  }
  for (const [key, e] of S.hands) {
    const target = seen.has(key) ? 1 : 0;
    e.alpha += (target - e.alpha) * (target ? 0.35 : 0.18);
    if (!target && e.alpha < 0.02) { S.hands.delete(key); continue; }
    if (!target) e.smoother.reset();
  }
  if (found.length) S.lastSeen = now;
}

// The front camera shows a mirror image; MediaPipe's label assumes a mirrored
// picture, so the true side of the hand flips for the front camera.
const sideOf = (label) => {
  const s = label === 'Left' ? 'L' : 'R';
  return S.facing === 'user' ? (s === 'L' ? 'R' : 'L') : s;
};

// ---------------------------------------------------------------- frame loop
function frame(now) {
  if (!S.running) return;
  requestAnimationFrame(frame);
  if (video.readyState < 2 || !video.videoWidth) return;
  resize();
  const mirror = S.facing === 'user';
  S.fit = coverFit(video.videoWidth, video.videoHeight, xrayCanvas.width, xrayCanvas.height);
  S.xray.render(video, S.fit, mirror, now / 1000);

  if (S.tracker && video.currentTime !== S.lastVideoTime) {
    S.lastVideoTime = video.currentTime;
    const t0 = performance.now();
    let found = [];
    try { found = S.tracker.detect(video, now); } catch (err) { if (debug) console.warn(err); }
    S.detectMs = S.detectMs * 0.9 + (performance.now() - t0) * 0.1;
    updateHands(found, now);
  }
  const hands = [...S.hands.values()].filter((e) => e.landmarks)
    .map((e) => ({ pts: e.landmarks.map((p) => toScreen(p, S.fit, mirror)), alpha: e.alpha, label: e.label }));
  S.bones.draw(hands);

  ui.hint.classList.toggle('show', !!S.tracker && now - S.lastSeen > 1500);
  if (S.snap) { S.snap = false; takeSnapshot(hands); }
  if (debug) {
    S.frames += 1;
    if (now - S.fpsAt > 1000) { ui.fps.textContent = `${S.frames} fps · ${S.detectMs.toFixed(0)} ms · ${S.tracker ? S.tracker.delegate : 'loading'}`; S.frames = 0; S.fpsAt = now; }
  }
}

// ---------------------------------------------------------------- snapshot
// Called inside the frame that has just been drawn, so the WebGL picture is
// still in its buffer (no preserveDrawingBuffer needed).
async function takeSnapshot(hands) {
  const side = hands.length ? sideOf(hands[0].label) : null;
  const film = filmFrame([xrayCanvas, bonesCanvas], { side });
  S.photoBlob = await toBlob(film);
  if (ui.photoImg.src) URL.revokeObjectURL(ui.photoImg.src);
  ui.photoImg.src = URL.createObjectURL(S.photoBlob);
  ui.photo.hidden = false;
  document.body.classList.add('flash');
  setTimeout(() => document.body.classList.remove('flash'), 350);
}

// ---------------------------------------------------------------- start
async function start() {
  ui.go.disabled = true;
  ui.status.textContent = 'Starting the camera…';
  // Load the hand model while the camera starts.
  S.trackerPromise = S.trackerPromise || createTracker({ forceCpu: params.has('cpu') });
  try {
    await openCamera();
  } catch (err) {
    ui.status.textContent = cameraError(err);
    ui.go.disabled = false;
    return;
  }
  try { S.xray = S.xray || createXray(xrayCanvas); } catch (err) {
    ui.status.textContent = `This browser cannot draw the X-ray picture (${err.message}).`;
    return;
  }
  ui.start.hidden = true;
  document.body.classList.add('running');
  S.running = true;
  requestAnimationFrame(frame);
  ui.hint.textContent = 'Warming up the X-ray tube…';
  ui.hint.classList.add('show');
  try {
    S.tracker = await S.trackerPromise;
    ui.hint.textContent = 'Show your hand to the camera';
    S.lastSeen = performance.now();
  } catch (err) {
    ui.hint.textContent = 'Hand tracking could not start on this device. The X-ray look still works.';
    if (debug) console.error(err);
  }
}

ui.go.addEventListener('click', start);
ui.flip.addEventListener('click', async () => {
  S.facing = S.facing === 'environment' ? 'user' : 'environment';
  try { await openCamera(); } catch (err) { ui.hint.textContent = cameraError(err); ui.hint.classList.add('show'); }
});
ui.shot.addEventListener('click', () => { if (S.running) S.snap = true; });
ui.info.addEventListener('click', () => { ui.about.hidden = false; });
ui.aboutClose.addEventListener('click', () => { ui.about.hidden = true; });
ui.photoClose.addEventListener('click', () => { ui.photo.hidden = true; });
ui.photoSave.addEventListener('click', async () => {
  if (S.photoBlob) await shareOrSave(S.photoBlob, `xray-${Date.now()}.jpg`);
});
// Stop the camera in the background and resume when the page comes back.
document.addEventListener('visibilitychange', async () => {
  if (!S.running) return;
  if (document.hidden) { if (S.stream) S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
  else { try { await openCamera(); } catch (err) { ui.hint.textContent = cameraError(err); ui.hint.classList.add('show'); } }
});
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  ui.status.textContent = window.isSecureContext ? 'This browser has no camera access.' : 'The camera only works over https.';
  ui.go.disabled = true;
}
window.__xray = { S };
