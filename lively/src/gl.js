/* WebGL2 grading pipeline. One fragment pass does crop/rotate/flip,
   white balance, tone, colour, split toning, sharpening, grain and
   vignette; a second texture lets the loop effect cross-fade its seam.
   Long exposure averages frames into a float framebuffer first. */

import { ADJUST_KEYS, lookById, ASPECTS } from './state.js';

const VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 pos = p * 2.0 - 1.0;
  v_uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
uniform sampler2D u_src2;
uniform float u_mix2;
uniform vec2 u_cropOrigin;
uniform vec2 u_cropSize;
uniform int u_rot;
uniform bool u_flip;
uniform vec2 u_texel;
uniform float u_bypass;
uniform float u_split;
uniform vec2 u_outSize;
uniform float u_seed;
uniform bool u_flipOut;

uniform float u_exposure, u_brightness, u_highlights, u_shadows, u_contrast, u_blacks;
uniform float u_saturation, u_vibrance, u_warmth, u_tint;
uniform float u_sharpness, u_fade, u_grain, u_vignette;
uniform vec4 u_splitShadow;
uniform vec4 u_splitHigh;
uniform float u_mono;
uniform vec3 u_monoTint;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec2 srcUV(vec2 uv) {
  vec2 r = u_cropOrigin + uv * u_cropSize;
  if (u_flip) r.x = 1.0 - r.x;
  if (u_rot == 1) return vec2(r.y, 1.0 - r.x);
  if (u_rot == 2) return vec2(1.0 - r.x, 1.0 - r.y);
  if (u_rot == 3) return vec2(1.0 - r.y, r.x);
  return r;
}

vec3 fetch(vec2 s) {
  vec3 a = texture(u_src, s).rgb;
  if (u_mix2 > 0.0) a = mix(a, texture(u_src2, s).rgb, u_mix2);
  return a;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 grade(vec3 c, vec2 uv) {
  // white balance
  c *= vec3(1.0 + u_warmth * 0.11 + u_tint * 0.025,
            1.0 + u_warmth * 0.015 - u_tint * 0.075,
            1.0 - u_warmth * 0.12 + u_tint * 0.025);

  // exposure in (approximately) linear light
  if (abs(u_exposure) > 0.0001) {
    vec3 lin = pow(max(c, 0.0), vec3(2.2)) * exp2(u_exposure * 1.5);
    c = pow(lin, vec3(1.0 / 2.2));
  }

  // brightness: midtone gamma
  c = pow(max(c, 0.0), vec3(exp2(-u_brightness * 0.55)));

  // highlights / shadows on luminance, colour ratio preserved
  float L = luma(c);
  float hMask = smoothstep(0.35, 1.0, L);
  float sMask = 1.0 - smoothstep(0.0, 0.6, L);
  float newL = L;
  newL += u_shadows * 0.32 * sMask * (u_shadows > 0.0 ? (1.0 - L) : L);
  newL += u_highlights * 0.32 * hMask * (u_highlights > 0.0 ? (1.0 - L) : L);
  c = L > 0.002 ? c * (newL / L) : c + (newL - L);

  // contrast: S-curve for positive, flatten toward mid-grey for negative
  if (u_contrast > 0.0) {
    vec3 s = clamp(c, 0.0, 1.0);
    c = mix(c, s * s * (3.0 - 2.0 * s), u_contrast * 0.95);
  } else {
    c = mix(c, vec3(0.5), -u_contrast * 0.4);
  }

  // black point
  float bp = u_blacks * 0.09;
  c = (c - bp) / (1.0 - bp);

  // fade (matte blacks, softer whites)
  c = mix(c, vec3(0.11) + c * 0.83, u_fade);

  // saturation & vibrance
  L = luma(c);
  c = mix(vec3(L), c, 1.0 + u_saturation);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(L), c, 1.0 + u_vibrance * (1.0 - clamp(sat, 0.0, 1.0)) * 1.1);

  // split toning
  L = clamp(luma(c), 0.0, 1.0);
  vec3 sh = u_splitShadow.rgb - vec3(luma(u_splitShadow.rgb));
  vec3 hi = u_splitHigh.rgb - vec3(luma(u_splitHigh.rgb));
  c += sh * u_splitShadow.a * (1.0 - L) * (1.0 - L) * 0.55;
  c += hi * u_splitHigh.a * L * L * 0.42;

  // monochrome
  if (u_mono > 0.0) c = mix(c, vec3(luma(c)) * u_monoTint, u_mono);

  // vignette
  if (u_vignette > 0.0) {
    float aspect = u_outSize.x / u_outSize.y;
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d) / length(vec2(aspect, 1.0) * 0.5);
    c *= 1.0 - u_vignette * 0.72 * smoothstep(0.38, 1.05, r);
  }

  // grain
  if (u_grain > 0.0) {
    float n = hash(floor(uv * u_outSize) + u_seed) - 0.5;
    float m = 1.0 - abs(luma(c) - 0.5) * 1.2;
    c += n * u_grain * 0.13 * m;
  }
  return c;
}

