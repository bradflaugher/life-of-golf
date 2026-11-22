// Life of Golf — Three.js isometric renderer: a hand-painted meadow course floating above a sunlit valley.
// Textures are built from dabs of broken colour and the frame is finished with an oil-paint filter.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  DIRS,
  TERRAIN,
  RAMP_DIR,
  CONV_DIR,
  simulateShot,
} from './engine.js';

const TILE_SIZE = 1.0;
const ELEV_STEP = 0.42;
const BASE_THICKNESS = 0.65;
const CAP_H = 0.1;
const BALL_R = 0.2;

// Render layers. The land is painted; the game pieces are rendered realistically and left unpainted.
const LAYER_WORLD = 0; // terrain, props, backdrop: goes through the paint filter
const LAYER_PIECES = 1; // ball, pin, flag, aim guides: physically shaded, drawn sharp over the finished painting
const LAYER_FX = 2; // soft see-through effects: painted, but never hide a game piece
const CAM_RADIUS = 16;
const CAM_Y = 12.2;
const CAM_ELEV_SIN = CAM_Y / Math.hypot(CAM_RADIUS, CAM_Y);
const CAM_ELEV_COS = CAM_RADIUS / Math.hypot(CAM_RADIUS, CAM_Y);

// Aim-guide paint: chalk white for a clean shot, gold for the cup or a hint, coral for trouble.
const PAINT = {
  good: 0xfffdf2,
  gold: 0xf5c542,
  bad: 0xe5533d,
  idle: 0x8fa08c,
  outline: 0x1d3b2a,
};

const THEMES = {
  // "Morning Round": clear blue sky, sun on the meadow.
  light: {
    skyTop: '#4f9fe6',
    skyMid: '#9fd2f5',
    skyHaze: '#fdf3d3',
    sunGlow: '#fff3c4',
    cloud: '#ffffff',
    cloudShade: '#d9e9f7',
    hillFar: '#8fb4dc',
    hillMid: '#6fb090',
    hillNear: '#74b56f',
    valley: '#9fd07a',
    mist: '#eef5df',
    hemiSky: 0xd8ecff,
    hemiGround: 0xa9a4dc,
    hemiInt: 1.5,
    sunColor: 0xfff0cf,
    sunInt: 2.5,
    rimColor: 0xbfe0ff,
    rimInt: 0.5,
    turfA: '#8fd65e',
    turfB: '#6fb84c',
    turfDark: '#5fa640',
    ramp: '#93d968',
    soil: '#c79a66',
    soilDark: '#a67c4f',
    rock: 0x9c8468,
    hedge: '#3f8f45',
    hedgeDark: '#2f7438',
    sand: '#f5e4ae',
    sandLine: '#dcc586',
    water: '#58bfe8',
    waterDeep: '#3a9fd6',
    ice: '#dff5fd',
    mud: '#8a6645',
    mudDark: '#6d4e33',
    plank: '#b9814e',
    plankDark: '#93613a',
    cloud3d: 0xffffff,
    bloom: 0.2,
  },
  // "Golden Hour": low amber sun, long warm light.
  dark: {
    skyTop: '#5d7fc4',
    skyMid: '#f2b98f',
    skyHaze: '#ffe2a8',
    sunGlow: '#ffd58a',
    cloud: '#fff1dc',
    cloudShade: '#f0b9a0',
    hillFar: '#c2a3b8',
    hillMid: '#a98f8a',
    hillNear: '#8d9a5c',
    valley: '#b9b866',
    mist: '#f6e3b8',
    hemiSky: 0xffe2c2,
    hemiGround: 0xb894c4,
    hemiInt: 1.35,
    sunColor: 0xffd49a,
    sunInt: 2.7,
    rimColor: 0xffb48a,
    rimInt: 0.55,
    turfA: '#9ccb54',
    turfB: '#7fb044',
    turfDark: '#6a9a38',
    ramp: '#a2d05c',
    soil: '#c8925c',
    soilDark: '#a57246',
    rock: 0x9a7c60,
    hedge: '#4a8a3e',
    hedgeDark: '#386e32',
    sand: '#f7dfa0',
    sandLine: '#deb974',
    water: '#6cc0de',
    waterDeep: '#4a9fca',
    ice: '#e6f3f6',
    mud: '#8a6040',
    mudDark: '#6c482e',
    plank: '#b87a48',
    plankDark: '#925c36',
    cloud3d: 0xfff0dc,
    bloom: 0.26,
  },
};

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function makeCanvasTex(size, drawFn, { srgb = true, repeat = false, height = size } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  const ctx = c.getContext('2d');
  drawFn(ctx, size, height);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  return tex;
}

// A soft six-step ramp: light falls off in a few brushy bands instead of one hard cel edge.
function makeToonRamp() {
  const steps = [118, 150, 186, 218, 242, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Tangent-space normal map of golf-ball dimples, built from a height field of staggered dots.
function makeDimpleNormalMap() {
  const w = 256;
  const h = 128;
  const height = new Float32Array(w * h);
  const cols = 28;
  const rows = 14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (y / h) * rows;
      const row = Math.floor(v);
      const u = (x / w) * cols + (row % 2) * 0.5;
      const dx = (u - Math.floor(u) - 0.5) * 1.15;
      const dy = v - row - 0.5;
      const d = Math.hypot(dx, dy);
      height[y * w + x] = d < 0.4 ? -Math.cos((d / 0.4) * Math.PI * 0.5) : 0;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x + w - 1) % w)];
      const r = height[y * w + ((x + 1) % w)];
      const t = height[Math.max(0, y - 1) * w + x];
      const b = height[Math.min(h - 1, y + 1) * w + x];
      const nx = (l - r) * 2.2;
      const ny = (b - t) * 2.2;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function onLayer(obj, layer) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

// A painted material: `paint` draws the colour map.
function paintedMaterial(ramp, paint, { size = 128, height = size, repeat = true, extra = {} } = {}) {
  const map = makeCanvasTex(size, paint, { repeat, height });
  return new THREE.MeshToonMaterial({ map, gradientMap: ramp, ...extra });
}

