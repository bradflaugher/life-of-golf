// Life of Golf — Three.js isometric renderer: a neon course floating over a synthwave horizon.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  DIRS,
  TERRAIN,
  RAMP_DIR,
  CONV_DIR,
  simulateShot,
} from './engine.js';

const TILE_SIZE = 1.0;
const TILE_GAP = 0.03;
const ELEV_STEP = 0.42;
const BASE_THICKNESS = 0.65;
const CAP_H = 0.1;
const BALL_R = 0.18;
const CAM_RADIUS = 16;
const CAM_Y = 12.2;
const CAM_ELEV_SIN = CAM_Y / Math.hypot(CAM_RADIUS, CAM_Y);
const CAM_ELEV_COS = CAM_RADIUS / Math.hypot(CAM_RADIUS, CAM_Y);

const NEON = {
  cyan: 0x29e6ff,
  magenta: 0xff3fc8,
  amber: 0xffc23d,
  green: 0x3dff9e,
  violet: 0x9d6bff,
  red: 0xff4a5f,
  idle: 0x6a78a8,
};

const THEMES = {
  // "Midnight Links": deep navy, cyan and magenta tubes.
  dark: {
    skyTop: '#03041a',
    skyMid: '#0d1140',
    skyHaze: '#5a1a8c',
    sunA: '#2fc4ff',
    sunB: '#ff3fc8',
    floor: '#05061c',
    grid: '#ff3fc8',
    hemiSky: 0x9fb6ff,
    hemiGround: 0x2a1450,
    hemiInt: 1.25,
    sunColor: 0xdfe8ff,
    sunInt: 1.9,
    rimColor: 0xff4fd0,
    rimInt: 0.9,
    turfA: '#12865f',
    turfB: '#0f7554',
    turfLine: '#5dffc0',
    ramp: '#1aa373',
    cliff: '#171c52',
    cliffLine: '#5a6dff',
    rock: 0x151a4a,
    wall: '#141a4a',
    wallLine: '#7f95ff',
    sand: '#e2ac45',
    sandDot: '#b47a22',
    water: '#0a3f8f',
    waterLine: '#39e8ff',
    ice: '#b9ecff',
    mud: '#3a2247',
    mudDot: '#27152f',
    conveyor: '#161a45',
    bloom: 0.5,
  },
  // "Sunset Drive": plum sky, molten sun, warm tubes.
  light: {
    skyTop: '#1c0b3f',
    skyMid: '#7a2380',
    skyHaze: '#ff7a59',
    sunA: '#ffe873',
    sunB: '#ff3f8e',
    floor: '#1a0933',
    grid: '#ff9a4a',
    hemiSky: 0xffd9c2,
    hemiGround: 0x4a1d5e,
    hemiInt: 1.45,
    sunColor: 0xfff0d6,
    sunInt: 2.2,
    rimColor: 0xff8a4a,
    rimInt: 0.9,
    turfA: '#1da877',
    turfB: '#19966a',
    turfLine: '#b4ffd9',
    ramp: '#27c08a',
    cliff: '#3c1c63',
    cliffLine: '#ff7ad0',
    rock: 0x221040,
    wall: '#351a5c',
    wallLine: '#ffb0e6',
    sand: '#f2be55',
    sandDot: '#c98a2c',
    water: '#1556b0',
    waterLine: '#7df2ff',
    ice: '#cdf3ff',
    mud: '#4a2848',
    mudDot: '#331a33',
    conveyor: '#2a1650',
    bloom: 0.42,
  },
};

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function makeCanvasTex(size, drawFn, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  return tex;
}

// A tile-top material: `paint` draws the colour map, `glow` (optional) draws what should emit light.
function tileMaterial({ paint, glow, glowInt = 1, roughness = 0.8, metalness = 0, extra = {} }) {
  const map = makeCanvasTex(128, paint, { repeat: true });
  const opts = { map, roughness, metalness, ...extra };
  if (glow) {
    opts.emissiveMap = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, s, s);
      glow(ctx, s);
    }, { repeat: true });
    opts.emissive = new THREE.Color(0xffffff);
    opts.emissiveIntensity = glowInt;
  }
  return new THREE.MeshStandardMaterial(opts);
}

