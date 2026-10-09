# X-Ray Cam

Point your phone's camera at your hand and see the bones move. A toy X-ray camera that runs in the browser.

**Try it: https://denis1stomin.github.io/xray-cam/**

> Just for fun. It's a toy, not a medical device: the bones are drawn by the app from hand tracking, not seen through your skin.

## How it works

1. **The X-ray look:** a WebGL shader turns the camera picture into a radiograph-style negative. It's softened, inverted and given a faint edge glow, a cold blue tint, a vignette and film grain.
2. **Hand tracking:** [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) finds 21 joints per hand (up to two hands), on the device.
3. **The skeleton:** from those joints the app draws the bones: metacarpals, phalanges with joint gaps, 9 wrist bones, and the radius and ulna fading out. Each bone has a bright cortex rim and a darker canal, the way bones look on film. A light filter removes jitter.
4. **Snapshot:** the shutter button saves the frame as an "X-ray film" with an L/R side marker and a "not a medical image" label, through the share sheet on iPhone.

Nothing is uploaded: the video is processed on the phone, and the hand-tracking library and model ship with the app.

## Run locally

No build step. The camera needs `https` or `localhost`:

```bash
python3 -m http.server 8000 -d app
```

Open `http://localhost:8000/`. Add `?debug` to see the frame rate and tracking time, or `?cpu` to force CPU tracking.

## Tests

```bash
node --test tests/*.test.mjs
```

## Layout

| Path | What's there |
| --- | --- |
| `app/index.html`, `app/style.css` | Screens and styles |
| `app/js/main.js` | Camera, frame loop, UI |
| `app/js/xray.js` | WebGL X-ray shader |
| `app/js/hands.js` | MediaPipe hand tracking (GPU, falls back to CPU) |
| `app/js/geometry.js` | Screen mapping, skeleton layout, bone outlines, smoothing |
| `app/js/bones.js` | Drawing the bones |
| `app/js/snapshot.js` | The "X-ray film" picture and sharing |
| `app/vendor/mediapipe/`, `app/models/` | MediaPipe Tasks Vision 0.10.35 and the hand landmarker model (Apache 2.0, see `THIRD_PARTY.md`) |

On every push to `main`, `.github/workflows/pages.yml` runs the tests and publishes `app/` to GitHub Pages.