void main() {
  // export renders bottom-up so readPixels() returns rows top-down
  vec2 uv = u_flipOut ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv;
  vec2 s = srcUV(uv);
  vec3 c = fetch(s);
  bool edited = u_bypass < 0.5 && (u_split < 0.0 || uv.x > u_split);
  if (edited) {
    if (u_sharpness > 0.001) {
      vec3 b = (fetch(s + vec2(u_texel.x, 0.0)) + fetch(s - vec2(u_texel.x, 0.0)) +
                fetch(s + vec2(0.0, u_texel.y)) + fetch(s - vec2(0.0, u_texel.y))) * 0.25;
      c += (c - b) * u_sharpness * 1.8;
    }
    c = grade(c, uv);
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/* Running average for long exposure: draw frame i with alpha 1/(i+1). */
const ACC_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform float u_weight;
// Framebuffer row 0 is the bottom of the viewport; sample flipped so the
// stored average keeps the "row 0 = image top" layout of uploaded frames.
void main() { outColor = vec4(texture(u_src, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, u_weight); }`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function program(gl, fragSource) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragSource));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    uniforms[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, uniforms };
}

function makeTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  return tex;
}

/* ------------------------------------------------------------ geometry */

export function aspectValue(id, w, h) {
  const found = ASPECTS.find((a) => a.id === id);
  return found && found.value ? found.value : w / h;
}

/** Crop rectangle in rotated-source space, normalised for the shader. */
export function cropGeometry(srcW, srcH, crop) {
  const rot = (((crop.rotate || 0) % 360) + 360) % 360 / 90;
  const rw = rot % 2 ? srcH : srcW;
  const rh = rot % 2 ? srcW : srcH;
  const A = aspectValue(crop.aspect, rw, rh);
  let cw;
  let ch;
  if (rw / rh > A) { ch = rh; cw = rh * A; } else { cw = rw; ch = rw / A; }
  const zoom = Math.max(1, crop.zoom || 1);
  cw /= zoom;
  ch /= zoom;
  const x0 = (rw - cw) * (0.5 + (crop.x || 0) * 0.5);
  const y0 = (rh - ch) * (0.5 + (crop.y || 0) * 0.5);
  return {
    rot, rw, rh, cw, ch,
    origin: [x0 / rw, y0 / rh],
    size: [cw / rw, ch / rh],
    aspect: cw / ch,
    maxW: Math.round(cw),
    maxH: Math.round(ch),
  };
}

/** Largest even-sized output with the crop's aspect and the given long edge. */
export function outputSize(geometry, longEdge) {
  const limit = Math.min(longEdge, Math.max(geometry.maxW, geometry.maxH));
  let w;
  let h;
  if (geometry.aspect >= 1) { w = limit; h = limit / geometry.aspect; } else { h = limit; w = limit * geometry.aspect; }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(w), height: even(h) };
}

/** Merge look (scaled by amount) and manual adjustments into shader params. */
export function gradeParams(edit, customLooks = [], overrideLook = null) {
  const look = overrideLook || lookById(edit.look.id, customLooks);
  const amount = overrideLook ? 1 : (edit.look.id === 'original' ? 0 : edit.look.amount);
  const adjust = overrideLook ? {} : edit.adjust;
  const params = {};
  for (const key of ADJUST_KEYS) params[key] = (look.p[key] || 0) * amount + (adjust[key] || 0);
  const split = look.split || null;
  params.splitShadow = split ? [...split.shadow, split.amount * amount] : [0.5, 0.5, 0.5, 0];
  params.splitHigh = split ? [...split.high, split.amount * amount] : [0.5, 0.5, 0.5, 0];
  params.mono = (look.mono || 0) * amount;
  params.monoTint = look.monoTint || [1, 1, 1];
  return params;
}

/* ------------------------------------------------------------ renderer */

export class Renderer {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, premultipliedAlpha: false,
      preserveDrawingBuffer: preserve, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.main = program(gl, FRAG);
    this.acc = program(gl, ACC_FRAG);
    this.tex = makeTexture(gl);
    this.tex2 = makeTexture(gl);
    this.vao = gl.createVertexArray();
    this.srcW = 1;
    this.srcH = 1;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.accum = null;
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  get lost() { return this.gl.isContextLost(); }

  /** Upload any drawable (video, bitmap, canvas, VideoFrame) as the main input. */
  setSource(source, width, height) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.srcW = width || source.videoWidth || source.displayWidth || source.width || 1;
    this.srcH = height || source.videoHeight || source.displayHeight || source.height || 1;
    this.useAccum = false;
  }

  setSecond(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /**
   * Draw the graded frame.
   * opts: { crop, bypass, split, seed, mix2 }
   */
  render(params, opts) {
    const gl = this.gl;
    const { prog, uniforms: u } = this.main;
    const geometry = cropGeometry(this.srcW, this.srcH, opts.crop);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.useAccum ? this.accum.tex : this.tex);
    gl.uniform1i(u.u_src, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex2);
    gl.uniform1i(u.u_src2, 1);
    gl.uniform1f(u.u_mix2, opts.mix2 || 0);
    gl.uniform2f(u.u_cropOrigin, geometry.origin[0], geometry.origin[1]);
    gl.uniform2f(u.u_cropSize, geometry.size[0], geometry.size[1]);
    gl.uniform1i(u.u_rot, geometry.rot);
    gl.uniform1i(u.u_flip, opts.crop.flip ? 1 : 0);
    gl.uniform2f(u.u_texel, 1 / this.srcW, 1 / this.srcH);
    gl.uniform1f(u.u_bypass, opts.bypass ? 1 : 0);
    gl.uniform1f(u.u_split, opts.split == null ? -1 : opts.split);
    gl.uniform2f(u.u_outSize, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_seed, opts.seed || 0);
    gl.uniform1i(u.u_flipOut, opts.flipOut ? 1 : 0);
    for (const key of ADJUST_KEYS) gl.uniform1f(u[`u_${key}`], params[key] || 0);
    gl.uniform4fv(u.u_splitShadow, params.splitShadow);
    gl.uniform4fv(u.u_splitHigh, params.splitHigh);
    gl.uniform1f(u.u_mono, params.mono);
    gl.uniform3fv(u.u_monoTint, params.monoTint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return geometry;
  }

  /** RGBA bytes of the current drawing buffer (bottom-up unless rendered with flipOut). */
  readPixels() {
    const gl = this.gl;
    const { width, height } = this.canvas;
    if (!this.pixels || this.pixels.length !== width * height * 4) this.pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    return this.pixels;
  }

  /* ---- long exposure ---- */

  beginAccumulate(width, height) {
    const gl = this.gl;
    this.endAccumulate(true);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let internal = gl.RGBA8;
    let type = gl.UNSIGNED_BYTE;
    if (this.floatOK) { internal = gl.RGBA16F; type = gl.HALF_FLOAT; }
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && internal !== gl.RGBA8) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.accum = { tex, fbo, width, height, count: 0 };
  }

  accumulate(source) {
    const gl = this.gl;
    const acc = this.accum;
    if (!acc) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    gl.viewport(0, 0, acc.width, acc.height);
    gl.useProgram(this.acc.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.acc.uniforms.u_src, 0);
    gl.uniform1f(this.acc.uniforms.u_weight, 1 / (acc.count + 1));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    acc.count += 1;
  }

  /** Use the accumulated average as the source for render(). */
  useAccumulated() {
    if (!this.accum) return false;
    this.useAccum = true;
    this.srcW = this.accum.width;
    this.srcH = this.accum.height;
    return true;
  }

  get hasAccumulated() { return !!this.accum && this.accum.count > 0; }

  endAccumulate(silent = false) {
    if (!this.accum) return;
    const gl = this.gl;
    gl.deleteFramebuffer(this.accum.fbo);
    gl.deleteTexture(this.accum.tex);
    this.accum = null;
    this.useAccum = false;
    if (!silent) this.srcW = this.srcH = 1;
  }
}
