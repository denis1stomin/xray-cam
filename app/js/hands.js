// Hand tracking with MediaPipe Hand Landmarker, running on the device.
// The library, its WebAssembly and the model ship with the app (vendor/, models/),
// so nothing is fetched from third-party servers.
import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const here = (p) => new URL(p, import.meta.url).href;

// Tries the GPU first (faster) and falls back to the CPU, which is the safer
// choice on some iPhones. `?cpu` in the address forces the CPU.
export async function createTracker({ forceCpu = false } = {}) {
  const files = await FilesetResolver.forVisionTasks(here('../vendor/mediapipe/wasm'));
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: here('../models/hand_landmarker.task'), delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let delegate = forceCpu ? 'CPU' : 'GPU';
  let lm;
  try {
    lm = await HandLandmarker.createFromOptions(files, options(delegate));
  } catch (err) {
    if (delegate === 'CPU') throw err;
    delegate = 'CPU';
    lm = await HandLandmarker.createFromOptions(files, options(delegate));
  }
  return {
    delegate,
    // Returns [{ landmarks: [21 x {x, y, z}] normalised, label: 'Left' | 'Right' }].
    detect(video, timestampMs) {
      const res = lm.detectForVideo(video, timestampMs);
      return (res.landmarks || []).map((landmarks, i) => ({
        landmarks,
        label: res.handedness?.[i]?.[0]?.categoryName || 'Right',
      }));
    },
    close() { lm.close(); },
  };
}