function strokeBorder(ctx, s, color, width = 4, inset = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(inset, inset, s - inset * 2, s - inset * 2);
}

const BACKDROP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// Synthwave backdrop: gradient sky, twinkling stars, a striped sun and a scrolling horizon grid.
const BACKDROP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uRes;
  uniform float uScale;
  uniform float uHorizon;
  uniform vec2 uSun;
  uniform float uSunR;
  uniform vec3 cTop;
  uniform vec3 cMid;
  uniform vec3 cHaze;
  uniform vec3 cSunA;
  uniform vec3 cSunB;
  uniform vec3 cFloor;
  uniform vec3 cGrid;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 px = vUv * uRes;
    float y = vUv.y;
    vec3 col;

    if (y >= uHorizon) {
      float t = (y - uHorizon) / max(0.001, 1.0 - uHorizon);
      col = mix(cHaze, cMid, smoothstep(0.0, 0.42, t));
      col = mix(col, cTop, smoothstep(0.3, 0.95, t));

      // Stars
      float cell = 26.0 * uScale;
      vec2 id = floor(px / cell);
      vec2 f = fract(px / cell);
      float h = hash(id);
      if (h > 0.8) {
        vec2 sp = vec2(hash(id + 1.3), hash(id + 2.7)) * 0.7 + 0.15;
        float d = length(f - sp) * cell;
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + 2.4 * hash(id + 5.1)) + h * 40.0);
        float size = (0.7 + 1.1 * hash(id + 9.2)) * uScale;
        col += vec3(0.85, 0.92, 1.0) * smoothstep(size, 0.0, d) * tw * smoothstep(0.08, 0.5, t);
      }

      // Striped sun
      vec2 sv = px - uSun;
      float sd = length(sv);
      float sy = sv.y / uSunR;
      float disc = smoothstep(uSunR + 1.5, uSunR - 1.5, sd);
      float band = fract((sy - uTime * 0.035) * 6.0);
      float thick = mix(0.62, 0.0, smoothstep(-1.0, 0.35, sy));
      float cut = step(band, thick);
      vec3 sunCol = mix(cSunB, cSunA, smoothstep(-0.9, 0.9, sy));
      col = mix(col, sunCol, disc * (1.0 - cut) * 0.46);
      col += cSunB * exp(-max(sd - uSunR, 0.0) / (uSunR * 0.5)) * 0.2;
    } else {
      float d = uHorizon - y;
      float aspect = uRes.x / uRes.y;
      float wz = 0.5 / (d + 0.0025);
      float wx = (vUv.x - 0.5) * aspect * wz * 2.2;
      vec2 g = vec2(wx, wz + uTime * 0.55);
      vec2 fw = fwidth(g);
      vec2 a = abs(fract(g) - 0.5);
      float lx = (1.0 - smoothstep(0.0, fw.x * 1.6, a.x)) * clamp(1.0 - fw.x * 1.6, 0.0, 1.0);
      float lz = (1.0 - smoothstep(0.0, fw.y * 1.6, a.y)) * clamp(1.0 - fw.y * 1.6, 0.0, 1.0);
      float line = max(lx, lz);
      col = cFloor + cGrid * line * (0.5 * smoothstep(0.0, 0.05, d) + 0.12);
      col += cHaze * exp(-d * 16.0) * 0.75;
      col += cSunB * exp(-d * 70.0) * 0.55;
    }

    // Darken the edges where the HUD and the card hand sit.
    col *= mix(0.45, 1.0, smoothstep(0.0, 0.28, y)) * mix(0.72, 1.0, smoothstep(1.0, 0.82, y));
    gl_FragColor = vec4(col, 1.0);
    // No-ops when rendering into the bloom composer; needed on the direct (low quality) path.
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Quality: "high" = bloom composer, "low" = direct render. "auto" starts high and steps down if frames drag.
    this.qualityMode = quality === 'high' || quality === 'low' ? quality : 'auto';
    this.quality = this.qualityMode === 'low' ? 'low' : 'high';
    this.frameAvg = 16;
    this.frameCount = 0;

    this.scene = new THREE.Scene();

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
    this.sun.position.set(9, 16, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -8;
    this.sun.shadow.camera.right = 8;
    this.sun.shadow.camera.top = 8;
    this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.bias = -0.0012;
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0xff4fd0, 0.9);
    this.rim.position.set(-8, 5, -9);
    this.scene.add(this.rim);

    // Backdrop (drawn first, ignores depth)
    this.backdropUniforms = {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 1 },
      uHorizon: { value: 0.5 },
      uSun: { value: new THREE.Vector2(0, 0) },
      uSunR: { value: 100 },
      cTop: { value: new THREE.Color() },
      cMid: { value: new THREE.Color() },
      cHaze: { value: new THREE.Color() },
      cSunA: { value: new THREE.Color() },
      cSunB: { value: new THREE.Color() },
      cFloor: { value: new THREE.Color() },
      cGrid: { value: new THREE.Color() },
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
    const s = TILE_SIZE - TILE_GAP;
    this.geo = {
      cap: new THREE.BoxGeometry(s, CAP_H, s),
      spark: new THREE.SphereGeometry(0.05, 6, 6),
      dot: new THREE.SphereGeometry(0.042, 8, 6),
      ring: new THREE.RingGeometry(0.2, 0.29, 28).rotateX(-Math.PI / 2),
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
      new THREE.SphereGeometry(BALL_R, 28, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
        metalness: 0.05,
        emissive: 0xbfe8ff,
        emissiveIntensity: 0.45,
      })
    );
    this.ballMesh.castShadow = true;
    this.ballGroup.add(this.ballMesh);

    // Ground shadow blob under the ball (reads height during chips)
    const shadowGeo = new THREE.CircleGeometry(0.19, 20);
    shadowGeo.rotateX(-Math.PI / 2);
    this.ballShadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ color: 0x000010, transparent: true, opacity: 0.4, depthWrite: false })
    );
    this.islandGroup.add(this.ballShadow);
    this.islandGroup.add(this.ballGroup);

    // Comet trail behind the moving ball
    this.trailMat = new THREE.MeshBasicMaterial({
      color: NEON.cyan,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = [];
    this.trailHistory = [];
    const trailGeo = new THREE.SphereGeometry(BALL_R * 0.82, 10, 8);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(trailGeo, this.trailMat);
      m.visible = false;
      this.fxGroup.add(m);
      this.trail.push(m);
    }

    // Drifting motes around the island
    this.motes = this.makeMotes();
    this.islandGroup.add(this.motes);

    // Animated references
    this.columns = [];
    this.portalRings = [];
    this.portalDiscs = [];
    this.springRings = [];
    this.beams = [];
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
    this.moteMat = new THREE.PointsMaterial({
      map: sprite,
      size: 6,
      sizeAttenuation: false,
      color: NEON.cyan,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, this.moteMat);
    pts.frustumCulled = false;
    return pts;
  }

  setupPipeline() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
    const dpr = window.devicePixelRatio || 1;
    if (this.quality === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), THEMES[this.themeName].bloom, 0.55, 0.86);
      this.composer.addPass(this.bloomPass);
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
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const rim = (hex, int = 0.55) => std({ color: hex, emissive: hex, emissiveIntensity: int, roughness: 0.5 });
    const turf = (base) =>
      tileMaterial({
        paint: (ctx, s) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, s, s);
          // faint mowing stripes
          ctx.fillStyle = 'rgba(255,255,255,0.045)';
          for (let x = 0; x < s; x += 32) ctx.fillRect(x, 0, 16, s);
          strokeBorder(ctx, s, t.turfLine, 3, 2.5);
          ctx.globalAlpha = 0.25;
          strokeBorder(ctx, s, t.turfLine, 8, 4);
          ctx.globalAlpha = 1;
        },
        glow: (ctx, s) => {
          ctx.globalAlpha = 0.38;
          strokeBorder(ctx, s, t.turfLine, 3, 2.5);
        },
        roughness: 0.85,
      });

    const m = {};
    m.grassA = turf(t.turfA);
    m.grassB = turf(t.turfB);

    m.sand = tileMaterial({
      paint: (ctx, s) => {
        ctx.fillStyle = t.sand;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = t.sandDot;
        for (let i = 0; i < 46; i++) {
          const x = hash2(i, 2.1) * s;
          const y = hash2(i, 7.3) * s;
          ctx.beginPath();
          ctx.arc(x, y, 1.6 + hash2(i, 5.5) * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,240,200,0.35)';
        ctx.lineWidth = 3;
        for (let y = 22; y < s; y += 28) {
          ctx.beginPath();
          for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.1 + y) * 4);
          ctx.stroke();
        }
        strokeBorder(ctx, s, '#ffe7a8', 3, 2.5);
      },
      glow: (ctx, s) => {
        ctx.globalAlpha = 0.3;
        strokeBorder(ctx, s, '#ffcf66', 3, 2.5);
      },
      roughness: 0.95,
    });

    m.ice = tileMaterial({
      paint: (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, s, s);
        g.addColorStop(0, '#e9fbff');
        g.addColorStop(0.5, t.ice);
        g.addColorStop(1, '#8fd8f5');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineCap = 'round';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(22, s - 30);
        ctx.lineTo(s - 34, 22);
        ctx.moveTo(52, s - 18);
        ctx.lineTo(s - 18, 56);
        ctx.stroke();
        strokeBorder(ctx, s, '#ffffff', 3, 2.5);
      },
      glow: (ctx, s) => {
        ctx.fillStyle = 'rgba(120,220,255,0.16)';
        ctx.fillRect(0, 0, s, s);
        ctx.globalAlpha = 0.55;
        strokeBorder(ctx, s, '#bdf4ff', 3, 2.5);
      },
      roughness: 0.12,
      metalness: 0.15,
    });

    m.mud = tileMaterial({
      paint: (ctx, s) => {
        ctx.fillStyle = t.mud;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = t.mudDot;
        for (let i = 0; i < 16; i++) {
          ctx.beginPath();
          ctx.ellipse(hash2(i, 1.1) * s, hash2(i, 6.4) * s, 8 + hash2(i, 3.3) * 9, 5 + hash2(i, 9.9) * 5, hash2(i, 2.2) * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.5;
        strokeBorder(ctx, s, '#b58cff', 3, 2.5);
        ctx.globalAlpha = 1;
      },
      glow: (ctx, s) => {
        ctx.globalAlpha = 0.25;
        strokeBorder(ctx, s, '#b58cff', 3, 2.5);
      },
      roughness: 1,
    });

    const waterLines = (ctx, s, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      for (let y = 16; y < s; y += 32) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + Math.sin((x / s) * Math.PI * 4 + y) * 5);
        ctx.stroke();
      }
    };
    m.water = tileMaterial({
      paint: (ctx, s) => {
        ctx.fillStyle = t.water;
        ctx.fillRect(0, 0, s, s);
        waterLines(ctx, s, t.waterLine, 4);
      },
      glow: (ctx, s) => {
        ctx.fillStyle = 'rgba(30,110,220,0.35)';
        ctx.fillRect(0, 0, s, s);
        waterLines(ctx, s, t.waterLine, 4);
      },
      glowInt: 0.95,
      roughness: 0.15,
      metalness: 0.2,
    });

    const chevrons = (ctx, s, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const yOff of [14, 78]) {
        ctx.beginPath();
        ctx.moveTo(30, yOff + 34);
        ctx.lineTo(s / 2, yOff + 6);
        ctx.lineTo(s - 30, yOff + 34);
        ctx.stroke();
      }
    };
    m.conveyor = tileMaterial({
      paint: (ctx, s) => {
        ctx.fillStyle = t.conveyor;
        ctx.fillRect(0, 0, s, s);
        chevrons(ctx, s, '#ffc23d');
      },
      glow: (ctx, s) => chevrons(ctx, s, '#ffb020'),
      glowInt: 1.25,
      roughness: 0.45,
    });

    m.ramp = tileMaterial({
      paint: (ctx, s) => {
        ctx.fillStyle = t.ramp;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (const yOff of [26, 62, 98]) {
          ctx.beginPath();
          ctx.moveTo(s / 2, yOff - 16);
          ctx.lineTo(s - 30, yOff + 8);
          ctx.lineTo(30, yOff + 8);
          ctx.closePath();
          ctx.fill();
        }
        strokeBorder(ctx, s, t.turfLine, 3, 2.5);
      },
      glow: (ctx, s) => {
        ctx.globalAlpha = 0.4;
        strokeBorder(ctx, s, t.turfLine, 3, 2.5);
      },
      roughness: 0.75,
    });
    m.rampSide = std({ color: t.cliff, roughness: 0.9 });

    // Cliff strata: lines repeat once per world unit down each column.
    const strata = (ctx, s, glowOnly) => {
      if (!glowOnly) {
        ctx.fillStyle = t.cliff;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, s * 0.5, s, s * 0.5);
      }
      ctx.fillStyle = t.cliffLine;
      ctx.globalAlpha = glowOnly ? 0.7 : 0.85;
      ctx.fillRect(0, s * 0.3, s, 2);
      ctx.globalAlpha = glowOnly ? 0.35 : 0.5;
      ctx.fillRect(0, s * 0.62, s, 2);
      ctx.fillRect(0, s * 0.86, s, 1.5);
      ctx.globalAlpha = 1;
    };
    m.cliff = tileMaterial({
      paint: (ctx, s) => strata(ctx, s, false),
      glow: (ctx, s) => strata(ctx, s, true),
      glowInt: 0.7,
      roughness: 0.9,
    });
    m.rock = std({ color: t.rock, roughness: 1, flatShading: true });

    // Wall blocks: a nod to the circuit blocks of Infinite Best.
    const wallFace = (ctx, s, glowOnly) => {
      if (!glowOnly) {
        ctx.fillStyle = t.wall;
        ctx.fillRect(0, 0, s, s);
      }
      ctx.globalAlpha = glowOnly ? 0.75 : 1;
      strokeBorder(ctx, s, t.wallLine, 5, 5);
      ctx.globalAlpha = glowOnly ? 0.4 : 0.7;
      strokeBorder(ctx, s, t.wallLine, 4, 36);
      ctx.globalAlpha = 1;
    };
    m.wall = tileMaterial({
      paint: (ctx, s) => wallFace(ctx, s, false),
      glow: (ctx, s) => wallFace(ctx, s, true),
      glowInt: 0.85,
      roughness: 0.6,
    });

    m.rimGrass = rim(new THREE.Color(t.turfLine).getHex(), 0.5);
    m.rimSand = rim(0xffcf66, 0.45);
    m.rimIce = rim(0xbdf4ff, 0.6);
    m.rimMud = rim(0x8a5fd6, 0.4);
    m.rimWater = rim(new THREE.Color(t.waterLine).getHex(), 0.7);
    m.rimConv = rim(NEON.amber, 0.6);

    m.springBase = std({ color: 0xff5a4a, emissive: 0xff3a2a, emissiveIntensity: 0.6, roughness: 0.35 });
    m.springRing = std({ color: 0xffe066, emissive: 0xffc23d, emissiveIntensity: 1.4, roughness: 0.3 });
    m.cupHole = new THREE.MeshBasicMaterial({ color: 0x02030c });
    m.cupRim = new THREE.MeshBasicMaterial({ color: 0xfff3b0, side: THREE.DoubleSide });
    m.pole = std({ color: 0xf4f6ff, emissive: 0xaab8ff, emissiveIntensity: 0.35, roughness: 0.3 });
    m.flag = std({ color: 0xff3f6a, emissive: 0xff2a5a, emissiveIntensity: 1.1, side: THREE.DoubleSide, roughness: 0.45 });

    const beamTex = makeCanvasTex(64, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const beam = (hex, opacity) =>
      new THREE.MeshBasicMaterial({
        map: beamTex,
        color: hex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    m.beamCup = beam(0xffd76a, 0.5);
    m.beamA = beam(NEON.magenta, 0.42);
    m.beamB = beam(NEON.cyan, 0.42);

    const swirlTex = makeCanvasTex(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 7;
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
    const portal = (hex) => ({
      ring: std({ color: hex, emissive: hex, emissiveIntensity: 1.5, roughness: 0.2 }),
      disc: new THREE.MeshBasicMaterial({
        map: swirlTex,
        color: hex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    });
    m.portalA = portal(NEON.magenta);
    m.portalB = portal(NEON.cyan);

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

    const u = this.backdropUniforms;
    u.cTop.value.set(t.skyTop);
    u.cMid.value.set(t.skyMid);
    u.cHaze.value.set(t.skyHaze);
    u.cSunA.value.set(t.sunA);
    u.cSunB.value.set(t.sunB);
    u.cFloor.value.set(t.floor);
    u.cGrid.value.set(t.grid);

    this.moteMat.color.set(this.themeName === 'dark' ? NEON.cyan : 0xffc27a);
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
    const s = TILE_SIZE - TILE_GAP;
    const geo = this.track(new THREE.BoxGeometry(s, height, s));
    // Side faces: stretch V in world units so strata lines line up between columns.
    const uv = geo.attributes.uv;
    for (const face of [0, 1, 4, 5]) {
      for (let i = face * 4; i < face * 4 + 4; i++) {
        uv.setY(i, (uv.getY(i) - 1) * height);
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
    this.flagCloth = null;
    this.clearArrows();

    const m = this.mats;
    const s = TILE_SIZE - TILE_GAP;
    const colGeos = new Map();
    const wallGeo = this.track(new THREE.BoxGeometry(s * 0.88, 0.56, s * 0.88));
    const stalGeo = this.track(new THREE.ConeGeometry(s * 0.69, 1, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, -0.5, 0));
    const maxDist = Math.hypot(level.width, level.height) / 2;
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
        const isRamp = RAMP_DIR[cell.terrain] !== undefined;
        const isConv = CONV_DIR[cell.terrain] !== undefined;
        const sink = isWater ? 0.12 : 0;
        const topY = pos.y - sink;
        const capBottom = isRamp ? topY : topY - CAP_H;

        // Cliff column
        const colH = Math.round((capBottom + BASE_THICKNESS) * 1000) / 1000;
        const column = new THREE.Mesh(this.columnGeometry(colH, colGeos), m.cliff);
        column.position.y = capBottom - colH / 2;
        column.receiveShadow = true;
        column.castShadow = true;
        col.add(column);

        // Jagged rock underside: longest under the middle of the island
        const centre = Math.hypot(x - (level.width - 1) / 2, y - (level.height - 1) / 2);
        const stalH = 0.35 + (1 - centre / maxDist) * 1.25 + hash2(x * 3.1, y * 1.7) * 0.5;
        const stal = new THREE.Mesh(stalGeo, m.rock);
        stal.scale.y = stalH;
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
          if (cell.terrain === TERRAIN.SAND) { topMat = m.sand; rimMat = m.rimSand; }
          else if (cell.terrain === TERRAIN.ICE) { topMat = m.ice; rimMat = m.rimIce; }
          else if (cell.terrain === TERRAIN.MUD) { topMat = m.mud; rimMat = m.rimMud; }
          else if (isWater) { topMat = m.water; rimMat = m.rimWater; }
          else if (isConv) { topMat = m.conveyor; rimMat = m.rimConv; }

          const cap = new THREE.Mesh(this.geo.cap, [rimMat, rimMat, topMat, rimMat, rimMat, rimMat]);
          cap.position.y = topY - CAP_H / 2;
          cap.receiveShadow = true;
          if (isConv) {
            // Texture chevrons point -Z (N); spin the cap so they point along the belt.
            cap.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][CONV_DIR[cell.terrain]];
          }
          col.add(cap);
        }

        // Props
        if (cell.terrain === TERRAIN.WALL) {
          const wall = new THREE.Mesh(wallGeo, m.wall);
          wall.position.y = pos.y + 0.28;
          wall.castShadow = true;
          wall.receiveShadow = true;
          col.add(wall);
        }

        if (cell.terrain === TERRAIN.SPRING) {
          const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 20)), m.springBase);
          base.position.y = pos.y + 0.04;
          col.add(base);
          const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.22, 0.045, 10, 24).rotateX(Math.PI / 2)), m.springRing);
          ring.position.y = pos.y + 0.12;
          ring.userData.baseY = pos.y + 0.12;
          ring.userData.phase = x * 1.3 + y * 0.7;
          col.add(ring);
          this.springRings.push(ring);
        }

        if (cell.terrain === TERRAIN.PORTAL_A || cell.terrain === TERRAIN.PORTAL_B) {
          const isA = cell.terrain === TERRAIN.PORTAL_A;
          const pm = isA ? m.portalA : m.portalB;
          const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.3, 0.05, 12, 28).rotateX(Math.PI / 2)), pm.ring);
          ring.position.y = pos.y + 0.08;
          col.add(ring);
          this.portalRings.push(ring);

          const disc = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.29, 24).rotateX(-Math.PI / 2)), pm.disc);
          disc.position.y = pos.y + 0.035;
          disc.userData.spin = isA ? 1 : -1;
          col.add(disc);
          this.portalDiscs.push(disc);

          const beam = new THREE.Mesh(this.geo.beam, isA ? m.beamA : m.beamB);
          beam.scale.set(1.35, 1.1, 1.35);
          beam.position.y = pos.y + 0.04;
          beam.userData.phase = isA ? 0 : 2;
          col.add(beam);
          this.beams.push(beam);
        }

        if (cell.terrain === TERRAIN.CUP) {
          const hole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24)), m.cupHole);
          hole.position.y = pos.y + 0.005;
          col.add(hole);

          const rimMesh = new THREE.Mesh(this.track(new THREE.RingGeometry(0.21, 0.27, 28).rotateX(-Math.PI / 2)), m.cupRim);
          rimMesh.position.y = pos.y + 0.026;
          col.add(rimMesh);

          const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.022, 0.022, 1.15, 10)), m.pole);
          pole.position.set(0.04, pos.y + 0.58, -0.04);
          pole.castShadow = true;
          col.add(pole);

          const flagShape = new THREE.Shape();
          flagShape.moveTo(0, 0);
          flagShape.lineTo(0.44, -0.12);
          flagShape.lineTo(0, -0.26);
          flagShape.closePath();
          this.flagCloth = new THREE.Mesh(this.track(new THREE.ShapeGeometry(flagShape)), m.flag);
          this.flagCloth.position.set(0.04, pos.y + 1.14, -0.04);
          col.add(this.flagCloth);

          const beam = new THREE.Mesh(this.geo.beam, m.beamCup);
          beam.scale.set(1.15, 2.1, 1.15);
          beam.position.y = pos.y + 0.03;
          beam.userData.phase = 1;
          col.add(beam);
          this.beams.push(beam);
        }
      }
    }

    this.maxElev = maxElev;
    this.introT = intro && !this.reducedMotion ? 0 : Infinity;
    if (this.introT === 0) {
      for (const col of this.columns) col.visible = false;
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

      const color = isRec ? NEON.amber : sim.won ? NEON.amber : isBad ? NEON.red : isIdle ? NEON.idle : NEON.green;

      const arrow = new THREE.Group();
      const chevMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isIdle ? 0.3 : isRec ? 1.8 : 1.15,
        roughness: 0.3,
      });
      const chev = new THREE.Mesh(this.geo.chevron, chevMat);
      chev.userData.ownMaterial = true;
      chev.position.z = 0.6;
      if (isRec) chev.scale.setScalar(1.25);
      arrow.add(chev);
      arrow.userData.chev = chev;

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
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isRec ? 0.95 : 0.6, depthWrite: false }),
          pts.length
        );
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
        const ring = new THREE.Mesh(
          this.geo.ring,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: isRec || sim.won ? 1 : 0.8,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        ring.position.set(ep.x, ep.y + 0.04, ep.z);
        ring.userData.phase = d.id * 0.9;
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
      mat = new THREE.MeshBasicMaterial({ color: colorHex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
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
    const colors = [NEON.magenta, NEON.amber, NEON.green, NEON.cyan, NEON.violet, 0xffffff];
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
    const up = half * CAM_ELEV_SIN + (maxElev * ELEV_STEP + 1.3) * CAM_ELEV_COS;
    const down = half * CAM_ELEV_SIN + (BASE_THICKNESS + 0.9) * CAM_ELEV_COS;

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

    // Backdrop: horizon through the middle of the free region, sun rising behind the peak.
    const u = this.backdropUniforms;
    u.uRes.value.set(w * pr, h * pr);
    u.uScale.value = pr;
    const freeCy = ins.bottom + freeH / 2; // CSS px from the bottom
    const freeCx = ins.left + freeW / 2;
    const horizon = freeCy - freeH * 0.04;
    const sunR = Math.min(freeW, freeH * 0.8) * 0.3;
    u.uHorizon.value = horizon / h;
    u.uSun.value.set(freeCx * pr, (horizon + sunR * 0.72) * pr);
    u.uSunR.value = sunR * pr;
    this.moteMat.size = 5 * pr;
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

    // Scrolling water, belts, portals, flag, beacons
    if (this.mats && !this.reducedMotion) {
      const wOff = elapsed * 0.09;
      this.mats.water.map.offset.set(wOff, wOff * 0.6);
      this.mats.water.emissiveMap.offset.set(wOff, wOff * 0.6);
      const cOff = (elapsed * 0.9) % 1;
      this.mats.conveyor.map.offset.y = -cOff;
      this.mats.conveyor.emissiveMap.offset.y = -cOff;
    }
    for (const pr of this.portalRings) {
      pr.scale.setScalar(1 + Math.sin(elapsed * 3.2) * 0.05);
    }
    for (const pd of this.portalDiscs) {
      pd.rotation.y = elapsed * 2.4 * pd.userData.spin;
    }
    for (const sr of this.springRings) {
      sr.position.y = sr.userData.baseY + Math.abs(Math.sin(elapsed * 2.6 + sr.userData.phase)) * 0.07;
    }
    for (const b of this.beams) {
      b.material.opacity = 0.34 + 0.16 * Math.sin(elapsed * 2.1 + b.userData.phase);
      b.rotation.y = elapsed * 0.4;
    }
    if (this.flagCloth) {
      this.flagCloth.rotation.y = Math.sin(elapsed * 4.5) * 0.2;
    }

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
      if (chev) chev.position.z = 0.6 + (Math.sin(elapsed * 5.2 + child.userData.dirId) * 0.5 + 0.5) * 0.09;
    }
    for (const ring of this.previewRings) {
      ring.scale.setScalar(1 + (Math.sin(elapsed * 4.2 + ring.userData.phase) * 0.5 + 0.5) * 0.22);
    }

    // Shot animation
    if (this.animQueue) {
      this.stepAnimation(dt);
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

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
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
        this.spawnParticles(p0, NEON.magenta, 10, 2.0);
        this.spawnParticles(p1, NEON.cyan, 12, 2.2);
        if (q.onEvent) q.onEvent('portal');
      }
    } else if (seg.type === 'sink') {
      // Drop into the cup
      const e = u * u;
      this.ballGroup.position.set(p1.x, p1.y + BALL_R - e * 0.3, p1.z);
      this.ballGroup.scale.setScalar(1 - e * 0.45);
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
        this.spawnParticles(p0, NEON.amber, 8, 1.8);
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
          this.spawnParticles(this.ballGroup.position, res.hazard === 'water' ? NEON.cyan : NEON.violet, 18, 2.6);
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
            this.spawnParticles(this.ballGroup.position, 0xffcf66, 12, 1.8);
            if (q.onEvent) q.onEvent('sand');
          }
          this.placeBallImmediate(res.endPos.x, res.endPos.y, endTile.elev);
        }
        if (done) done();
      }
    }
  }
}
