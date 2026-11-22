// Life of Golf — Three.js isometric renderer.
// A quiet, softly lit diorama: flat confident colour, real shadows, one calm backdrop.
// The ball, cup, pin and flag are physically shaded so they read as real objects on the model.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
const CAM_RADIUS = 16;
const CAM_Y = 12.2;
const CAM_ELEV_SIN = CAM_Y / Math.hypot(CAM_RADIUS, CAM_Y);
const CAM_ELEV_COS = CAM_RADIUS / Math.hypot(CAM_RADIUS, CAM_Y);

// Aim guides: white for a clean shot, gold for the cup or a hint, coral for trouble.
const GUIDE = {
  good: 0xffffff,
  gold: 0xe9b949,
  bad: 0xe2553f,
  idle: 0x9aa79e,
  key: 0x14301f,
};

const THEMES = {
  // "Ivory": the model in soft daylight on warm paper.
  light: {
    skyTop: '#dfe8e4',
    skyMid: '#efeadc',
    horizon: '#f8f1df',
    floor: '#e6dfcd',
    hillFar: '#d6ddd0',
    hillNear: '#c6d2c2',
    sunGlow: '#fff4d6',
    glow: 0.34,
    groundShade: 0.17,
    hemiSky: 0xfdf8ee,
    hemiGround: 0xb9c2c8,
    hemiInt: 1.25,
    sunColor: 0xfff2dc,
    sunInt: 2.6,
    fillColor: 0xdfe8ff,
    fillInt: 0.45,
    turfA: '#6dbb62',
    turfB: '#62b058',
    turfEdge: '#4f9a4b',
    ramp: '#7cc86e',
    soil: '#cfae88',
    soilDark: '#ad8a66',
    rock: 0x9c8a78,
    hedge: 0x2f6f48,
    sand: '#f1e2bd',
    sandLine: '#dcc797',
    water: '#83c9df',
    waterDeep: '#5fb0cf',
    ice: '#e7f4f8',
    iceEdge: '#c2e0ea',
    mud: '#8d6d50',
    mudDark: '#74573e',
    plank: '#b98f61',
    plankDark: '#9a7449',
  },
  // "Evergreen": the same model under a warm lamp in a dark green room.
  dark: {
    skyTop: '#081b14',
    skyMid: '#0f2a20',
    horizon: '#133026',
    floor: '#0a1f17',
    hillFar: '#112b22',
    hillNear: '#0f271e',
    sunGlow: '#5c8f72',
    glow: 0.2,
    groundShade: 0.38,
    hemiSky: 0xf3ead6,
    hemiGround: 0x41564c,
    hemiInt: 1.05,
    sunColor: 0xffe9c4,
    sunInt: 2.7,
    fillColor: 0xbfe0d0,
    fillInt: 0.4,
    turfA: '#69b860',
    turfB: '#5eac56',
    turfEdge: '#4a9548',
    ramp: '#78c46b',
    soil: '#c9a680',
    soilDark: '#a5825f',
    rock: 0x8e7d6c,
    hedge: 0x2b6843,
    sand: '#efdfb8',
    sandLine: '#d8c290',
    water: '#7cc4dc',
    waterDeep: '#58a9c9',
    ice: '#e3f1f6',
    iceEdge: '#bcdbe6',
    mud: '#886849',
    mudDark: '#6f533a',
    plank: '#b48a5c',
    plankDark: '#946f45',
  },
};

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function makeCanvasTex(size, drawFn, { repeat = false, height = size } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  const ctx = c.getContext('2d');
  drawFn(ctx, size, height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 8;
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

const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// Backdrop: a smooth gradient, one soft glow, two faint ridgelines and the island's shadow on the ground.
const BACKDROP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uRes;
  uniform float uHorizon;
  uniform vec2 uSun;
  uniform vec3 uShadow; // x, y (px) and radius (px)
  uniform float uShade;
  uniform float uGlow;
  uniform vec3 cTop;
  uniform vec3 cMid;
  uniform vec3 cHorizon;
  uniform vec3 cFloor;
  uniform vec3 cHillFar;
  uniform vec3 cHillNear;
  uniform vec3 cSun;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(vec2(i, 1.0)), hash(vec2(i + 1.0, 1.0)), f);
  }
  float ridge(float x, float seed) {
    return noise(x + seed) * 0.7 + noise(x * 2.1 + seed * 1.7) * 0.3;
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    float xa = (vUv.x - 0.5) * aspect;
    float yy = vUv.y - uHorizon;
    float px = 1.5 / uRes.y;

    float t = clamp(yy / max(0.001, 1.0 - uHorizon), 0.0, 1.0);
    vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.5, t));
    col = mix(col, cTop, smoothstep(0.4, 1.0, t));

    // one soft glow where the light comes from
    vec2 sv = (vUv - uSun / uRes) * vec2(aspect, 1.0);
    col += cSun * exp(-length(sv) * 3.4) * uGlow;

    // two faint ridgelines resting on the horizon
    float h1 = 0.03 + 0.07 * ridge(xa * 0.8, 3.0);
    col = mix(col, cHillFar, smoothstep(px, -px, yy - h1));
    float h2 = 0.004 + 0.045 * ridge(xa * 1.4, 11.0);
    col = mix(col, cHillNear, smoothstep(px, -px, yy - h2));

    // the ground plane falls away toward the viewer
    float f = clamp(-yy / max(0.001, uHorizon), 0.0, 1.0);
    vec3 ground = mix(cHillNear, cFloor, smoothstep(0.0, 0.3, f));
    col = mix(col, ground, smoothstep(px, -px, yy));

    // the floating course casts a soft shadow on the ground beneath it
    vec2 sp = (gl_FragCoord.xy - uShadow.xy) / vec2(uShadow.z, uShadow.z * 0.3);
    col *= 1.0 - uShade * smoothstep(1.0, 0.0, length(sp));

    // dither away banding
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

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

    // Quality is render density: "high" is crisp, "low" is lighter. "auto" starts high and steps down if frames drag.
    this.qualityMode = quality === 'high' || quality === 'low' ? quality : 'auto';
    this.quality = this.qualityMode === 'low' ? 'low' : 'high';
    this.frameAvg = 16;
    this.frameCount = 0;
    this.applyQuality();

    this.scene = new THREE.Scene();
    // Image-based light for the physically shaded pieces (ball, pin, water sheen).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Orthographic isometric camera
    this.frustumSize = 10;
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.orbitIndex = 0; // 0..3 (90 deg increments around Y)
    this.orbitAngle = Math.PI / 4;
    this.targetOrbitAngle = Math.PI / 4;

    // Lights: one soft key with shadows, sky fill, a cool kicker
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb9c2c8, 1.2);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.position.set(-7, 15, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -8;
    this.sun.shadow.camera.right = 8;
    this.sun.shadow.camera.top = 8;
    this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 5;
    this.scene.add(this.sun);

    this.fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
    this.fill.position.set(9, 6, -6);
    this.scene.add(this.fill);

    // Backdrop (drawn first, ignores depth)
    this.backdropUniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uHorizon: { value: 0.5 },
      uSun: { value: new THREE.Vector2(0, 0) },
      uShadow: { value: new THREE.Vector3(0, 0, 100) },
      uShade: { value: 0.16 },
      uGlow: { value: 0.34 },
      cTop: { value: new THREE.Color() },
      cMid: { value: new THREE.Color() },
      cHorizon: { value: new THREE.Color() },
      cFloor: { value: new THREE.Color() },
      cHillFar: { value: new THREE.Color() },
      cHillNear: { value: new THREE.Color() },
      cSun: { value: new THREE.Color() },
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
    this.geo = {
      cap: new THREE.BoxGeometry(s, CAP_H, s),
      overlay: new THREE.PlaneGeometry(s * 0.9, s * 0.9).rotateX(-Math.PI / 2),
      hedge: new RoundedBoxGeometry(0.82, 0.56, 0.82, 4, 0.14),
      topiary: new THREE.SphereGeometry(0.27, 24, 16),
      stal: new THREE.ConeGeometry(s * 0.71, 1, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, -0.5, 0),
      flower: new THREE.SphereGeometry(0.036, 8, 6).scale(1, 0.6, 1),
      stem: new THREE.CylinderGeometry(0.1, 0.13, 0.2, 20).translate(0, 0.1, 0),
      shroom: new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1),
      spot: new THREE.SphereGeometry(0.05, 12, 8).scale(1, 0.5, 1),
      stoneRing: new THREE.TorusGeometry(0.31, 0.07, 12, 32).rotateX(Math.PI / 2).scale(1, 0.7, 1),
      portalDisc: new THREE.CircleGeometry(0.25, 32).rotateX(-Math.PI / 2),
      cupDisc: new THREE.CircleGeometry(0.2, 32).rotateX(-Math.PI / 2),
      cupLip: new THREE.TorusGeometry(0.207, 0.018, 8, 36).rotateX(Math.PI / 2),
      pole: new THREE.CylinderGeometry(0.024, 0.028, 1.42, 16),
      finial: new THREE.SphereGeometry(0.036, 14, 10),
      flag: new THREE.PlaneGeometry(0.66, 0.42, 18, 8).translate(0.33, 0, 0),
      spark: new THREE.SphereGeometry(0.05, 6, 6),
      dot: new THREE.SphereGeometry(0.036, 10, 8),
      ring: new THREE.RingGeometry(0.2, 0.29, 36).rotateX(-Math.PI / 2),
      hitArrow: new THREE.BoxGeometry(0.92, 0.6, 0.98),
      hitTile: new THREE.BoxGeometry(0.96, 0.3, 0.96),
      beam: new THREE.CylinderGeometry(0.2, 0.2, 1, 24, 1, true).translate(0, 0.5, 0),
      chevron: this.makeChevronGeometry(),
    };

    // Ball: glossy, dimpled, physically shaded
    this.ballGroup = new THREE.Group();
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 48, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.3,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        normalMap: makeDimpleNormalMap(),
        normalScale: new THREE.Vector2(0.55, 0.55),
        envMap: this.envMap,
        envMapIntensity: 0.9,
      })
    );
    this.ballMesh.castShadow = true;
    this.ballGroup.add(this.ballMesh);
    this.islandGroup.add(this.ballGroup);

    // A soft contact shadow straight below the ball: shows where a chip will come down
    const shadowGeo = new THREE.PlaneGeometry(0.62, 0.62);
    shadowGeo.rotateX(-Math.PI / 2);
    this.ballShadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({
        map: makeCanvasTex(64, (ctx, sz) => {
          const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
          g.addColorStop(0, 'rgba(14,30,18,0.5)');
          g.addColorStop(0.5, 'rgba(14,30,18,0.2)');
          g.addColorStop(1, 'rgba(14,30,18,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, sz, sz);
        }),
        transparent: true,
        depthWrite: false,
      })
    );
    this.islandGroup.add(this.ballShadow);

    // A short trail behind the moving ball
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.trail = [];
    this.trailHistory = [];
    const trailGeo = new THREE.SphereGeometry(BALL_R * 0.8, 12, 10);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(trailGeo, this.trailMat);
      m.visible = false;
      this.fxGroup.add(m);
      this.trail.push(m);
    }

    // Animated references
    this.columns = [];
    this.portalDiscs = [];
    this.springs = [];
    this.beams = [];
    this.flowers = null;
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
    this.maxElev = 0;

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
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // lie flat, pointing +Z
    return geo;
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, this.quality === 'high' ? 2 : 1.25));
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
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
    const matte = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
    const tile = (paint, extra = {}, texOpts = { repeat: true }) => matte({ map: makeCanvasTex(128, paint, texOpts), ...extra });
    // A crisp bevel line just inside the tile edge: light on two sides, shade on the other two.
    const bevel = (ctx, s, light = 0.22, shade = 0.14) => {
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,255,255,${light})`;
      ctx.beginPath();
      ctx.moveTo(2, s - 2);
      ctx.lineTo(2, 2);
      ctx.lineTo(s - 2, 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(0,0,0,${shade})`;
      ctx.beginPath();
      ctx.moveTo(s - 2, 2);
      ctx.lineTo(s - 2, s - 2);
      ctx.lineTo(2, s - 2);
      ctx.stroke();
    };
    const m = {};

    // Turf: two quiet tones, the way a fairway is mown
    const turf = (base) =>
      tile((ctx, s) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, s, s);
        bevel(ctx, s, 0.2, 0.12);
      });
    m.grassA = turf(t.turfA);
    m.grassB = turf(t.turfB);

    m.sand = tile((ctx, s) => {
      ctx.fillStyle = t.sand;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = t.sandLine;
      ctx.lineWidth = 2.5;
      for (let r = 26; r < s * 1.4; r += 22) {
        ctx.beginPath();
        ctx.arc(-4, s + 4, r, -Math.PI / 2, 0);
        ctx.stroke();
      }
      bevel(ctx, s, 0.3, 0.16);
    });

    m.ice = tile((ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, t.ice);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(26, s - 36);
      ctx.lineTo(s - 42, 26);
      ctx.moveTo(58, s - 22);
      ctx.lineTo(s - 22, 62);
      ctx.stroke();
      ctx.strokeStyle = t.iceEdge;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    }, { roughness: 0.12, envMap: this.envMap, envMapIntensity: 0.7 });

    m.mud = tile((ctx, s) => {
      ctx.fillStyle = t.mud;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = t.mudDark;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.ellipse(18 + hash2(i, 1.1) * (s - 36), 18 + hash2(i, 6.4) * (s - 36), 9 + hash2(i, 3.3) * 8, 5 + hash2(i, 9.9) * 4, hash2(i, 2.2) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      bevel(ctx, s, 0.14, 0.2);
    });

    m.water = tile((ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, t.water);
      g.addColorStop(1, t.waterDeep);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (const [x, y, w] of [[18, 34, 30], [70, 58, 36], [30, 92, 26], [84, 104, 22]]) {
        for (const ox of [0, -s, s]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y);
          ctx.quadraticCurveTo(x + ox + w / 2, y - 5, x + ox + w, y);
          ctx.stroke();
        }
      }
    }, { roughness: 0.08, envMap: this.envMap, envMapIntensity: 0.9 });

    // Boost strip: a boardwalk with white chevrons sliding along it
    m.conveyor = tile((ctx, s) => {
      ctx.fillStyle = t.plank;
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = t.plankDark;
      ctx.lineWidth = 2;
      for (let y = s / 4; y < s; y += s / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
      bevel(ctx, s, 0.2, 0.2);
    });
    m.chevrons = new THREE.MeshBasicMaterial({
      map: makeCanvasTex(128, (ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const yOff of [14, 78]) {
          ctx.beginPath();
          ctx.moveTo(36, yOff + 30);
          ctx.lineTo(s / 2, yOff + 8);
          ctx.lineTo(s - 36, yOff + 30);
          ctx.stroke();
        }
      }, { repeat: true }),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    m.ramp = tile((ctx, s) => {
      ctx.fillStyle = t.ramp;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (const yOff of [30, 64, 98]) {
        ctx.beginPath();
        ctx.moveTo(s / 2, yOff - 13);
        ctx.lineTo(s - 38, yOff + 6);
        ctx.lineTo(38, yOff + 6);
        ctx.closePath();
        ctx.fill();
      }
    });
    m.rampSide = matte({ color: t.soil });

    // Cliff face: a clean lip of turf over soil that deepens toward the foot. Two world units tall, clamped.
    m.cliff = matte({
      map: makeCanvasTex(32, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, t.soil);
        g.addColorStop(1, t.soilDark);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = t.turfEdge;
        ctx.fillRect(0, 0, w, 15);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, 15, w, 3);
      }, { height: 256 }),
    });
    m.cliff.map.wrapS = THREE.RepeatWrapping;
    m.rock = matte({ color: t.rock, flatShading: true });

    m.hedge = matte({ color: t.hedge, roughness: 1 });

    m.rimGrass = matte({ color: t.turfEdge });
    m.rimSand = matte({ color: t.sandLine });
    m.rimIce = matte({ color: t.iceEdge });
    m.rimMud = matte({ color: t.mudDark });
    m.rimWater = matte({ color: t.waterDeep });
    m.rimConv = matte({ color: t.plankDark });

    // Toadstool (springs)
    m.shroomStem = matte({ color: 0xf6eedd, roughness: 0.8 });
    m.shroomCap = matte({ color: 0xd9412f, roughness: 0.35, envMap: this.envMap, envMapIntensity: 0.5 });
    m.shroomSpot = matte({ color: 0xffffff, roughness: 0.5 });

    // Cup, pin and flag: real objects on the model
    const real = (o) => new THREE.MeshStandardMaterial({ envMap: this.envMap, ...o });
    m.cupDisc = new THREE.MeshBasicMaterial({ color: 0x0d0b09 });
    m.cupLip = real({ color: 0xf7f5ee, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.8 });
    m.pole = new THREE.MeshPhysicalMaterial({ color: 0xfbfaf4, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap: this.envMap, envMapIntensity: 0.9 });
    m.metal = real({ color: 0xd8d8d2, roughness: 0.22, metalness: 1, envMapIntensity: 1.2 });
    m.flag = real({
      map: makeCanvasTex(128, (ctx, s) => {
        ctx.fillStyle = '#e02630';
        ctx.fillRect(0, 0, s, s);
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = '#000';
        for (let i = 0; i < s; i += 2) ctx.fillRect(i, 0, 1, s);
        for (let i = 0; i < s; i += 2) ctx.fillRect(0, i, s, 1);
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = '#5a0a10';
        ctx.lineWidth = 3;
        ctx.strokeRect(3, 3, s - 6, s - 6);
        ctx.globalAlpha = 1;
      }),
      roughness: 0.7,
      side: THREE.DoubleSide,
      envMapIntensity: 0.4,
      // cloth passes light: keep the shaded side a rich red rather than letting it go black
      emissive: 0xb0121c,
      emissiveIntensity: 0.4,
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
    m.beamA = beam(0x7fe6da, 0.2);
    m.beamB = beam(0xffc79a, 0.2);

    // Stone rings with a slow swirl (portals)
    m.stone = matte({ color: 0xc9c3b6, roughness: 0.8 });
    const swirlTex = makeCanvasTex(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 8;
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
    m.portalA = pool(0x1f9f93, 0xd6fff8);
    m.portalB = pool(0xe57a44, 0xfff1d6);

    m.flower = new THREE.MeshBasicMaterial({ color: 0xffffff });

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
    this.fill.color.setHex(t.fillColor);
    this.fill.intensity = t.fillInt;

    const u = this.backdropUniforms;
    u.cTop.value.set(t.skyTop);
    u.cMid.value.set(t.skyMid);
    u.cHorizon.value.set(t.horizon);
    u.cFloor.value.set(t.floor);
    u.cHillFar.value.set(t.hillFar);
    u.cHillNear.value.set(t.hillNear);
    u.cSun.value.set(t.sunGlow);
    u.uShade.value = t.groundShade;
    u.uGlow.value = t.glow;

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
    this.portalDiscs = [];
    this.springs = [];
    this.beams = [];
    this.flowers = null;
    this.flagCloth = null;
    this.clearArrows();

    const m = this.mats;
    const s = TILE_SIZE;
    const colGeos = new Map();
    const maxDist = Math.hypot(level.width, level.height) / 2;
    const flowerSpots = [];
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
        stal.scale.y = 0.3 + (1 - centre / maxDist) * 1.2 + hash2(x * 3.1, y * 1.7) * 0.4;
        stal.position.y = -BASE_THICKNESS;
        col.add(stal);

        // Top surface
        if (isRamp) {
          const wedge = this.createRampMesh(s, ELEV_STEP, RAMP_DIR[cell.terrain]);
          wedge.position.y = topY;
          col.add(wedge);
        } else {
          let topMat = (x + y) % 2 === 0 ? m.grassA : m.grassB;
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

        // A few small white flowers, sparingly, kept clear of the middle of the tile
        const isOpenTurf = cell.terrain === TERRAIN.GRASS && !(x === level.start.x && y === level.start.y);
        if (isOpenTurf && hash2(x * 1.9, y * 6.7) > 0.72) {
          const ang = hash2(x * 4.1, y * 8.3) * Math.PI * 2;
          for (let i = 0; i < 3; i++) {
            const a = ang + i * 0.5;
            const rad = 0.33 + hash2(x + i, y + i * 3.1) * 0.1;
            flowerSpots.push({ x: pos.x + Math.cos(a) * rad, y: pos.y + 0.022, z: pos.z + Math.sin(a) * rad });
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
          this.springs.push(shroom);
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
          beam.scale.set(1.2, 0.8, 1.2);
          beam.position.y = pos.y + 0.04;
          beam.userData.phase = isA ? 0 : 2;
          col.add(beam);
          this.beams.push(beam);
        }

        if (cell.terrain === TERRAIN.CUP) {
          const hole = new THREE.Mesh(this.geo.cupDisc, m.cupDisc);
          hole.position.y = pos.y + 0.006;
          col.add(hole);
          const lip = new THREE.Mesh(this.geo.cupLip, m.cupLip);
          lip.position.y = pos.y + 0.008;
          col.add(lip);

          const pole = new THREE.Mesh(this.geo.pole, m.pole);
          pole.position.y = pos.y + 0.62;
          pole.castShadow = true;
          col.add(pole);
          const finial = new THREE.Mesh(this.geo.finial, m.metal);
          finial.position.y = pos.y + 1.34;
          col.add(finial);

          // cloth: its own geometry, because the vertices are waved every frame
          const flagGeo = this.track(this.geo.flag.clone());
          flagGeo.userData.rest = flagGeo.attributes.position.array.slice();
          this.flagCloth = new THREE.Mesh(flagGeo, m.flag);
          this.flagCloth.position.set(0.014, pos.y + 1.1, 0);
          this.flagCloth.castShadow = true;
          col.add(this.flagCloth);
        }
      }
    }

    // Flowers are instanced; they open once the course has finished building.
    if (flowerSpots.length > 0) {
      const mesh = this.track(new THREE.InstancedMesh(this.geo.flower, m.flower, flowerSpots.length));
      flowerSpots.forEach((f, i) => {
        dummy.position.set(f.x, f.y, f.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      this.boardGroup.add(mesh);
      this.flowers = mesh;
    }

    this.maxElev = maxElev;
    this.introT = intro && !this.reducedMotion ? 0 : Infinity;
    this.floraT = 1;
    if (this.introT === 0) {
      for (const col of this.columns) col.visible = false;
      this.floraT = 0;
    }
    if (this.flowers) this.flowers.visible = this.floraT === 1;
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
      const steps = Math.max(2, Math.round(dist * (arc ? 3.2 : 2.5)));
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
   * Show 4 direction chevrons around the ball, a dotted flight path for each
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
      const color = isRec || sim.won ? GUIDE.gold : isBad ? GUIDE.bad : isIdle ? GUIDE.idle : GUIDE.good;

      const arrow = new THREE.Group();
      // A fine dark keyline under each chevron keeps it legible on turf, sand and ice alike
      const outline = new THREE.Mesh(
        this.geo.chevron,
        new THREE.MeshBasicMaterial({ color: GUIDE.key, transparent: true, opacity: isIdle ? 0.25 : 0.85 })
      );
      outline.userData.ownMaterial = true;
      outline.scale.set(1.18, 0.5, 1.18);
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
        outline.scale.set(1.42, 0.5, 1.42);
      }
      arrow.add(chev);
      arrow.userData.chev = chev;
      arrow.userData.outline = outline;

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
        const dots = new THREE.InstancedMesh(this.geo.dot, new THREE.MeshBasicMaterial({ color }), pts.length);
        pts.forEach((p, i) => {
          dummy.position.copy(p);
          dummy.updateMatrix();
          dots.setMatrixAt(i, dummy.matrix);
        });
        dots.instanceMatrix.needsUpdate = true;
        this.previewGroup.add(dots);
      }

      // Landing ring (also a tap target)
      if (!sim.hazard && moved) {
        const endElev = this.level.grid[sim.endPos.y][sim.endPos.x].elev;
        const ep = this.gridToWorld(sim.endPos.x, sim.endPos.y, endElev);
        const halo = new THREE.Mesh(
          this.geo.ring,
          new THREE.MeshBasicMaterial({ color: GUIDE.key, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
        );
        halo.position.set(ep.x, ep.y + 0.034, ep.z);
        halo.userData.phase = d.id * 0.9;
        halo.userData.base = 1.13;
        this.previewGroup.add(halo);
        this.previewRings.push(halo);

        const ring = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        ring.position.set(ep.x, ep.y + 0.04, ep.z);
        ring.userData.phase = d.id * 0.9;
        ring.userData.base = 1;
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
      this.fxGroup.add(m);
      this.particles.push(m);
    }
  }

  spawnVictoryConfetti(gx, gy, elev) {
    const p = this.gridToWorld(gx, gy, elev);
    p.y += 0.3;
    const colors = [0xe9b949, 0xffffff, 0xf3ead6, 0x8fd08a, 0xe02630];
    for (const c of colors) {
      this.spawnParticles(p, c, 9, 3.0);
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
    const half = (span * Math.SQRT2) / 2;
    const halfW = half + 0.12;
    const up = half * CAM_ELEV_SIN + (this.maxElev * ELEV_STEP + 1.5) * CAM_ELEV_COS;
    const down = half * CAM_ELEV_SIN + (BASE_THICKNESS + 0.7) * CAM_ELEV_COS;

    // Leave some air around the model: it should sit in the space, not fill it.
    const worldPerPx = Math.max((2 * halfW) / freeW, (up + down) / freeH) * 1.1;
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

    // Backdrop: horizon a little above the middle of the free region, glow up toward the light,
    // and the island's ground shadow below its lowest point.
    const u = this.backdropUniforms;
    const freeCx = ins.left + freeW / 2;
    const freeCy = ins.bottom + freeH / 2; // CSS px from the bottom
    const originY = freeCy - (up - down) / 2 / worldPerPx;
    u.uRes.value.set(w * pr, h * pr);
    u.uHorizon.value = (freeCy + freeH * 0.1) / h;
    u.uSun.value.set((ins.left + freeW * 0.24) * pr, (ins.bottom + freeH * 0.9) * pr);
    u.uShadow.value.set(freeCx * pr, (originY - (down / worldPerPx) * 1.12) * pr, (halfW / worldPerPx) * 0.92 * pr);
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
    const still = this.reducedMotion;

    // Adaptive quality: if frames stay slow at full density, render lighter.
    if (this.qualityMode === 'auto' && this.quality === 'high' && !document.hidden) {
      this.frameCount++;
      if (this.frameCount > 45) {
        this.frameAvg += (rawDt * 1000 - this.frameAvg) * 0.05;
        if (this.frameCount > 150 && this.frameAvg > 30) this.setQuality('low');
      }
    }

    // Smooth camera orbit
    this.orbitAngle = THREE.MathUtils.damp(this.orbitAngle, this.targetOrbitAngle, 8, dt);
    const shakeAmt = still ? 0 : this.shake;
    const shakeX = shakeAmt > 0 ? (Math.random() - 0.5) * shakeAmt * 0.2 : 0;
    const shakeY = shakeAmt > 0 ? (Math.random() - 0.5) * shakeAmt * 0.2 : 0;
    this.shake = Math.max(0, this.shake - dt * 3.5);

    this.camera.position.set(
      Math.cos(this.orbitAngle) * CAM_RADIUS + shakeX,
      CAM_Y + shakeY,
      Math.sin(this.orbitAngle) * CAM_RADIUS
    );
    this.camera.lookAt(0, 0, 0);

    // The model drifts very slightly, as if suspended
    this.islandGroup.position.y = still ? 0 : Math.sin(elapsed * 0.9) * 0.035;

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

    // Flowers open after the course has built
    if (this.floraT < 1 && this.introT === Infinity) {
      this.floraT = Math.min(1, this.floraT + dt * 2.6);
      if (this.flowers) {
        this.flowers.visible = true;
        this.flowers.scale.y = Math.max(0.001, this.floraT);
      }
    }

    // Ball pop-in (new hole, hazard respawn)
    if (this.ballPop < 1 && !this.animQueue) {
      this.ballPop = Math.min(1, this.ballPop + dt * 3.6);
      const u = Math.max(0, this.ballPop);
      const sc = u < 1 ? 1 + 0.35 * Math.sin(u * Math.PI) - (1 - u) : 1;
      this.ballGroup.scale.setScalar(Math.max(0.001, sc));
      this.ballShadow.scale.setScalar(Math.max(0.001, u));
    }

    // Lapping water, sliding chevrons, portal swirls, toadstools, light shafts
    if (this.mats && !still) {
      this.mats.water.map.offset.set(Math.sin(elapsed * 0.6) * 0.03, Math.cos(elapsed * 0.45) * 0.02);
      this.mats.chevrons.map.offset.y = -((elapsed * 0.7) % 1);
    }
    for (const pd of this.portalDiscs) {
      pd.rotation.y = elapsed * 1.4 * pd.userData.spin;
    }
    for (const sp of this.springs) {
      const k = still ? 0 : Math.sin(elapsed * 2.2 + sp.userData.phase);
      sp.scale.set(1 - k * 0.03, 1 + k * 0.05, 1 - k * 0.03);
    }
    for (const b of this.beams) {
      b.material.opacity = b.material.userData.baseOpacity * (0.8 + 0.2 * Math.sin(elapsed * 1.6 + b.userData.phase));
    }

    if (this.flagCloth) {
      // Cloth in a light breeze: travelling waves that grow away from the stick, lit by recomputed normals.
      const geo = this.flagCloth.geometry;
      const rest = geo.userData.rest;
      const posAttr = geo.attributes.position;
      const tt = still ? 0 : elapsed;
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

    // Pulse chevrons and landing rings
    for (const child of this.arrowGroup.children) {
      const chev = child.userData.chev;
      if (chev) {
        chev.position.z = 0.6 + (Math.sin(elapsed * 4.6 + child.userData.dirId) * 0.5 + 0.5) * 0.08;
        child.userData.outline.position.z = chev.position.z;
      }
    }
    for (const ring of this.previewRings) {
      ring.scale.setScalar(ring.userData.base * (1 + (Math.sin(elapsed * 3.8 + ring.userData.phase) * 0.5 + 0.5) * 0.18));
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

    // Trail
    if (this.animQueue) {
      this.trailHistory.unshift(this.ballGroup.position.clone());
      if (this.trailHistory.length > 22) this.trailHistory.length = 22;
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

    this.renderer.render(this.scene, this.camera);
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
        this.shake = 0.3;
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
        this.spawnParticles(p0, 0xd6fff8, 10, 2.0);
        this.spawnParticles(p1, 0xfff1d6, 12, 2.2);
        if (q.onEvent) q.onEvent('portal');
      }
    } else if (seg.type === 'sink') {
      // Drop into the cup
      const e = u * u;
      this.ballGroup.position.set(p1.x, p1.y + BALL_R - e * 0.3, p1.z);
      this.ballGroup.scale.setScalar(1 - e * 0.4);
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
        this.spawnParticles(p0, 0xffffff, 8, 1.8);
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
          this.shake = 0.4;
          this.spawnParticles(this.ballGroup.position, res.hazard === 'water' ? 0xd8f3ff : 0xffffff, 18, 2.6);
          if (q.onEvent) q.onEvent('water');
          this.placeBallImmediate(res.endPos.x, res.endPos.y, endTile.elev);
          this.ballPop = 0; // respawn pop
        } else if (res.won) {
          this.shake = 0.25;
          this.spawnVictoryConfetti(res.endPos.x, res.endPos.y, endTile.elev);
          if (q.onEvent) q.onEvent('sink');
          // Leave the ball resting in the cup.
          this.ballPos = { ...res.endPos };
          this.ballElev = endTile.elev;
        } else {
          if (res.events.includes('sand_stop') || res.stuckInSand) {
            this.spawnParticles(this.ballGroup.position, 0xf1e2bd, 12, 1.8);
            if (q.onEvent) q.onEvent('sand');
          }
          this.placeBallImmediate(res.endPos.x, res.endPos.y, endTile.elev);
        }
        if (done) done();
      }
    }
  }
}