// Broken colour: overlapping dabs from a small palette, the way an impressionist lays in a field.
function dabs(ctx, w, h, count, palette, seed, { min = 5, max = 12, alpha = 0.4, stretch = 1.6 } = {}) {
  for (let i = 0; i < count; i++) {
    const x = hash2(i, seed) * w;
    const y = hash2(i, seed + 2.9) * h;
    const r = min + hash2(i, seed + 6.3) * (max - min);
    ctx.globalAlpha = alpha * (0.55 + hash2(i, seed + 4.7) * 0.6);
    ctx.fillStyle = palette[Math.floor(hash2(i, seed + 8.1) * palette.length)];
    const rot = (hash2(i, seed + 1.4) - 0.5) * 1.2;
    // draw wrapped so the texture tiles without seams
    for (const ox of [0, -w, w]) {
      for (const oy of [0, -h, h]) {
        if (Math.abs(x + ox - w / 2) > w / 2 + r * stretch || Math.abs(y + oy - h / 2) > h / 2 + r * stretch) continue;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r * stretch, r, rot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// Short brush strokes, deterministic, used for grass, hedges and soil.
function strokes(ctx, s, count, color, len, seed, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = hash2(i, seed) * s;
    const y = hash2(i, seed + 3.7) * s;
    const lean = (hash2(i, seed + 9.1) - 0.5) * len * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - len * (0.6 + hash2(i, seed + 5.3) * 0.6));
    ctx.stroke();
  }
}

const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// Painted backdrop: a soft sky with drifting clouds and a warm sun, layered hills in
// atmospheric haze, and a misty valley far below the floating course.
const BACKDROP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uRes;
  uniform float uHorizon;
  uniform vec2 uSun;
  uniform vec3 cTop;
  uniform vec3 cMid;
  uniform vec3 cHaze;
  uniform vec3 cSun;
  uniform vec3 cCloud;
  uniform vec3 cCloudShade;
  uniform vec3 cHillFar;
  uniform vec3 cHillMid;
  uniform vec3 cHillNear;
  uniform vec3 cValley;
  uniform vec3 cMist;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }
  float ridge(float x, float seed) {
    return noise(vec2(x + seed, seed)) * 0.6 + noise(vec2(x * 2.3 + seed, seed * 1.7)) * 0.28
      + noise(vec2(x * 5.1 + seed, seed * 3.1)) * 0.12;
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    float xa = (vUv.x - 0.5) * aspect;
    float yy = vUv.y - uHorizon;
    float px = 1.5 / uRes.y;

    // Sky
    float t = clamp(yy / max(0.001, 1.0 - uHorizon), 0.0, 1.0);
    vec3 col = mix(cHaze, cMid, smoothstep(0.0, 0.38, t));
    col = mix(col, cTop, smoothstep(0.3, 1.0, t));

    // Sun: a soft disc inside a wide warm bloom
    vec2 sv = (vUv - uSun / uRes) * vec2(aspect, 1.0);
    float sd = length(sv);
    col += cSun * exp(-sd * 5.5) * 0.55;
    col = mix(col, vec3(1.0, 0.99, 0.93), smoothstep(0.034, 0.02, sd));

    // Clouds: two cel-edged layers drifting at different speeds
    float cl = fbm(vec2(xa * 1.5 + uTime * 0.012, yy * 4.6 + 3.0));
    float cl2 = fbm(vec2(xa * 2.6 - uTime * 0.008 + 7.0, yy * 8.0));
    float mask = smoothstep(0.03, 0.22, yy);
    float body = smoothstep(0.58, 0.63, cl) * mask;
    float lit = smoothstep(0.64, 0.69, cl);
    col = mix(col, mix(cCloudShade, cCloud, lit), body * 0.82);
    col = mix(col, cCloud, smoothstep(0.66, 0.72, cl2) * mask * 0.45);

    // Hills, far to near
    float h1 = 0.05 + 0.12 * ridge(xa * 1.1, 3.0);
    col = mix(col, mix(cHillFar, cHaze, 0.22), smoothstep(px, -px, yy - h1));
    float h2 = -0.01 + 0.095 * ridge(xa * 1.9, 11.0);
    col = mix(col, mix(cHillMid, cHaze, 0.08), smoothstep(px, -px, yy - h2));
    // near ridge with a ragged treeline
    float h3 = -0.085 + 0.09 * ridge(xa * 2.7, 23.0) + 0.012 * noise(vec2(xa * 46.0, 3.0));
    vec3 near = mix(cHillNear, cValley, smoothstep(h3, h3 - 0.25, yy));
    // dappled cloud shadows drifting over the valley floor
    float dapple = fbm(vec2(xa * 2.2 + uTime * 0.01, yy * 7.0));
    near *= mix(0.9, 1.06, smoothstep(0.35, 0.65, dapple));
    near = mix(near, cMist, smoothstep(-0.2, -0.62, yy));
    col = mix(col, near, smoothstep(px, -px, yy - h3));

    // Broken colour: flecks of warm and cool laid over everything, wildflowers in the valley
    vec2 q = vec2(xa * 34.0, yy * 64.0);
    col += (noise(q) - 0.5) * 0.085 * vec3(1.0, 0.92, 0.6);
    col += (noise(q * 2.1 + 9.0) - 0.5) * 0.07 * vec3(0.55, 0.65, 1.0);
    float meadow = smoothstep(px, -px, yy - h3) * smoothstep(-0.6, -0.12, yy);
    float fleck = noise(vec2(xa * 70.0, yy * 150.0));
    col = mix(col, vec3(0.93, 0.33, 0.24), smoothstep(0.84, 0.9, fleck) * meadow * 0.28);
    col = mix(col, vec3(0.99, 0.93, 0.55), smoothstep(0.8, 0.88, noise(vec2(xa * 64.0 + 20.0, yy * 140.0))) * meadow * 0.16);

    // Haze pooling along the horizon
    col = mix(col, cHaze, exp(-abs(yy) * 16.0) * 0.26);

    // alpha 0.25 tells the paint pass this is backdrop: brush it fully
    gl_FragColor = vec4(col, 0.25);
    // No-ops when rendering into the bloom composer; needed on the direct (low quality) path.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Finishing pass: a Kuwahara filter flattens each neighbourhood to its calmest quadrant, which reads as
// brushwork; the lookup wobbles slightly so straight edges go hand-drawn, and a canvas grain sits on top.
const PaintShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    uSpread: { value: 1 },
    uAspect: { value: 1 },
    uBoard: { value: 0.38 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uSpread;
    uniform float uAspect;
    uniform float uBoard;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      vec2 g = vUv * vec2(uAspect, 1.0);
      vec2 step = uTexel * uSpread;
      vec4 src = texture2D(tDiffuse, vUv);
      vec2 uv = vUv + (vec2(noise(g * 70.0), noise(g * 70.0 + 31.7)) - 0.5) * step * 3.2;

      vec3 m0 = vec3(0.0); vec3 m1 = vec3(0.0); vec3 m2 = vec3(0.0); vec3 m3 = vec3(0.0);
      vec3 s0 = vec3(0.0); vec3 s1 = vec3(0.0); vec3 s2 = vec3(0.0); vec3 s3 = vec3(0.0);
      for (int j = 0; j <= 3; j++) {
        for (int i = 0; i <= 3; i++) {
          vec2 o = vec2(float(i), float(j)) * step;
          vec3 c;
          c = texture2D(tDiffuse, uv + vec2(-o.x, -o.y)).rgb; m0 += c; s0 += c * c;
          c = texture2D(tDiffuse, uv + vec2(o.x, -o.y)).rgb; m1 += c; s1 += c * c;
          c = texture2D(tDiffuse, uv + vec2(o.x, o.y)).rgb; m2 += c; s2 += c * c;
          c = texture2D(tDiffuse, uv + vec2(-o.x, o.y)).rgb; m3 += c; s3 += c * c;
        }
      }
      const float n = 16.0;
      m0 /= n; m1 /= n; m2 /= n; m3 /= n;
      vec3 v0 = abs(s0 / n - m0 * m0); vec3 v1 = abs(s1 / n - m1 * m1);
      vec3 v2 = abs(s2 / n - m2 * m2); vec3 v3 = abs(s3 / n - m3 * m3);
      float e0 = v0.r + v0.g + v0.b; float e1 = v1.r + v1.g + v1.b;
      float e2 = v2.r + v2.g + v2.b; float e3 = v3.r + v3.g + v3.b;

      vec3 col = m0;
      float best = e0;
      if (e1 < best) { best = e1; col = m1; }
      if (e2 < best) { best = e2; col = m2; }
      if (e3 < best) { col = m3; }

      // canvas tooth
      col *= 0.965 + 0.07 * noise(g * 420.0);
      // The alpha channel says how much brush each pixel takes:
      //   ~0.25 backdrop: fully painted   1.0 the course: lightly brushed
      // (game pieces are not in this image at all: PiecesPass draws them afterwards)
      float amount = mix(1.0, uBoard, smoothstep(0.4, 0.8, src.a));
      col = mix(src.rgb, col, amount);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// Draws the game pieces (ball, pin, aim guides) over the finished painting, untouched by paint or bloom.
// The composer's buffers do not share depth, so the land is first laid down depth-only to hide pieces behind it.
class PiecesPass extends Pass {
  constructor(owner) {
    super();
    this.owner = owner;
    this.scene = owner.scene;
    this.camera = owner.camera;
    this.needsSwap = false;
    this.depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  }

  render(renderer, writeBuffer, readBuffer) {
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const mask = this.camera.layers.mask;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();

    // the cup is sunk below the turf, so its tile's cap must not hide it
    const cupCap = this.owner.cupCap;
    if (cupCap) cupCap.visible = false;
    this.camera.layers.set(LAYER_WORLD);
    this.scene.overrideMaterial = this.depthOnly;
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    if (cupCap) cupCap.visible = true;

    this.camera.layers.set(LAYER_PIECES);
    renderer.render(this.scene, this.camera);

    this.camera.layers.mask = mask;
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadowAuto;
  }

  dispose() {
    this.depthOnly.dispose();
  }
}

export class GolfRenderer3D {
  constructor(canvas, { onDirectionPick, onSwipeDirection, theme = 'light', quality = 'auto' } = {}) {
    this.canvas = canvas;
    this.onDirectionPick = onDirectionPick;
    this.onSwipeDirection = onSwipeDirection;
    this.themeName = theme === 'dark' ? 'dark' : 'light';
    this.reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Quality: "high" = bloom composer, "low" = direct render. "auto" starts high and steps down if frames drag.
    this.qualityMode = quality === 'high' || quality === 'low' ? quality : 'auto';
    this.quality = this.qualityMode === 'low' ? 'low' : 'high';
    this.frameAvg = 16;
    this.frameCount = 0;

    this.scene = new THREE.Scene();
    // Image-based light for the physically shaded pieces (ball, pin, cup). Painted materials ignore it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Orthographic isometric camera
    this.frustumSize = 10;
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.orbitIndex = 0; // 0..3 (90 deg increments around Y)
    this.orbitAngle = Math.PI / 4;
    this.targetOrbitAngle = Math.PI / 4;

    // Lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 1.2);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sun.position.set(-7, 15, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -8;
    this.sun.shadow.camera.right = 8;
    this.sun.shadow.camera.top = 8;
    this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0xff4fd0, 0.9);
    this.rim.position.set(9, 6, -6);
    this.scene.add(this.rim);
    // lights are layer-tested like any object: let them reach the game-piece layer too
    for (const light of [this.hemi, this.sun, this.rim]) light.layers.enableAll();

    // Backdrop (drawn first, ignores depth)
    this.backdropUniforms = {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uHorizon: { value: 0.5 },
      uSun: { value: new THREE.Vector2(0, 0) },
      cTop: { value: new THREE.Color() },
      cMid: { value: new THREE.Color() },
      cHaze: { value: new THREE.Color() },
      cSun: { value: new THREE.Color() },
      cCloud: { value: new THREE.Color() },
      cCloudShade: { value: new THREE.Color() },
      cHillFar: { value: new THREE.Color() },
      cHillMid: { value: new THREE.Color() },
      cHillNear: { value: new THREE.Color() },
      cValley: { value: new THREE.Color() },
      cMist: { value: new THREE.Color() },
    };
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.backdropUniforms,
        vertexShader: BACKDROP_VERT,
        fragmentShader: BACKDROP_FRAG,
        depthTest: false,
        depthWrite: false,
        fog: false,
      })
    );
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -1000;
    this.scene.add(this.backdrop);

    // Groups
    this.islandGroup = new THREE.Group();
    this.scene.add(this.islandGroup);
    this.boardGroup = new THREE.Group();
    this.islandGroup.add(this.boardGroup);
    this.arrowGroup = new THREE.Group();
    this.islandGroup.add(this.arrowGroup);
    this.previewGroup = new THREE.Group();
    this.islandGroup.add(this.previewGroup);
    this.fxGroup = new THREE.Group();
    this.islandGroup.add(this.fxGroup);

    // Shared geometries (never disposed)
    const s = TILE_SIZE;
    this.toonRamp = makeToonRamp();
    this.geo = {
      cap: new THREE.BoxGeometry(s, CAP_H, s),
      overlay: new THREE.PlaneGeometry(s * 0.9, s * 0.9).rotateX(-Math.PI / 2),
      hedge: new RoundedBoxGeometry(0.84, 0.58, 0.84, 3, 0.13),
      topiary: new THREE.SphereGeometry(0.27, 14, 10),
      stal: new THREE.ConeGeometry(s * 0.71, 1, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, -0.5, 0),
      flower: new THREE.SphereGeometry(0.042, 6, 4).scale(1, 0.55, 1),
      tuft: new THREE.ConeGeometry(0.034, 0.15, 4).translate(0, 0.075, 0),
      stem: new THREE.CylinderGeometry(0.1, 0.13, 0.2, 12).translate(0, 0.1, 0),
      shroom: new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1),
      spot: new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.5, 1),
      stoneRing: new THREE.TorusGeometry(0.31, 0.075, 8, 20).rotateX(Math.PI / 2).scale(1, 0.7, 1),
      portalDisc: new THREE.CircleGeometry(0.25, 24).rotateX(-Math.PI / 2),
      pole: new THREE.CylinderGeometry(0.024, 0.028, 1.42, 16),
      finial: new THREE.SphereGeometry(0.036, 14, 10),
      cupWall: new THREE.CylinderGeometry(0.2, 0.2, 0.1, 28, 1, true),
      cupFloor: new THREE.CircleGeometry(0.2, 28).rotateX(-Math.PI / 2),
      cupLip: new THREE.TorusGeometry(0.207, 0.018, 8, 32).rotateX(Math.PI / 2),
      flag: new THREE.PlaneGeometry(0.66, 0.42, 18, 8).translate(0.33, 0, 0),
      puff: new THREE.SphereGeometry(1, 14, 10),
      spark: new THREE.SphereGeometry(0.05, 6, 6),
      dot: new THREE.SphereGeometry(0.05, 10, 8),
      ring: new THREE.RingGeometry(0.2, 0.3, 32).rotateX(-Math.PI / 2),
      ringCore: new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2),
      hitArrow: new THREE.BoxGeometry(0.92, 0.6, 0.98),
      hitTile: new THREE.BoxGeometry(0.96, 0.3, 0.96),
      beam: new THREE.CylinderGeometry(0.2, 0.2, 1, 20, 1, true),
      chevron: this.makeChevronGeometry(),
    };
    this.geo.beam.translate(0, 0.5, 0);

    // Ball
    this.ballGroup = new THREE.Group();
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 48, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        normalMap: makeDimpleNormalMap(),
        normalScale: new THREE.Vector2(0.55, 0.55),
        envMap: this.envMap,
        envMapIntensity: 0.9,
      })
    );
    this.ballGroup.add(this.ballMesh);
    onLayer(this.ballGroup, LAYER_PIECES);

    // Ground shadow blob under the ball (reads height during chips)
    const shadowGeo = new THREE.PlaneGeometry(0.62, 0.62);
    shadowGeo.rotateX(-Math.PI / 2);
    this.ballShadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: makeCanvasTex(64, (ctx, s) => {
          const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
          g.addColorStop(0, 'rgba(14,30,18,0.7)');
          g.addColorStop(0.45, 'rgba(14,30,18,0.3)');
          g.addColorStop(1, 'rgba(14,30,18,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        }),
        transparent: true,
        depthWrite: false,
      })
    );
    this.ballShadow.layers.set(LAYER_FX);
    this.islandGroup.add(this.ballShadow);
    this.islandGroup.add(this.ballGroup);

    // Comet trail behind the moving ball
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false });
    this.trail = [];
    this.trailHistory = [];
    const trailGeo = new THREE.SphereGeometry(BALL_R * 0.82, 10, 8);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(trailGeo, this.trailMat);
      m.visible = false;
      m.layers.set(LAYER_FX);
      this.fxGroup.add(m);
      this.trail.push(m);
    }

    // Drifting motes around the island
    this.motes = this.makeMotes();
    this.motes.layers.set(LAYER_FX);
    this.islandGroup.add(this.motes);

    // Cloud puffs drifting around and below the island
    this.cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: this.toonRamp, emissive: 0x8fa6bd, emissiveIntensity: 0.32 });
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);

    // Animated references
    this.columns = [];
    this.portalRings = [];
    this.portalDiscs = [];
    this.springRings = [];
    this.beams = [];
    this.flora = [];
    this.floraT = 1;
    this.flagCloth = null;
    this.arrowHitMeshes = [];
    this.tileHitMeshes = [];
    this.previewRings = [];
    this.particles = [];
    this.sparkMats = new Map();
    this.levelDisposables = [];
    this.shake = 0;
    this.introT = Infinity;
    this.ballPop = 1;

    // Animation state
    this.level = null;
    this.ballPos = { x: 0, y: 0 };
    this.ballElev = 0;
    this.animQueue = null;
    this.animResolve = null;

    this.mats = null;
    this.applyTheme(this.themeName);

    // Pointer / touch handling
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragStart = null;
    this.bindInput();

    this.setupPipeline();

    // Render loop
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
    this.resize();
  }

  makeChevronGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.26, -0.04);
    shape.lineTo(0, 0.26);
    shape.lineTo(0.26, -0.04);
    shape.lineTo(0.26, -0.2);
    shape.lineTo(0, 0.1);
    shape.lineTo(-0.26, -0.2);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // lie flat, pointing +Z
    return geo;
  }

  makeMotes() {
    const count = 46;
    const pos = new Float32Array(count * 3);
    this.moteSeeds = [];
    for (let i = 0; i < count; i++) {
      const ang = hash2(i, 1.7) * Math.PI * 2;
      const rad = 1.5 + hash2(i, 4.2) * 5.5;
      this.moteSeeds.push({ ang, rad, y: hash2(i, 8.8) * 7 - 2, speed: 0.12 + hash2(i, 3.1) * 0.3 });
      pos[i * 3] = Math.cos(ang) * rad;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(ang) * rad;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sprite = makeCanvasTex(32, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    // Pollen catching the light
    this.moteMat = new THREE.PointsMaterial({
      map: sprite,
      size: 5,
      sizeAttenuation: false,
      color: 0xfffbe0,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, this.moteMat);
    pts.frustumCulled = false;
    return pts;
  }

  makeClouds() {
    const group = new THREE.Group();
    this.cloudSeeds = [];
    for (let i = 0; i < 5; i++) {
      const cloud = new THREE.Group();
      const puffs = 4 + Math.floor(hash2(i, 2.2) * 3);
      for (let k = 0; k < puffs; k++) {
        const puff = new THREE.Mesh(this.geo.puff, this.cloudMat);
        const r = 0.34 + hash2(i * 7 + k, 5.1) * 0.36;
        puff.scale.set(r, r * 0.62, r * 0.85);
        puff.position.set((k - (puffs - 1) / 2) * 0.48, hash2(i * 3 + k, 8.4) * 0.22, (hash2(i + k, 1.9) - 0.5) * 0.5);
        cloud.add(puff);
      }
      this.cloudSeeds.push({
        ang: (i / 5) * Math.PI * 2 + hash2(i, 6.6),
        rad: 2.2 + hash2(i, 3.3) * 3.2,
        y: -2.6 - hash2(i, 9.1) * 3.0,
        speed: 0.012 + hash2(i, 4.4) * 0.02,
      });
      group.add(cloud);
    }
    return group;
  }

  setupPipeline() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
      this.paintPass = null;
    }
    const dpr = window.devicePixelRatio || 1;
    if (this.quality === 'high') {
      // The paint filter hides fine detail anyway, so the composer runs at a modest density.
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), THEMES[this.themeName].bloom, 0.7, 0.9);
      this.paintPass = new ShaderPass(PaintShader);
      this.composer.addPass(this.paintPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new PiecesPass(this));
      this.composer.addPass(new OutputPass());
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    }
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.setupPipeline();
    this.fitCamera();
  }

  /** Screen-space padding (CSS px) covered by HUD chrome; the course is framed inside what is left. */
  setInsets(insets = {}) {
    this.insets = {
      top: insets.top || 0,
      right: insets.right || 0,
      bottom: insets.bottom || 0,
      left: insets.left || 0,
    };
    this.fitCamera();
  }

  disposeMats() {
    if (!this.mats) return;
    const seen = new Set();
    const walk = (m) => {
      if (!m || seen.has(m)) return;
      if (m.isMaterial) {
        seen.add(m);
        if (m.map) m.map.dispose();
        if (m.emissiveMap) m.emissiveMap.dispose();
        m.dispose();
      } else if (typeof m === 'object') {
        Object.values(m).forEach(walk);
      }
    };
    walk(this.mats);
    this.mats = null;
  }

  buildMaterials() {
    this.disposeMats();
    const t = THEMES[this.themeName];
    const ramp = this.toonRamp;
    const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...o });
    const m = {};

    // Turf: mown in two tones, laid in with dabs of yellow, blue-green and a little violet shadow.
    const turfPalette = ['#c4e86e', '#a2dc5c', '#5aa84c', '#4aa07a', '#e9e57c', '#7f8fd2', '#6fbf52'];
    const turf = (base, seed) =>
      paintedMaterial(ramp, (ctx, s) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, s, s);
        dabs(ctx, s, s, 90, turfPalette, seed, { min: 4, max: 11, alpha: 0.3 });
        dabs(ctx, s, s, 26, ['#f4f0a0', '#d8f08a'], seed + 31, { min: 2, max: 5, alpha: 0.5 });
        strokes(ctx, s, 40, 'rgba(255,255,205,0.28)', 10, seed + 1.3);
        strokes(ctx, s, 26, 'rgba(30,80,50,0.2)', 8, seed + 6.1);
        // a loose, broken seam so the grid still reads under the brushwork
        ctx.strokeStyle = 'rgba(38,92,48,0.34)';
        ctx.lineCap = 'round';
        for (let i = 0; i < 28; i++) {
          const along = hash2(i, seed + 14.2) * s;
          const len = 8 + hash2(i, seed + 3.4) * 16;
          const side = i % 4;
          ctx.lineWidth = 2 + hash2(i, seed + 9.9) * 3;
          ctx.beginPath();
          if (side === 0) { ctx.moveTo(along, 1.5); ctx.lineTo(along + len, 1.5); }
          else if (side === 1) { ctx.moveTo(along, s - 1.5); ctx.lineTo(along + len, s - 1.5); }
          else if (side === 2) { ctx.moveTo(1.5, along); ctx.lineTo(1.5, along + len); }
          else { ctx.moveTo(s - 1.5, along); ctx.lineTo(s - 1.5, along + len); }
          ctx.stroke();
        }
      });
    m.grass = [turf(t.turfA, 1), turf(t.turfA, 40), turf(t.turfB, 80), turf(t.turfB, 120)];

    m.sand = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.sand;
      ctx.fillRect(0, 0, s, s);
      dabs(ctx, s, s, 60, ['#fff6d6', '#efd596', '#f7cdaa', '#e7d6ee', '#f9e7b4'], 3, { min: 5, max: 12, alpha: 0.5 });
      // raked arcs, drawn loosely
      ctx.strokeStyle = t.sandLine;
      ctx.lineCap = 'round';
      for (let r = 20, i = 0; r < s * 1.5; r += 19, i++) {
        ctx.globalAlpha = 0.45 + hash2(i, 2.2) * 0.3;
        ctx.lineWidth = 2 + hash2(i, 5.5) * 2.5;
        ctx.beginPath();
        ctx.arc(-6, s + 6, r + hash2(i, 7.1) * 4, -Math.PI / 2, 0);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    m.ice = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.ice;
      ctx.fillRect(0, 0, s, s);
      dabs(ctx, s, s, 60, ['#ffffff', '#c9e8f6', '#dcd6f4', '#b7e2f3', '#f4fbff'], 5, { min: 6, max: 14, alpha: 0.55, stretch: 2.2 });
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineCap = 'round';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(24, s - 34);
      ctx.lineTo(s - 40, 24);
      ctx.moveTo(56, s - 20);
      ctx.lineTo(s - 20, 60);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(110,150,205,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20, 30);
      ctx.lineTo(48, 52);
      ctx.lineTo(42, 84);
      ctx.moveTo(48, 52);
      ctx.lineTo(82, 58);
      ctx.stroke();
    }, { extra: { emissive: 0x9fd4ea, emissiveIntensity: 0.18 } });

    m.mud = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.mud;
      ctx.fillRect(0, 0, s, s);
      dabs(ctx, s, s, 60, [t.mudDark, '#a27a54', '#5c4a62', '#7a5a3c', '#b08a62'], 7, { min: 6, max: 13, alpha: 0.55 });
      ctx.fillStyle = 'rgba(255,240,220,0.2)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(hash2(i, 4.1) * s, hash2(i, 8.4) * s, 7, 2.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      strokes(ctx, s, 16, 'rgba(120,170,70,0.8)', 10, 12.5, 2.5);
    });

    // Pond: blues and violets in flat horizontal dabs, a glint or two, and lily pads.
    m.water = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.water;
      ctx.fillRect(0, 0, s, s);
      dabs(ctx, s, s, 80, ['#86d6f0', t.waterDeep, '#8f9fe8', '#bfe8f4', '#5fc7c0', '#6a8fd8'], 9, { min: 3, max: 7, alpha: 0.55, stretch: 3.2 });
      dabs(ctx, s, s, 16, ['#ffffff'], 21, { min: 1.2, max: 2.4, alpha: 0.85, stretch: 4 });
      for (const [px, py, pr] of [[38, 44, 13], [88, 84, 10], [96, 30, 7]]) {
        ctx.fillStyle = '#4f9c4a';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, pr, 0.5, Math.PI * 2 - 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7cc45c';
        ctx.beginPath();
        ctx.arc(px - pr * 0.2, py - pr * 0.2, pr * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const [px, py] of [[42, 40], [90, 80]]) {
        ctx.fillStyle = '#ffd0e2';
        ctx.beginPath();
        ctx.arc(px, py, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff3a0';
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { extra: { emissive: 0x2f86b8, emissiveIntensity: 0.25 } });

    // Boost strip: a boardwalk with chalked chevrons that slide along it.
    m.conveyor = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.plank;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = t.plankDark;
      ctx.lineWidth = 3;
      for (let y = 0; y <= s; y += s / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
      ctx.fillStyle = t.plankDark;
      for (let y = s / 8; y < s; y += s / 4) {
        for (const x of [12, s - 12]) {
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      dabs(ctx, s, s, 34, ['#d49a62', '#8f5c36', '#a8703f', '#7a5a6a'], 13, { min: 3, max: 6, alpha: 0.35, stretch: 3.5 });
    });
    m.chevrons = new THREE.MeshBasicMaterial({
      map: makeCanvasTex(128, (ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        ctx.strokeStyle = '#fffaf0';
        ctx.lineWidth = 11;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const yOff of [14, 78]) {
          ctx.beginPath();
          ctx.moveTo(34, yOff + 32);
          ctx.lineTo(s / 2, yOff + 6);
          ctx.lineTo(s - 34, yOff + 32);
          ctx.stroke();
        }
      }, { repeat: true }),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    m.ramp = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.ramp;
      ctx.fillRect(0, 0, s, s);
      dabs(ctx, s, s, 80, turfPalette, 55, { min: 4, max: 10, alpha: 0.38 });
      strokes(ctx, s, 40, 'rgba(255,255,205,0.28)', 9, 2.9);
      ctx.fillStyle = 'rgba(255,255,235,0.42)';
      for (const yOff of [28, 64, 100]) {
        ctx.beginPath();
        ctx.moveTo(s / 2, yOff - 15);
        ctx.lineTo(s - 34, yOff + 7);
        ctx.lineTo(34, yOff + 7);
        ctx.closePath();
        ctx.fill();
      }
    });
    m.rampSide = toon({ color: t.soil });

    // Cliff face: a lip of grass over layered soil. Two world units tall, clamped (never repeats down).
    m.cliff = paintedMaterial(ramp, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, t.soil);
      g.addColorStop(1, t.soilDark);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      dabs(ctx, w, h, 110, ['#dcae7c', '#b8865a', '#8f6a52', '#9c7c9e', '#c9905e', '#7a5a48'], 17, { min: 5, max: 12, alpha: 0.5, stretch: 2.4 });
      ctx.fillStyle = 'rgba(255,235,200,0.3)';
      for (let i = 0; i < 16; i++) {
        ctx.beginPath();
        ctx.ellipse(hash2(i, 2.4) * w, 34 + hash2(i, 5.7) * (h - 40), 5 + hash2(i, 1.2) * 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // overhanging grass with scalloped drips (tiles horizontally)
      ctx.fillStyle = t.turfDark;
      ctx.fillRect(0, 0, w, 15);
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc((i + 0.5) * (w / 8), 14, w / 16, 0, Math.PI);
        ctx.fill();
      }
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc((i * 2 + 0.5) * (w / 8), 20, w / 22, 0, Math.PI);
        ctx.fill();
      }
      ctx.fillStyle = t.turfB;
      ctx.fillRect(0, 0, w, 6);
      dabs(ctx, w, 20, 30, ['#c4e86e', '#5aa84c', '#4aa07a'], 23, { min: 2, max: 5, alpha: 0.6 });
    }, { height: 256 });
    m.cliff.map.wrapT = THREE.ClampToEdgeWrapping;
    m.rock = toon({ color: t.rock });

    // Boxwood hedge (walls)
    m.hedge = paintedMaterial(ramp, (ctx, s) => {
      ctx.fillStyle = t.hedge;
      ctx.fillRect(0, 0, s, s);
      dabs(ctx, s, s, 40, ['#2a6a52', '#3b5f8a', '#5aa84c', '#234f38'], 27, { min: 5, max: 10, alpha: 0.45 });
      ctx.fillStyle = t.hedgeDark;
      for (let i = 0; i < 60; i++) {
        ctx.beginPath();
        ctx.arc(hash2(i, 2.7) * s, hash2(i, 8.1) * s, 4 + hash2(i, 4.3) * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(200,240,150,0.5)';
      for (let i = 0; i < 46; i++) {
        ctx.beginPath();
        ctx.arc(hash2(i, 5.9) * s, hash2(i, 1.6) * s, 2.5 + hash2(i, 7.7) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    m.rimGrass = toon({ color: t.turfDark });
    m.rimSand = toon({ color: t.sandLine });
    m.rimIce = toon({ color: 0xb4dcec });
    m.rimMud = toon({ color: t.mudDark });
    m.rimWater = toon({ color: t.waterDeep });
    m.rimConv = toon({ color: t.plankDark });

    // Bouncy mushroom (springs)
    m.shroomStem = toon({ color: 0xf7edd8 });
    m.shroomCap = toon({ color: 0xe2503a });
    m.shroomSpot = toon({ color: 0xfffaf0 });

    // The pin and cup are real objects in a painted world: physically shaded, with reflections.
    const std = (o) => new THREE.MeshStandardMaterial({ envMap: this.envMap, ...o });
    m.cupWall = std({ color: 0xe9e6dc, roughness: 0.55, metalness: 0.05, side: THREE.BackSide, envMapIntensity: 0.4 });
    m.cupFloor = new THREE.MeshBasicMaterial({ color: 0x0c0a08 });
    m.cupLip = std({ color: 0xf7f5ee, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.8 });
    m.pole = new THREE.MeshPhysicalMaterial({ color: 0xfbfaf4, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap: this.envMap, envMapIntensity: 0.9 });
    m.metal = std({ color: 0xd8d8d2, roughness: 0.22, metalness: 1, envMapIntensity: 1.2 });
    m.flag = std({
      map: makeCanvasTex(128, (ctx, s) => {
        ctx.fillStyle = '#e8232d';
        ctx.fillRect(0, 0, s, s);
        // woven nylon: a faint weave and a stitched hem
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = '#000';
        for (let i = 0; i < s; i += 2) ctx.fillRect(i, 0, 1, s);
        for (let i = 0; i < s; i += 2) ctx.fillRect(0, i, s, 1);
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#5a0a10';
        ctx.lineWidth = 3;
        ctx.strokeRect(3, 3, s - 6, s - 6);
        ctx.globalAlpha = 1;
      }),
      roughness: 0.7,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.4,
      // cloth passes light: keep the shaded side a rich red rather than letting it go black
      emissive: 0xb0121c,
      emissiveIntensity: 0.45,
    });

    const beamTex = makeCanvasTex(64, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const beam = (hex, opacity) => {
      const mat = new THREE.MeshBasicMaterial({
        map: beamTex,
        color: hex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      mat.userData.baseOpacity = opacity;
      return mat;
    };
    m.beamCup = beam(0xfff2c0, 0.2);
    m.beamA = beam(0x6ff0e0, 0.26);
    m.beamB = beam(0xffc08a, 0.26);

    // Standing-stone rings with a slow swirl of light (portals)
    m.stone = toon({ color: 0xbdb6a6 });
    const swirlTex = makeCanvasTex(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 9;
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const a = (arm * Math.PI * 2) / 3 + i * 0.11;
          const r = 4 + i * 1.35;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
      }
    });
    const pool = (base, swirl) => ({
      base: new THREE.MeshBasicMaterial({ color: base }),
      disc: new THREE.MeshBasicMaterial({ map: swirlTex, color: swirl, transparent: true, opacity: 0.95, depthWrite: false }),
    });
    m.portalA = pool(0x1fae9f, 0xcffff6);
    m.portalB = pool(0xf07f45, 0xfff0d0);

    m.flower = new THREE.MeshBasicMaterial({ color: 0xffffff });
    m.tuft = toon({ color: 0xffffff });

    this.mats = m;
  }

  applyTheme(themeName) {
    this.themeName = themeName === 'dark' ? 'dark' : 'light';
    const t = THEMES[this.themeName];
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiInt;
    this.sun.color.setHex(t.sunColor);
    this.sun.intensity = t.sunInt;
    this.rim.color.setHex(t.rimColor);
    this.rim.intensity = t.rimInt;
    // Lower, longer light at golden hour
    if (this.themeName === 'dark') this.sun.position.set(-10, 10, 8);
    else this.sun.position.set(-7, 15, 9);

    const u = this.backdropUniforms;
    u.cTop.value.set(t.skyTop);
    u.cMid.value.set(t.skyMid);
    u.cHaze.value.set(t.skyHaze);
    u.cSun.value.set(t.sunGlow);
    u.cCloud.value.set(t.cloud);
    u.cCloudShade.value.set(t.cloudShade);
    u.cHillFar.value.set(t.hillFar);
    u.cHillMid.value.set(t.hillMid);
    u.cHillNear.value.set(t.hillNear);
    u.cValley.value.set(t.valley);
    u.cMist.value.set(t.mist);

    this.cloudMat.color.setHex(t.cloud3d);
    this.cloudMat.emissive.set(t.cloudShade);
    if (this.bloomPass) this.bloomPass.strength = t.bloom;

    this.buildMaterials();
    if (this.level) {
      this.loadLevel(this.level, this.ballPos, { intro: false });
    }
  }

  rotateCamera(delta = 1) {
    this.orbitIndex = (this.orbitIndex + delta + 4) % 4;
    this.targetOrbitAngle += delta * (Math.PI / 2);
  }

  gridToWorld(gx, gy, elev = 0) {
    const w = this.level ? this.level.width : 6;
    const h = this.level ? this.level.height : 6;
    return new THREE.Vector3(
      (gx - (w - 1) / 2) * TILE_SIZE,
      elev * ELEV_STEP,
      (gy - (h - 1) / 2) * TILE_SIZE
    );
  }

  track(obj) {
    this.levelDisposables.push(obj);
    return obj;
  }

  columnGeometry(height, cache) {
    if (cache.has(height)) return cache.get(height);
    const geo = this.track(new THREE.BoxGeometry(TILE_SIZE, height, TILE_SIZE));
    // Side faces: the cliff texture spans two world units from the top edge down.
    const uv = geo.attributes.uv;
    for (const face of [0, 1, 4, 5]) {
      for (let i = face * 4; i < face * 4 + 4; i++) {
        uv.setY(i, 1 - ((1 - uv.getY(i)) * height) / 2);
      }
    }
    cache.set(height, geo);
    return geo;
  }

  loadLevel(level, ballPos = level.start, { intro = true } = {}) {
    this.level = level;
    this.ballPos = { ...ballPos };
    const startTile = level.grid[ballPos.y][ballPos.x];
    this.ballElev = startTile.elev;

    // Clear previous meshes and per-level GPU resources
    this.boardGroup.clear();
    for (const d of this.levelDisposables) d.dispose();
    this.levelDisposables = [];
    this.columns = [];
    this.portalRings = [];
    this.portalDiscs = [];
    this.springRings = [];
    this.beams = [];
    this.flora = [];
    this.flagCloth = null;
    this.cupCap = null;
    this.cupDisc = null;
    this.clearArrows();

    const m = this.mats;
    const s = TILE_SIZE;
    const colGeos = new Map();
    const maxDist = Math.hypot(level.width, level.height) / 2;
    const flowers = [];
    const tufts = [];
    const dummy = new THREE.Object3D();
    let maxElev = 0;

    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const cell = level.grid[y][x];
        if (cell.terrain === TERRAIN.VOID) continue;
        maxElev = Math.max(maxElev, cell.elev);

        const pos = this.gridToWorld(x, y, cell.elev);
        const col = new THREE.Group();
        col.position.set(pos.x, 0, pos.z);
        const distStart = Math.hypot(x - level.start.x, y - level.start.y);
        col.userData.delay = distStart * 0.045 + hash2(x, y) * 0.05;
        this.columns.push(col);
        this.boardGroup.add(col);

        const isWater = cell.terrain === TERRAIN.WATER;
        const isSand = cell.terrain === TERRAIN.SAND;
        const isRamp = RAMP_DIR[cell.terrain] !== undefined;
        const isConv = CONV_DIR[cell.terrain] !== undefined;
        const sink = isWater ? 0.12 : isSand ? 0.04 : 0;
        const topY = pos.y - sink;
        const capBottom = isRamp ? topY : topY - CAP_H;

        // Soil column
        const colH = Math.round((capBottom + BASE_THICKNESS) * 1000) / 1000;
        const column = new THREE.Mesh(this.columnGeometry(colH, colGeos), m.cliff);
        column.position.y = capBottom - colH / 2;
        column.receiveShadow = true;
        column.castShadow = true;
        col.add(column);

        // Rock underside: longest under the middle of the island
        const centre = Math.hypot(x - (level.width - 1) / 2, y - (level.height - 1) / 2);
        const stal = new THREE.Mesh(this.geo.stal, m.rock);
        stal.scale.y = 0.35 + (1 - centre / maxDist) * 1.25 + hash2(x * 3.1, y * 1.7) * 0.5;
        stal.position.y = -BASE_THICKNESS;
        col.add(stal);

        // Top surface
        if (isRamp) {
          const wedge = this.createRampMesh(s, ELEV_STEP, RAMP_DIR[cell.terrain]);
          wedge.position.y = topY;
          col.add(wedge);
        } else {
          let topMat = m.grass[((x + y) % 2) * 2 + (hash2(x * 1.7, y * 2.3) > 0.5 ? 1 : 0)];
          let rimMat = m.rimGrass;
          if (isSand) { topMat = m.sand; rimMat = m.rimSand; }
          else if (cell.terrain === TERRAIN.ICE) { topMat = m.ice; rimMat = m.rimIce; }
          else if (cell.terrain === TERRAIN.MUD) { topMat = m.mud; rimMat = m.rimMud; }
          else if (isWater) { topMat = m.water; rimMat = m.rimWater; }
          else if (isConv) { topMat = m.conveyor; rimMat = m.rimConv; }

          const cap = new THREE.Mesh(this.geo.cap, [rimMat, rimMat, topMat, rimMat, rimMat, rimMat]);
          cap.position.y = topY - CAP_H / 2;
          cap.receiveShadow = true;
          col.add(cap);
          if (cell.terrain === TERRAIN.CUP) this.cupCap = cap;
          if (isConv) {
            // Chevrons point -Z (N) in texture space; spin the tile so they point along the strip.
            const spin = [0, -Math.PI / 2, Math.PI, Math.PI / 2][CONV_DIR[cell.terrain]];
            cap.rotation.y = spin;
            const arrows = new THREE.Mesh(this.geo.overlay, m.chevrons);
            arrows.rotation.y = spin;
            arrows.position.y = topY + 0.004;
            col.add(arrows);
          }
        }

        // Wildflowers and grass tufts on open turf, kept clear of the middle of the tile
        const isOpenTurf = cell.terrain === TERRAIN.GRASS && !(x === level.start.x && y === level.start.y);
        if (isOpenTurf) {
          const nTufts = 3 + Math.floor(hash2(x * 5.3, y * 2.9) * 4);
          for (let i = 0; i < nTufts; i++) {
            const ang = hash2(x * 7 + i, y * 3 + i * 1.7) * Math.PI * 2;
            const rad = 0.3 + hash2(x + i * 2.3, y * 9 + i) * 0.14;
            tufts.push({ x: pos.x + Math.cos(ang) * rad, y: pos.y, z: pos.z + Math.sin(ang) * rad, k: hash2(x * 2 + i, y * 4 + i) });
          }
          if (hash2(x * 1.9, y * 6.7) > 0.28) {
            const ang = hash2(x * 4.1, y * 8.3) * Math.PI * 2;
            const n = 2 + Math.floor(hash2(x * 8.8, y * 1.3) * 5);
            const hue = Math.floor(hash2(x * 3.3, y * 5.5) * 5);
            for (let i = 0; i < n; i++) {
              const a = ang + (i - 2) * 0.36 + (hash2(x * 2 + i, y) - 0.5) * 0.2;
              const rad = 0.31 + hash2(x + i, y + i * 3.1) * 0.14;
              flowers.push({ x: pos.x + Math.cos(a) * rad, y: pos.y, z: pos.z + Math.sin(a) * rad, hue });
            }
          }
        }

        // Props
        if (cell.terrain === TERRAIN.WALL) {
          const hedge = new THREE.Mesh(this.geo.hedge, m.hedge);
          hedge.position.y = pos.y + 0.27;
          hedge.castShadow = true;
          hedge.receiveShadow = true;
          col.add(hedge);
          if (hash2(x * 2.7, y * 4.9) > 0.45) {
            const ball = new THREE.Mesh(this.geo.topiary, m.hedge);
            ball.position.y = pos.y + 0.7;
            ball.castShadow = true;
            col.add(ball);
          }
        }

        if (cell.terrain === TERRAIN.SPRING) {
          const shroom = new THREE.Group();
          shroom.position.y = pos.y;
          const stem = new THREE.Mesh(this.geo.stem, m.shroomStem);
          stem.castShadow = true;
          shroom.add(stem);
          const cap = new THREE.Mesh(this.geo.shroom, m.shroomCap);
          cap.position.y = 0.17;
          cap.castShadow = true;
          shroom.add(cap);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + 0.4;
            const r = i === 0 ? 0 : 0.17;
            const spot = new THREE.Mesh(this.geo.spot, m.shroomSpot);
            spot.position.set(Math.cos(a) * r, 0.17 + Math.sqrt(Math.max(0, 0.09 - r * r)) * 0.72, Math.sin(a) * r);
            shroom.add(spot);
          }
          shroom.userData.phase = x * 1.3 + y * 0.7;
          col.add(shroom);
          this.springRings.push(shroom);
        }

        if (cell.terrain === TERRAIN.PORTAL_A || cell.terrain === TERRAIN.PORTAL_B) {
          const isA = cell.terrain === TERRAIN.PORTAL_A;
          const pm = isA ? m.portalA : m.portalB;
          const ring = new THREE.Mesh(this.geo.stoneRing, m.stone);
          ring.position.y = pos.y + 0.04;
          ring.castShadow = true;
          col.add(ring);

          const base = new THREE.Mesh(this.geo.portalDisc, pm.base);
          base.position.y = pos.y + 0.012;
          col.add(base);
          const disc = new THREE.Mesh(this.geo.portalDisc, pm.disc);
          disc.position.y = pos.y + 0.02;
          disc.userData.spin = isA ? 1 : -1;
          col.add(disc);
          this.portalDiscs.push(disc);

          const beam = new THREE.Mesh(this.geo.beam, isA ? m.beamA : m.beamB);
          beam.scale.set(1.2, 0.9, 1.2);
          beam.position.y = pos.y + 0.04;
          beam.userData.phase = isA ? 0 : 2;
          beam.layers.set(LAYER_FX);
          col.add(beam);
          this.beams.push(beam);
        }

        if (cell.terrain === TERRAIN.CUP) {
          // The pin is a real object set into the painting: a sunk cup liner, a fibreglass stick, a cloth flag.
          const pin = new THREE.Group();
          const wall = new THREE.Mesh(this.geo.cupWall, m.cupWall);
          // the liner sits inside the turf cap, which the pieces pass hides for this one tile
          wall.position.y = pos.y - 0.05;
          pin.add(wall);
          const floor = new THREE.Mesh(this.geo.cupFloor, m.cupFloor);
          floor.position.y = pos.y - 0.096;
          pin.add(floor);
          // without the composer there is no depth trick to see into the cup: fall back to a dark disc
          this.cupDisc = new THREE.Mesh(this.geo.cupFloor, m.cupFloor);
          this.cupDisc.position.y = pos.y + 0.006;
          pin.add(this.cupDisc);
          const lip = new THREE.Mesh(this.geo.cupLip, m.cupLip);
          lip.position.y = pos.y + 0.008;
          pin.add(lip);

          const pole = new THREE.Mesh(this.geo.pole, m.pole);
          pole.position.y = pos.y + 0.62;
          pin.add(pole);
          const finial = new THREE.Mesh(this.geo.finial, m.metal);
          finial.position.y = pos.y + 1.34;
          pin.add(finial);

          // cloth: its own geometry, because the vertices are waved every frame
          const flagGeo = this.track(this.geo.flag.clone());
          flagGeo.userData.rest = flagGeo.attributes.position.array.slice();
          this.flagCloth = new THREE.Mesh(flagGeo, m.flag);
          this.flagCloth.position.set(0.014, pos.y + 1.1, 0);
          pin.add(this.flagCloth);
          col.add(onLayer(pin, LAYER_PIECES));

          // A soft shaft of sunlight so the pin is easy to find on a small screen
          const beam = new THREE.Mesh(this.geo.beam, m.beamCup);
          beam.scale.set(1.5, 2.0, 1.5);
          beam.position.y = pos.y + 0.03;
          beam.userData.phase = 1;
          beam.layers.set(LAYER_FX);
          col.add(beam);
          this.beams.push(beam);
        }
      }
    }

    // Flora is instanced; it blooms once the course has finished building.
    if (tufts.length > 0) {
      const mesh = this.track(new THREE.InstancedMesh(this.geo.tuft, m.tuft, tufts.length));
      const t = THEMES[this.themeName];
      const cA = new THREE.Color(t.turfDark);
      const cB = new THREE.Color(t.ramp);
      const c = new THREE.Color();
      tufts.forEach((f, i) => {
        dummy.position.set(f.x, f.y, f.z);
        dummy.rotation.set((f.k - 0.5) * 0.5, f.k * 6, (f.k - 0.5) * 0.4);
        dummy.scale.set(0.9 + f.k * 0.6, 0.9 + f.k * 1.1, 0.9 + f.k * 0.6);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, c.copy(cA).lerp(cB, f.k));
      });
      mesh.castShadow = true;
      this.boardGroup.add(mesh);
      this.flora.push(mesh);
    }
    if (flowers.length > 0) {
      const mesh = this.track(new THREE.InstancedMesh(this.geo.flower, m.flower, flowers.length));
      const palette = [0xffffff, 0xffe37a, 0xffa6c9, 0xcdb0ff, 0xf2553a].map((h) => new THREE.Color(h));
      dummy.rotation.set(0, 0, 0);
      flowers.forEach((f, i) => {
        dummy.position.set(f.x, f.y + 0.035, f.z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, palette[f.hue]);
      });
      this.boardGroup.add(mesh);
      this.flora.push(mesh);
    }

    this.maxElev = maxElev;
    this.cloudBase = Math.max(level.width, level.height) / 2;
    this.introT = intro && !this.reducedMotion ? 0 : Infinity;
    this.floraT = 1;
    if (this.introT === 0) {
      for (const col of this.columns) col.visible = false;
      this.floraT = 0;
    }
    for (const f of this.flora) {
      f.visible = this.floraT === 1;
      f.scale.set(1, 1, 1);
    }
    this.placeBallImmediate(ballPos.x, ballPos.y, this.ballElev);
    if (this.introT === 0) this.ballPop = -0.45;
    this.fitCamera();
  }

  createRampMesh(s, h, dirId) {
    // Wedge climbing toward +X, then rotated to dirId.
    const shape = new THREE.Shape();
    shape.moveTo(-s / 2, 0);
    shape.lineTo(s / 2, 0);
    shape.lineTo(s / 2, h);
    shape.closePath();

    const geo = this.track(new THREE.ExtrudeGeometry(shape, { depth: s, bevelEnabled: false }));
    geo.translate(0, 0, -s / 2);

    // Paint the sloped face with the ramp texture: re-map UVs for faces whose normal points up.
    const posAttr = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    geo.clearGroups();
    const slope = [];
    const rest = [];
    for (let i = 0; i < posAttr.count; i += 3) {
      const up = nrm.getY(i) > 0.5;
      (up ? slope : rest).push(i);
      if (up) {
        for (let k = i; k < i + 3; k++) {
          // U across the ramp, V rising toward the high edge so chevrons point uphill.
          uv.setXY(k, posAttr.getZ(k) / s + 0.5, posAttr.getX(k) / s + 0.5);
        }
      }
    }
    // Regroup triangles: non-indexed geometry, so reorder into two contiguous runs.
    const order = [...slope, ...rest];
    const reorder = (attr) => {
      const src = attr.array.slice();
      const n = attr.itemSize;
      order.forEach((from, idx) => {
        for (let k = 0; k < 3 * n; k++) attr.array[idx * 3 * n + k] = src[from * n + k];
      });
      attr.needsUpdate = true;
    };
    reorder(posAttr);
    reorder(nrm);
    reorder(uv);
    geo.addGroup(0, slope.length * 3, 0);
    geo.addGroup(slope.length * 3, rest.length * 3, 1);

    // E=(+X): rotY 0; N=(-Z): +PI/2; S=(+Z): -PI/2; W=(-X): PI
    geo.rotateY([Math.PI / 2, 0, -Math.PI / 2, Math.PI][dirId]);

    const mesh = new THREE.Mesh(geo, [this.mats.ramp, this.mats.rampSide]);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  placeBallImmediate(gx, gy, elev) {
    this.ballPos = { x: gx, y: gy };
    this.ballElev = elev;
    const p = this.gridToWorld(gx, gy, elev);
    this.ballGroup.position.set(p.x, p.y + BALL_R, p.z);
    this.ballGroup.scale.set(1, 1, 1);
    this.ballShadow.position.set(p.x, p.y + 0.015, p.z);
    this.ballShadow.scale.set(1, 1, 1);
    this.ballShadow.visible = true;
    this.ballPop = 1;
    this.trailHistory.length = 0;
  }

  clearArrows() {
    for (const child of this.arrowGroup.children) {
      child.traverse((o) => {
        if (o.material && o.userData.ownMaterial) o.material.dispose();
      });
    }
    for (const child of this.previewGroup.children) {
      if (child.material) child.material.dispose();
      if (child.isInstancedMesh) child.dispose();
    }
    this.arrowGroup.clear();
    this.previewGroup.clear();
    this.arrowHitMeshes = [];
    this.tileHitMeshes = [];
    this.previewRings = [];
  }

  /** World-space sample points along a simulated shot, for the dotted preview. */
  samplePath(sim) {
    const pts = [];
    for (const seg of sim.path) {
      if (seg.type === 'teleport' || seg.type === 'bump' || seg.type === 'bounce') continue;
      const p0 = this.gridToWorld(seg.from.x, seg.from.y, seg.fromElev);
      const p1 = this.gridToWorld(seg.to.x, seg.to.y, seg.toElev);
      const arc = seg.type === 'arc' || seg.type === 'spring' || seg.type === 'bounce_arc';
      const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const steps = Math.max(2, Math.round(dist * (arc ? 4 : 3)));
      const peak = seg.type === 'bounce_arc' ? 0.55 : seg.high ? 1.55 : seg.type === 'spring' ? 1.35 : 0.95;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        if (seg.type === 'fall' && u > 0.6) break;
        const lift = arc ? Math.sin(u * Math.PI) * peak : 0;
        pts.push(new THREE.Vector3(
          THREE.MathUtils.lerp(p0.x, p1.x, u),
          THREE.MathUtils.lerp(p0.y, p1.y, u) + 0.1 + lift,
          THREE.MathUtils.lerp(p0.z, p1.z, u)
        ));
      }
    }
    return pts;
  }

  /**
   * Show 4 neon direction chevrons around the ball, a dotted flight path for each
   * and a pulsing landing ring. Chevrons and landing tiles are both tappable.
   */
  showDirections(card, recommendedDir = null) {
    this.clearArrows();
    if (!this.level || !card) return;

    const base = this.gridToWorld(this.ballPos.x, this.ballPos.y, this.ballElev);
    const dummy = new THREE.Object3D();

    for (const d of DIRS) {
      const sim = simulateShot(this.level, this.ballPos, card, d.id);
      const isRec = recommendedDir === d.id;
      const isBad = Boolean(sim.hazard || sim.stuckInSand);
      const moved = sim.endPos.x !== this.ballPos.x || sim.endPos.y !== this.ballPos.y;
      const isIdle = !moved && !sim.hazard && !sim.won;

      const color = isRec || sim.won ? PAINT.gold : isBad ? PAINT.bad : isIdle ? PAINT.idle : PAINT.good;

      const arrow = new THREE.Group();
      // Painted chevron with a dark keyline so it reads on turf, sand and ice alike
      const outline = new THREE.Mesh(
        this.geo.chevron,
        new THREE.MeshBasicMaterial({ color: PAINT.outline, transparent: isIdle, opacity: isIdle ? 0.3 : 1 })
      );
      outline.userData.ownMaterial = true;
      outline.scale.set(1.2, 0.5, 1.2);
      outline.position.set(0, -0.035, 0.6);
      arrow.add(outline);
      const chev = new THREE.Mesh(
        this.geo.chevron,
        new THREE.MeshBasicMaterial({ color, transparent: isIdle, opacity: isIdle ? 0.6 : 1 })
      );
      chev.userData.ownMaterial = true;
      chev.position.z = 0.6;
      if (isRec) {
        chev.scale.setScalar(1.25);
        outline.scale.set(1.45, 0.5, 1.45);
      }
      arrow.add(chev);
      arrow.userData.chev = chev;
      arrow.userData.outline = outline;
      chev.layers.set(LAYER_PIECES);
      outline.layers.set(LAYER_PIECES);

      // Generous invisible touch target
      const hit = new THREE.Mesh(this.geo.hitArrow, new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.ownMaterial = true;
      hit.position.z = 0.66;
      hit.userData.dirId = d.id;
      arrow.add(hit);
      this.arrowHitMeshes.push(hit);

      // Face direction d (N=-Z, E=+X, S=+Z, W=-X)
      arrow.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][d.id];
      arrow.position.set(base.x, base.y + 0.16, base.z);
      arrow.userData.dirId = d.id;
      this.arrowGroup.add(arrow);

      if (isIdle) continue;

      // Dotted flight path
      const pts = this.samplePath(sim);
      if (pts.length > 0) {
        const dots = new THREE.InstancedMesh(
          this.geo.dot,
          new THREE.MeshBasicMaterial({ color }),
          pts.length
        );
        pts.forEach((p, i) => {
          dummy.position.copy(p);
          dummy.updateMatrix();
          dots.setMatrixAt(i, dummy.matrix);
        });
        dots.instanceMatrix.needsUpdate = true;
        dots.layers.set(LAYER_PIECES);
        this.previewGroup.add(dots);
      }

      // Landing ring (also a tap target)
      if (!sim.hazard && moved) {
        const endElev = this.level.grid[sim.endPos.y][sim.endPos.x].elev;
        const ep = this.gridToWorld(sim.endPos.x, sim.endPos.y, endElev);
        const halo = new THREE.Mesh(
          this.geo.ring,
          new THREE.MeshBasicMaterial({ color: PAINT.outline, side: THREE.DoubleSide })
        );
        halo.position.set(ep.x, ep.y + 0.034, ep.z);
        halo.scale.setScalar(1.14);
        halo.userData.phase = d.id * 0.9;
        halo.userData.base = 1.14;
        halo.layers.set(LAYER_PIECES);
        this.previewGroup.add(halo);
        this.previewRings.push(halo);

        const ring = new THREE.Mesh(
          this.geo.ring,
          new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
        );
        ring.position.set(ep.x, ep.y + 0.04, ep.z);
        ring.userData.phase = d.id * 0.9;
        ring.userData.base = 1;
        ring.layers.set(LAYER_PIECES);
        this.previewGroup.add(ring);
        this.previewRings.push(ring);

        const tileHit = new THREE.Mesh(this.geo.hitTile, new THREE.MeshBasicMaterial({ visible: false }));
        tileHit.position.set(ep.x, ep.y + 0.1, ep.z);
        tileHit.userData.dirId = d.id;
        this.previewGroup.add(tileHit);
        this.tileHitMeshes.push(tileHit);
      }
    }
  }

  /**
   * Play full multi-segment shot animation and resolve when done.
   */
  animateShot(simResult, onEvent) {
    this.clearArrows();
    return new Promise((resolve) => {
      if (!simResult.path || simResult.path.length === 0) {
        resolve();
        return;
      }
      const segments = simResult.path.slice();
      if (simResult.won) {
        const end = simResult.endPos;
        const elev = this.level.grid[end.y][end.x].elev;
        segments.push({ type: 'sink', from: end, to: end, fromElev: elev, toElev: elev });
      }
      this.animQueue = {
        segments,
        index: 0,
        t: 0,
        simResult,
        onEvent,
        firedEvents: new Set(),
      };
      this.animResolve = resolve;
    });
  }

  sparkMaterial(colorHex) {
    let mat = this.sparkMats.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: colorHex });
      this.sparkMats.set(colorHex, mat);
    }
    return mat;
  }

  spawnParticles(worldPos, colorHex, count = 12, speed = 2.2) {
    const mat = this.sparkMaterial(colorHex);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo.spark, mat);
      m.position.copy(worldPos);
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      m.userData = {
        vx: Math.cos(ang) * spd,
        vy: 1.4 + Math.random() * 2.2,
        vz: Math.sin(ang) * spd,
        life: 0.55 + Math.random() * 0.4,
        age: 0,
      };
      m.layers.set(LAYER_PIECES);
      this.fxGroup.add(m);
      this.particles.push(m);
    }
  }

  spawnVictoryConfetti(gx, gy, elev) {
    const p = this.gridToWorld(gx, gy, elev);
    p.y += 0.3;
    const colors = [0xf5c542, 0xfffaf0, 0xffa6c9, 0x9fe27a, 0x9fd2f5, 0xd9372c];
    for (const c of colors) {
      this.spawnParticles(p, c, 9, 3.2);
    }
  }

  fitCamera() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const ins = this.insets;
    const freeW = Math.max(120, w - ins.left - ins.right);
    const freeH = Math.max(120, h - ins.top - ins.bottom);

    // Extents of the island as seen by the isometric camera, in world units on the view plane.
    const span = this.level ? Math.max(this.level.width, this.level.height) : 6;
    const maxElev = this.maxElev || 0;
    const half = (span * Math.SQRT2) / 2;
    const halfW = half + 0.12;
    const up = half * CAM_ELEV_SIN + (maxElev * ELEV_STEP + 1.5) * CAM_ELEV_COS;
    const down = half * CAM_ELEV_SIN + (BASE_THICKNESS + 0.7) * CAM_ELEV_COS;

    const worldPerPx = Math.max((2 * halfW) / freeW, (up + down) / freeH) * 1.03;
    this.frustumSize = worldPerPx * h;
    const viewW = worldPerPx * w;

    // Centre the island in the free region rather than the whole canvas.
    const cx = -((ins.left - ins.right) / 2) * worldPerPx;
    const cy = (up - down) / 2 - ((ins.bottom - ins.top) / 2) * worldPerPx;

    this.camera.left = cx - viewW / 2;
    this.camera.right = cx + viewW / 2;
    this.camera.top = cy + this.frustumSize / 2;
    this.camera.bottom = cy - this.frustumSize / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.paintPass) {
      const pu = this.paintPass.uniforms;
      pu.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      // Brush size follows the screen, so phones and desktops get the same touch.
      pu.uSpread.value = Math.max(0.6, (Math.min(w, h) / 520) * pr * 0.46);
      pu.uAspect.value = w / h;
    }

    // Backdrop: horizon through the middle of the free region, sun rising behind the peak.
    const u = this.backdropUniforms;
    u.uRes.value.set(w * pr, h * pr);
    const freeCy = ins.bottom + freeH / 2; // CSS px from the bottom
    u.uHorizon.value = (freeCy - freeH * 0.02) / h;
    // Sun high over the far shoulder of the course
    u.uSun.value.set((ins.left + freeW * 0.8) * pr, (ins.bottom + freeH * 0.84) * pr);
    this.moteMat.size = 4.5 * pr;
  }

  resize() {
    this.fitCamera();
  }

  bindInput() {
    const getNDC = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragStart = { x: e.clientX, y: e.clientY, time: performance.now() };
    });

    this.canvas.addEventListener('pointercancel', () => {
      this.dragStart = null;
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.dragStart) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const dist = Math.hypot(dx, dy);
      this.dragStart = null;

      // Tap on a chevron, or on the tile a shot lands on
      if (dist < 18) {
        if (this.arrowHitMeshes.length > 0 && this.onDirectionPick) {
          getNDC(e.clientX, e.clientY);
          this.raycaster.setFromCamera(this.pointer, this.camera);
          let hits = this.raycaster.intersectObjects(this.arrowHitMeshes, false);
          if (hits.length === 0) hits = this.raycaster.intersectObjects(this.tileHitMeshes, false);
          if (hits.length > 0) {
            this.onDirectionPick(hits[0].object.userData.dirId);
          }
        }
        return;
      }

      // Swipe -> nearest isometric world direction
      if (dist >= 28 && this.onSwipeDirection) {
        const dirId = this.screenVectorToDir(dx, dy);
        if (dirId !== null) this.onSwipeDirection(dirId);
      }
    });
  }

  /**
   * Project a screen-space vector (dx, dy) against the 4 world cardinal directions
   * as seen by the current isometric camera.
   */
  screenVectorToDir(dx, dy) {
    const swipe = new THREE.Vector2(dx, -dy).normalize();
    const origin = new THREE.Vector3(0, 0, 0).project(this.camera);
    let bestDir = 0;
    let bestDot = -Infinity;

    for (const d of DIRS) {
      const tip = new THREE.Vector3(d.dx, 0, d.dy).project(this.camera);
      const screenDir = new THREE.Vector2(tip.x - origin.x, tip.y - origin.y).normalize();
      const dot = swipe.dot(screenDir);
      if (dot > bestDot) {
        bestDot = dot;
        bestDir = d.id;
      }
    }
    return bestDir;
  }

  tick() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    const elapsed = this.clock.getElapsedTime();

    // Adaptive quality: if frames stay slow with bloom on, fall back to the direct path.
    if (this.qualityMode === 'auto' && this.quality === 'high' && !document.hidden) {
      this.frameCount++;
      if (this.frameCount > 45) {
        this.frameAvg += (rawDt * 1000 - this.frameAvg) * 0.05;
        if (this.frameCount > 150 && this.frameAvg > 30) this.setQuality('low');
      }
    }

    // Smooth camera orbit
    this.orbitAngle = THREE.MathUtils.damp(this.orbitAngle, this.targetOrbitAngle, 8, dt);
    const shakeAmt = this.reducedMotion ? 0 : this.shake;
    const shakeX = shakeAmt > 0 ? (Math.random() - 0.5) * shakeAmt * 0.25 : 0;
    const shakeY = shakeAmt > 0 ? (Math.random() - 0.5) * shakeAmt * 0.25 : 0;
    this.shake = Math.max(0, this.shake - dt * 3.5);

    this.camera.position.set(
      Math.cos(this.orbitAngle) * CAM_RADIUS + shakeX,
      CAM_Y + shakeY,
      Math.sin(this.orbitAngle) * CAM_RADIUS
    );
    this.camera.lookAt(0, 0, 0);

    this.backdropUniforms.uTime.value = this.reducedMotion ? 0 : elapsed;

    // Floating island breath
    this.islandGroup.position.y = this.reducedMotion ? 0 : Math.sin(elapsed * 1.15) * 0.05;

    // Course build-in: columns rise from below, rippling out from the tee.
    if (this.introT !== Infinity) {
      this.introT += dt;
      let done = true;
      for (const col of this.columns) {
        const u = THREE.MathUtils.clamp((this.introT - col.userData.delay) / 0.5, 0, 1);
        if (u < 1) done = false;
        col.visible = u > 0;
        const c = 1.70158;
        const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); // easeOutBack
        col.position.y = -2.4 * (1 - e);
      }
      if (done) this.introT = Infinity;
    }

    // Ball pop-in (new hole, hazard respawn)
    if (this.ballPop < 1 && !this.animQueue) {
      this.ballPop = Math.min(1, this.ballPop + dt * 3.6);
      const u = Math.max(0, this.ballPop);
      const sc = u < 1 ? 1 + 0.35 * Math.sin(u * Math.PI) - (1 - u) : 1;
      this.ballGroup.scale.setScalar(Math.max(0.001, sc));
      this.ballShadow.scale.setScalar(Math.max(0.001, u));
    }

    // Flora blooms after the course has built
    if (this.floraT < 1 && this.introT === Infinity) {
      this.floraT = Math.min(1, this.floraT + dt * 2.6);
      const u = this.floraT;
      const e = 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2);
      for (const f of this.flora) {
        f.visible = true;
        f.scale.y = Math.max(0.001, e);
      }
    }

    // Drifting water, boost chevrons, portal swirls, mushrooms, flag, light shafts
    if (this.mats && !this.reducedMotion) {
      this.mats.water.map.offset.set(Math.sin(elapsed * 0.7) * 0.025, Math.cos(elapsed * 0.5) * 0.015);
      this.mats.chevrons.map.offset.y = -((elapsed * 0.8) % 1);
    }
    for (const pd of this.portalDiscs) {
      pd.rotation.y = elapsed * 1.6 * pd.userData.spin;
    }
    for (const sr of this.springRings) {
      const k = Math.sin(elapsed * 2.4 + sr.userData.phase);
      sr.scale.set(1 - k * 0.035, 1 + k * 0.06, 1 - k * 0.035);
    }
    for (const b of this.beams) {
      b.material.opacity = b.material.userData.baseOpacity * (0.8 + 0.2 * Math.sin(elapsed * 1.6 + b.userData.phase));
    }
    if (this.flagCloth) {
      // Cloth in a light breeze: travelling waves that grow away from the stick, lit by recomputed normals.
      const geo = this.flagCloth.geometry;
      const rest = geo.userData.rest;
      const posAttr = geo.attributes.position;
      const tt = this.reducedMotion ? 0 : elapsed;
      for (let i = 0; i < posAttr.count; i++) {
        const x = rest[i * 3];
        const y = rest[i * 3 + 1];
        const k = x / 0.66;
        const wave = Math.sin(x * 15 - tt * 5.2 + y * 3) * 0.035 + Math.sin(x * 27 - tt * 8.1) * 0.012;
        posAttr.setXYZ(i, x - k * k * 0.02, y - k * k * 0.035 + Math.sin(x * 11 - tt * 4) * 0.008 * k, wave * k);
      }
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
      // stream the flag downwind, side-on enough to the camera to read
      this.flagCloth.rotation.y = Math.PI * 0.62 - this.orbitAngle + Math.sin(tt * 0.9) * 0.12;
    }

    // Clouds circle slowly below the course
    const base = this.cloudBase || 3;
    this.clouds.children.forEach((cloud, i) => {
      const sd = this.cloudSeeds[i];
      const a = sd.ang + (this.reducedMotion ? 0 : elapsed * sd.speed);
      cloud.position.set(Math.cos(a) * (base + sd.rad), sd.y, Math.sin(a) * (base + sd.rad));
      cloud.rotation.y = -a;
    });

    // Motes drift upward and wrap
    const mp = this.motes.geometry.attributes.position;
    for (let i = 0; i < this.moteSeeds.length; i++) {
      const sd = this.moteSeeds[i];
      const yy = ((sd.y + elapsed * sd.speed + 3) % 9) - 3;
      const a = sd.ang + elapsed * 0.05;
      mp.setXYZ(i, Math.cos(a) * sd.rad, yy, Math.sin(a) * sd.rad);
    }
    mp.needsUpdate = true;

    // Pulse chevrons and landing rings
    for (const child of this.arrowGroup.children) {
      const chev = child.userData.chev;
      if (chev) {
        chev.position.z = 0.6 + (Math.sin(elapsed * 5.2 + child.userData.dirId) * 0.5 + 0.5) * 0.09;
        child.userData.outline.position.z = chev.position.z;
      }
    }
    for (const ring of this.previewRings) {
      ring.scale.setScalar(ring.userData.base * (1 + (Math.sin(elapsed * 4.2 + ring.userData.phase) * 0.5 + 0.5) * 0.2));
    }

    // Shot animation
    if (this.animQueue) {
      this.stepAnimation(dt);
    }

    // The ball turns as it travels, so the dimples catch the light
    if (this.animQueue) {
      this.ballMesh.rotation.x += dt * 9;
      this.ballMesh.rotation.z += dt * 4;
    }

    // Comet trail
    if (this.animQueue) {
      this.trailHistory.unshift(this.ballGroup.position.clone());
      if (this.trailHistory.length > 26) this.trailHistory.length = 26;
    } else if (this.trailHistory.length > 0) {
      this.trailHistory.length = Math.max(0, this.trailHistory.length - 2);
    }
    for (let i = 0; i < this.trail.length; i++) {
      const hIdx = (i + 1) * 2;
      const m = this.trail[i];
      if (hIdx < this.trailHistory.length) {
        m.visible = true;
        m.position.copy(this.trailHistory[hIdx]);
        m.scale.setScalar(1 - (i + 1) / (this.trail.length + 1));
      } else {
        m.visible = false;
      }
    }

    // Sparks
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.userData.age += dt;
      if (p.userData.age >= p.userData.life) {
        this.fxGroup.remove(p);
        this.particles.splice(i, 1);
        continue;
      }
      p.userData.vy -= 7.5 * dt;
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      const sc = 1 - p.userData.age / p.userData.life;
      p.scale.setScalar(Math.max(0.01, sc));
    }

    if (this.cupDisc) this.cupDisc.visible = !this.composer;
    if (this.composer) {
      // painted image first (land + soft effects); PiecesPass adds the sharp layer
      this.camera.layers.set(LAYER_WORLD);
      this.camera.layers.enable(LAYER_FX);
      this.composer.render(dt);
    } else {
      this.camera.layers.enableAll();
      this.renderer.render(this.scene, this.camera);
    }
  }

  stepAnimation(dt) {
    const q = this.animQueue;
    const seg = q.segments[q.index];
    const durMap = {
      roll: 0.19,
      slide: 0.12,
      climb: 0.22,
      drop: 0.2,
      arc: 0.44,
      spring: 0.44,
      bounce: 0.16,
      bump: 0.18,
      bounce_arc: 0.36,
      teleport: 0.26,
      fall: 0.35,
      sink: 0.24,
    };
    const dur = durMap[seg.type] || 0.2;
    q.t += dt / dur;

    const p0 = this.gridToWorld(seg.from.x, seg.from.y, seg.fromElev);
    const p1 = this.gridToWorld(seg.to.x, seg.to.y, seg.toElev);
    const u = Math.min(1, q.t);

    if (seg.type === 'arc' || seg.type === 'spring') {
      const peak = seg.high ? 1.55 : seg.type === 'spring' ? 1.35 : 0.95;
      const x = THREE.MathUtils.lerp(p0.x, p1.x, u);
      const z = THREE.MathUtils.lerp(p0.z, p1.z, u);
      const baseY = THREE.MathUtils.lerp(p0.y, p1.y, u);
      const arcY = Math.sin(u * Math.PI) * peak;
      this.ballGroup.position.set(x, baseY + BALL_R + arcY, z);
      this.ballShadow.position.set(x, baseY + 0.015, z);
      const shScale = Math.max(0.35, 1 - arcY * 0.4);
      this.ballShadow.scale.setScalar(shScale);
    } else if (seg.type === 'bounce' || seg.type === 'bump' || seg.type === 'bounce_arc') {
      const tri = u < 0.5 ? u * 2 : (1 - u) * 2;
      const x = THREE.MathUtils.lerp(p0.x, p1.x, tri);
      const z = THREE.MathUtils.lerp(p0.z, p1.z, tri);
      const arcY = seg.type === 'bounce_arc' ? Math.sin(u * Math.PI) * 0.55 : 0;
      this.ballGroup.position.set(x, p0.y + BALL_R + arcY, z);
      this.ballShadow.position.set(x, p0.y + 0.015, z);
      if (u >= 0.5 && !q.firedEvents.has(`b-${q.index}`)) {
        q.firedEvents.add(`b-${q.index}`);
        this.shake = 0.35;
        this.spawnParticles(this.ballGroup.position, 0xffffff, 6, 1.4);
        if (q.onEvent) q.onEvent('bounce');
      }
    } else if (seg.type === 'teleport') {
      const half = u < 0.5;
      const scale = half ? 1 - u * 2 : (u - 0.5) * 2;
      const pos = half ? p0 : p1;
      this.ballGroup.position.set(pos.x, pos.y + BALL_R, pos.z);
      this.ballGroup.scale.setScalar(Math.max(0.05, scale));
      this.ballShadow.position.set(pos.x, pos.y + 0.015, pos.z);
      if (!half && !q.firedEvents.has(`tp-${q.index}`)) {
        q.firedEvents.add(`tp-${q.index}`);
        this.trailHistory.length = 0;
        this.spawnParticles(p0, 0xcffff6, 10, 2.0);
        this.spawnParticles(p1, 0xfff0d0, 12, 2.2);
        if (q.onEvent) q.onEvent('portal');
      }
    } else if (seg.type === 'sink') {
      // Drop into the cup
      const e = u * u;
      this.ballGroup.position.set(p1.x, p1.y + BALL_R - e * 0.3, p1.z);
      this.ballGroup.scale.setScalar(1 - e * 0.3);
      this.ballShadow.visible = false;
    } else {
      const x = THREE.MathUtils.lerp(p0.x, p1.x, u);
      const z = THREE.MathUtils.lerp(p0.z, p1.z, u);
      const y = THREE.MathUtils.lerp(p0.y, p1.y, u);
      this.ballGroup.position.set(x, y + BALL_R, z);
      this.ballShadow.position.set(x, y + 0.015, z);
      this.ballShadow.scale.setScalar(1);
      if (seg.type === 'fall') this.ballGroup.scale.setScalar(Math.max(0.05, 1 - u * 0.9));
    }

    if (q.t >= 1) {
      q.index++;
      q.t = 0;

      // Per-segment arrival feedback
      if (seg.type === 'spring') {
        this.spawnParticles(p0, 0xfffaf0, 8, 1.8);
        if (q.onEvent) q.onEvent('spring');
      }
      if (seg.type === 'slide' && !q.firedEvents.has('ice')) {
        q.firedEvents.add('ice');
        if (q.onEvent) q.onEvent('ice');
      }

      if (q.index >= q.segments.length) {
        const res = q.simResult;
        const endTile = this.level.grid[res.endPos.y][res.endPos.x];
        const done = this.animResolve;
        this.animQueue = null;
        this.animResolve = null;

        if (res.hazard === 'water' || res.hazard === 'void') {
          this.shake = 0.5;
          this.spawnParticles(this.ballGroup.position, res.hazard === 'water' ? 0xd8f3ff : 0xffffff, 18, 2.6);
          if (q.onEvent) q.onEvent('water');
          this.placeBallImmediate(res.endPos.x, res.endPos.y, endTile.elev);
          this.ballPop = 0; // respawn pop
        } else if (res.won) {
          this.shake = 0.3;
          this.spawnVictoryConfetti(res.endPos.x, res.endPos.y, endTile.elev);
          if (q.onEvent) q.onEvent('sink');
          // Leave the ball resting in the cup.
          this.ballPos = { ...res.endPos };
          this.ballElev = endTile.elev;
        } else {
          if (res.events.includes('sand_stop') || res.stuckInSand) {
            this.spawnParticles(this.ballGroup.position, 0xf5e4ae, 12, 1.8);
            if (q.onEvent) q.onEvent('sand');
          }
          this.placeBallImmediate(res.endPos.x, res.endPos.y, endTile.elev);
        }
        if (done) done();
      }
    }
  }
}
