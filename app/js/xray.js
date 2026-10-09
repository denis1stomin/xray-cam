// The X-ray look for the whole camera picture, as a WebGL fragment shader:
// grey-scale, softened, inverted (dense = bright), a faint edge glow so
// objects look "see-through", then a cold blue tint, vignette and film grain.

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); // 0..1, y down
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform vec2 u_uvScale;   // screen uv -> video uv ("object-fit: cover")
uniform vec2 u_uvOffset;
uniform vec2 u_texel;     // one video pixel in uv
uniform float u_mirror;
uniform float u_time;
uniform vec2 u_res;

float lum(vec2 uv) { return dot(texture2D(u_video, uv).rgb, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 s = v_uv;
  if (u_mirror > 0.5) s.x = 1.0 - s.x;
  vec2 uv = s * u_uvScale + u_uvOffset;
  vec2 r = u_texel * 2.5;
  // Soft 9-tap blur: X-ray film has no crisp photo detail.
  float b = lum(uv) * 0.25
    + (lum(uv + vec2(r.x, 0.0)) + lum(uv - vec2(r.x, 0.0)) + lum(uv + vec2(0.0, r.y)) + lum(uv - vec2(0.0, r.y))) * 0.125
    + (lum(uv + r) + lum(uv - r) + lum(uv + vec2(r.x, -r.y)) + lum(uv + vec2(-r.x, r.y))) * 0.0625;
  // Edges (cheap Sobel) glow faintly, like outlines on a radiograph.
  vec2 e = u_texel * 1.5;
  float gx = lum(uv + vec2(e.x, 0.0)) - lum(uv - vec2(e.x, 0.0));
  float gy = lum(uv + vec2(0.0, e.y)) - lum(uv - vec2(0.0, e.y));
  float edge = smoothstep(0.02, 0.25, length(vec2(gx, gy)));
  // Invert and push the mid-tones down so the background goes dark.
  float v = smoothstep(0.12, 0.92, 1.0 - b);
  v = pow(v, 1.6) * 0.85 + edge * 0.35;
  // Vignette and grain.
  float d = length(v_uv - 0.5) * 1.35;
  v *= 1.0 - 0.6 * pow(d, 2.4);
  v += (hash(v_uv * u_res + u_time) - 0.5) * 0.07;
  vec3 col = vec3(v * 0.8, v * 0.93, v * 1.06) + vec3(0.0, 0.012, 0.03);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export function createXray(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL is not available');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Video frames are not powers of two: clamp and no mipmaps (WebGL 1 rules).
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const u = Object.fromEntries(['u_video', 'u_uvScale', 'u_uvOffset', 'u_texel', 'u_mirror', 'u_time', 'u_res']
    .map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.uniform1i(u.u_video, 0);

  return {
    // fit: coverFit(videoW, videoH, canvasW, canvasH) in canvas pixels.
    render(video, fit, mirror, time) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      const w = fit.srcW * fit.scale; const h = fit.srcH * fit.scale;
      gl.uniform2f(u.u_uvScale, fit.dstW / w, fit.dstH / h);
      gl.uniform2f(u.u_uvOffset, -fit.ox / w, -fit.oy / h);
      gl.uniform2f(u.u_texel, 1 / fit.srcW, 1 / fit.srcH);
      gl.uniform1f(u.u_mirror, mirror ? 1 : 0);
      gl.uniform1f(u.u_time, time % 1000);
      gl.uniform2f(u.u_res, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
