// Life of Golf — Three.js 0.180 Isometric 3D Diorama Renderer

import * as THREE from 'three';
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

const THEMES = {
  light: {
    bgTop: '#dbeeff',
    bgBottom: '#f7f1e3',
    fog: 0xeaf4fc,
    hemiSky: 0xfff8eb,
    hemiGround: 0x6b8e78,
    hemiInt: 1.35,
    sunColor: 0xfff6e5,
    sunInt: 2.0,
    earthSide: 0xc2956e,
    rockBase: 0x7c8694,
    grassA: '#68b86b',
    grassB: '#5ca960',
  },
  dark: {
    bgTop: '#11192a',
    bgBottom: '#1f2d42',
    fog: 0x162134,
    hemiSky: 0x9bbcff,
    hemiGround: 0x263547,
    hemiInt: 1.15,
    sunColor: 0xdce9ff,
    sunInt: 1.75,
    earthSide: 0x6f5448,
    rockBase: 0x3b4454,
    grassA: '#3d8f5d',
    grassB: '#337d50',
  },
};

function makeCanvasTex(size, drawFn) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class GolfRenderer3D {
  constructor(canvas, { onDirectionPick, onSwipeDirection, theme = 'light' } = {}) {
    this.canvas = canvas;
    this.onDirectionPick = onDirectionPick;
    this.onSwipeDirection = onSwipeDirection;
    this.themeName = theme;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    // Orthographic isometric camera
    this.frustumSize = 10;
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.orbitIndex = 0; // 0..3 (90 deg increments around Y)
    this.orbitAngle = Math.PI / 4;
    this.targetOrbitAngle = Math.PI / 4;

    // Lights
    this.hemi = new THREE.HemisphereLight(0xfff8eb, 0x6b8e78, 1.35);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff6e5, 2.0);
    this.sun.position.set(9, 16, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -8;
    this.sun.shadow.camera.right = 8;
    this.sun.shadow.camera.top = 8;
    this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);

    this.fill = new THREE.DirectionalLight(0xaad4ff, 0.45);
    this.fill.position.set(-8, 6, -9);
    this.scene.add(this.fill);

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

    // Ball
    this.ballGroup = new THREE.Group();
    const ballGeo = new THREE.SphereGeometry(0.18, 24, 24);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.05,
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.ballGroup.add(this.ballMesh);

    // Subtle ground shadow ring under ball (helps read height during chips!)
    const shadowGeo = new THREE.CircleGeometry(0.17, 20);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
    this.ballShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.islandGroup.add(this.ballShadow);
    this.islandGroup.add(this.ballGroup);

    // Animated references
    this.waterMeshes = [];
    this.portalRings = [];
    this.flagCloth = null;
    this.arrowHitMeshes = [];
    this.particles = [];
    this.shake = 0;

    // Animation state
    this.level = null;
    this.ballPos = { x: 0, y: 0 };
    this.ballElev = 0;
    this.animQueue = null;
    this.animResolve = null;

    // Shared procedural textures
    this.textures = {};
    this.buildTextures();
    this.applyTheme(theme);

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

  buildTextures() {
    this.textures.sand = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#ebd08b';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(199,161,84,0.45)';
      ctx.lineWidth = 4;
      for (let y = 10; y < s; y += 16) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 16) {
          ctx.lineTo(x, y + Math.sin(x * 0.12) * 3);
        }
        ctx.stroke();
      }
    });

    this.textures.ice = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#9fe2f7';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(16, s - 20);
      ctx.lineTo(s - 20, 16);
      ctx.moveTo(48, s - 12);
      ctx.lineTo(s - 12, 48);
      ctx.stroke();
    });

    this.textures.mud = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#6c5340';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#584130';
      for (let i = 0; i < 24; i++) {
        const x = (i * 37) % s;
        const y = (i * 53) % s;
        ctx.beginPath();
        ctx.arc(x, y, 6 + (i % 5), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    this.textures.water = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#38a7cf';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 4;
      for (let y = 20; y < s; y += 30) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 16) {
          ctx.lineTo(x, y + Math.sin((x + y) * 0.08) * 4);
        }
        ctx.stroke();
      }
    });

    this.textures.conveyor = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#4e778c';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#9df3ff';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const yOff of [42, 90]) {
        ctx.beginPath();
        ctx.moveTo(28, yOff + 16);
        ctx.lineTo(s / 2, yOff - 14);
        ctx.lineTo(s - 28, yOff + 16);
        ctx.stroke();
      }
    });

    this.textures.ramp = makeCanvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#75c776';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (const yOff of [36, 72, 104]) {
        ctx.beginPath();
        ctx.moveTo(s / 2, yOff - 18);
        ctx.lineTo(s - 28, yOff + 6);
        ctx.lineTo(28, yOff + 6);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  applyTheme(themeName) {
    this.themeName = themeName === 'dark' ? 'dark' : 'light';
    const t = THEMES[this.themeName];
    this.scene.fog = new THREE.FogExp2(t.fog, 0.012);
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiInt;
    this.sun.color.setHex(t.sunColor);
    this.sun.intensity = t.sunInt;
    if (this.level) {
      this.loadLevel(this.level, this.ballPos);
    }
  }

  rotateCamera(delta = 1) {
    this.orbitIndex = (this.orbitIndex + delta + 4) % 4;
    this.targetOrbitAngle = Math.PI / 4 + this.orbitIndex * (Math.PI / 2);
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

  loadLevel(level, ballPos = level.start) {
    this.level = level;
    this.ballPos = { ...ballPos };
    const startTile = level.grid[ballPos.y][ballPos.x];
    this.ballElev = startTile.elev;

    // Clear previous meshes
    while (this.boardGroup.children.length) this.boardGroup.remove(this.boardGroup.children[0]);
    this.waterMeshes = [];
    this.portalRings = [];
    this.flagCloth = null;
    this.clearArrows();

    const t = THEMES[this.themeName];
    const sideMat = new THREE.MeshStandardMaterial({ color: t.earthSide, roughness: 0.9 });
    const baseMat = new THREE.MeshStandardMaterial({ color: t.rockBase, roughness: 0.95 });
    const grassMatA = new THREE.MeshStandardMaterial({ color: t.grassA, roughness: 0.8 });
    const grassMatB = new THREE.MeshStandardMaterial({ color: t.grassB, roughness: 0.8 });
    const sandMat = new THREE.MeshStandardMaterial({ map: this.textures.sand, roughness: 0.92 });
    const iceMat = new THREE.MeshStandardMaterial({ map: this.textures.ice, roughness: 0.15, metalness: 0.1 });
    const mudMat = new THREE.MeshStandardMaterial({ map: this.textures.mud, roughness: 0.98 });
    const waterMat = new THREE.MeshStandardMaterial({
      map: this.textures.water,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.9,
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: this.themeName === 'dark' ? 0x627084 : 0x9aa4ad, roughness: 0.85 });
    const hedgeMat = new THREE.MeshStandardMaterial({ color: this.themeName === 'dark' ? 0x2c6b47 : 0x3b8c4e, roughness: 0.85 });

    const s = TILE_SIZE - TILE_GAP;

    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const cell = level.grid[y][x];
        if (cell.terrain === TERRAIN.VOID) continue;

        const pos = this.gridToWorld(x, y, cell.elev);
        const totalH = BASE_THICKNESS + cell.elev * ELEV_STEP;

        // Floating island layered cliff column
        const rockH = 0.28;
        const earthH = totalH - rockH;

        const earthGeo = new THREE.BoxGeometry(s, earthH, s);
        const earthMesh = new THREE.Mesh(earthGeo, sideMat);
        earthMesh.position.set(pos.x, pos.y - earthH / 2 - 0.04, pos.z);
        earthMesh.receiveShadow = true;
        this.boardGroup.add(earthMesh);

        const rockGeo = new THREE.BoxGeometry(s * 0.92, rockH, s * 0.92);
        const rockMesh = new THREE.Mesh(rockGeo, baseMat);
        rockMesh.position.set(pos.x, pos.y - earthH - rockH / 2 - 0.04, pos.z);
        this.boardGroup.add(rockMesh);

        // Top surface cap
        const checker = (x + y) % 2 === 0;
        let topMat = checker ? grassMatA : grassMatB;
        let capH = 0.08;
        let capY = pos.y - capH / 2;

        if (cell.terrain === TERRAIN.SAND) topMat = sandMat;
        else if (cell.terrain === TERRAIN.ICE) topMat = iceMat;
        else if (cell.terrain === TERRAIN.MUD) topMat = mudMat;
        else if (cell.terrain === TERRAIN.WATER) {
          topMat = waterMat;
          capH = 0.05;
          capY = pos.y - 0.1;
        }

        if (RAMP_DIR[cell.terrain] !== undefined) {
          // True 3D sloped wedge!
          const wedge = this.createRampMesh(s, ELEV_STEP, RAMP_DIR[cell.terrain]);
          wedge.position.set(pos.x, pos.y, pos.z);
          this.boardGroup.add(wedge);
        } else if (CONV_DIR[cell.terrain] !== undefined) {
          const convTex = this.textures.conveyor.clone();
          convTex.needsUpdate = true;
          convTex.center.set(0.5, 0.5);
          // Rotate arrow texture to match direction (N=0, E=1, S=2, W=3)
          const rotMap = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
          convTex.rotation = rotMap[CONV_DIR[cell.terrain]];
          const convMat = new THREE.MeshStandardMaterial({ map: convTex, roughness: 0.4 });
          const cap = new THREE.Mesh(new THREE.BoxGeometry(s, capH, s), convMat);
          cap.position.set(pos.x, capY, pos.z);
          cap.receiveShadow = true;
          this.boardGroup.add(cap);
        } else {
          const cap = new THREE.Mesh(new THREE.BoxGeometry(s, capH, s), topMat);
          cap.position.set(pos.x, capY, pos.z);
          cap.receiveShadow = true;
          this.boardGroup.add(cap);
          if (cell.terrain === TERRAIN.WATER) {
            cap.userData.baseY = capY;
            cap.userData.phase = x * 0.7 + y * 1.1;
            this.waterMeshes.push(cap);
          }
        }

        // Special 3D props
        if (cell.terrain === TERRAIN.WALL) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(s * 0.86, 0.42, s * 0.86), wallMat);
          wall.position.set(pos.x, pos.y + 0.21, pos.z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.boardGroup.add(wall);

          const hedge = new THREE.Mesh(new THREE.BoxGeometry(s * 0.9, 0.14, s * 0.9), hedgeMat);
          hedge.position.set(pos.x, pos.y + 0.46, pos.z);
          hedge.castShadow = true;
          this.boardGroup.add(hedge);
        }

        if (cell.terrain === TERRAIN.SPRING) {
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.36, 0.08, 18),
            new THREE.MeshStandardMaterial({ color: 0xe85d4a, roughness: 0.35 })
          );
          base.position.set(pos.x, pos.y + 0.04, pos.z);
          this.boardGroup.add(base);
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.22, 0.04, 10, 20),
            new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.3 })
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.set(pos.x, pos.y + 0.1, pos.z);
          this.boardGroup.add(ring);
        }

        if (cell.terrain === TERRAIN.PORTAL_A || cell.terrain === TERRAIN.PORTAL_B) {
          const color = cell.terrain === TERRAIN.PORTAL_A ? 0xd946ef : 0x06b6d4;
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.28, 0.05, 12, 24),
            new THREE.MeshStandardMaterial({
              color,
              emissive: color,
              emissiveIntensity: 0.65,
              roughness: 0.2,
            })
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.set(pos.x, pos.y + 0.08, pos.z);
          this.boardGroup.add(ring);
          this.portalRings.push(ring);

          const disc = new THREE.Mesh(
            new THREE.CircleGeometry(0.24, 20),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
          );
          disc.rotation.x = -Math.PI / 2;
          disc.position.set(pos.x, pos.y + 0.03, pos.z);
          this.boardGroup.add(disc);
        }

        if (cell.terrain === TERRAIN.CUP) {
          // Dark cup hole
          const hole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24),
            new THREE.MeshBasicMaterial({ color: 0x1a1f24 })
          );
          hole.position.set(pos.x, pos.y + 0.005, pos.z);
          this.boardGroup.add(hole);

          // White cup rim
          const rim = new THREE.Mesh(
            new THREE.RingGeometry(0.21, 0.26, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
          );
          rim.rotation.x = -Math.PI / 2;
          rim.position.set(pos.x, pos.y + 0.026, pos.z);
          this.boardGroup.add(rim);

          // Flagpole
          const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.022, 1.15, 10),
            new THREE.MeshStandardMaterial({ color: 0xf4f4f6, roughness: 0.3 })
          );
          pole.position.set(pos.x + 0.04, pos.y + 0.58, pos.z - 0.04);
          pole.castShadow = true;
          this.boardGroup.add(pole);

          // Red pennant flag
          const flagShape = new THREE.Shape();
          flagShape.moveTo(0, 0);
          flagShape.lineTo(0.42, -0.11);
          flagShape.lineTo(0, -0.24);
          flagShape.closePath();
          const flagGeo = new THREE.ShapeGeometry(flagShape);
          const flagMat = new THREE.MeshStandardMaterial({
            color: 0xe63946,
            side: THREE.DoubleSide,
            roughness: 0.45,
          });
          this.flagCloth = new THREE.Mesh(flagGeo, flagMat);
          this.flagCloth.position.set(pos.x + 0.04, pos.y + 1.14, pos.z - 0.04);
          this.boardGroup.add(this.flagCloth);
        }
      }
    }

    this.placeBallImmediate(ballPos.x, ballPos.y, this.ballElev);
    this.fitCamera();
  }

  createRampMesh(s, h, dirId) {
    // Wedge sloping UP along -Z by default (N), then rotated to dirId
    const shape = new THREE.Shape();
    shape.moveTo(-s / 2, 0);
    shape.lineTo(s / 2, 0);
    shape.lineTo(s / 2, h);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: s, bevelEnabled: false });
    geo.translate(0, 0, -s / 2);
    // Align slope: shape climbs toward +X; rotateY so +X maps to desired dir
    // N=(0,-1 -> -Z): rotY = +PI/2; E=(+1,0 -> +X): rotY = 0; S=(0,+1 -> +Z): rotY = -PI/2; W=(-1,0 -> -X): rotY = PI
    const rotY = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][dirId];
    geo.rotateY(rotY);

    const mat = new THREE.MeshStandardMaterial({
      color: this.themeName === 'dark' ? 0x4ba66a : 0x79cc7a,
      roughness: 0.72,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  placeBallImmediate(gx, gy, elev) {
    this.ballPos = { x: gx, y: gy };
    this.ballElev = elev;
    const p = this.gridToWorld(gx, gy, elev);
    this.ballGroup.position.set(p.x, p.y + 0.18, p.z);
    this.ballGroup.scale.set(1, 1, 1);
    this.ballShadow.position.set(p.x, p.y + 0.015, p.z);
    this.ballShadow.scale.set(1, 1, 1);
  }

  clearArrows() {
    while (this.arrowGroup.children.length) this.arrowGroup.remove(this.arrowGroup.children[0]);
    while (this.previewGroup.children.length) this.previewGroup.remove(this.previewGroup.children[0]);
    this.arrowHitMeshes = [];
  }

  /**
   * Show 4 glowing 3D direction arrows around the ball + landing preview dots when a card is selected.
   */
  showDirections(card, recommendedDir = null) {
    this.clearArrows();
    if (!this.level || !card) return;

    const base = this.gridToWorld(this.ballPos.x, this.ballPos.y, this.ballElev);

    for (const d of DIRS) {
      const sim = simulateShot(this.level, this.ballPos, card, d.id);
      const isRec = recommendedDir === d.id;
      const isBad = sim.hazard || sim.stuckInSand;

      const color = isRec ? 0xf59e0b : isBad ? 0xef4444 : 0x10b981;

      // Arrow cone + stem
      const arrow = new THREE.Group();
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.34, 12),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: isRec ? 0.6 : 0.3,
          roughness: 0.25,
        })
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.z = 0.62;
      arrow.add(cone);

      // Generous invisible touch hit target for effortless mobile tapping!
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.5, 0.85),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hit.position.z = 0.62;
      hit.userData.dirId = d.id;
      arrow.add(hit);
      this.arrowHitMeshes.push(hit);

      // Rotate group to face direction d (N=-Z, E=+X, S=+Z, W=-X)
      const angle = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][d.id];
      arrow.rotation.y = angle;
      arrow.position.set(base.x, base.y + 0.24, base.z);
      arrow.userData.baseY = base.y + 0.24;
      arrow.userData.dirId = d.id;
      this.arrowGroup.add(arrow);

      // Subtle landing preview ring if non-hazard
      if (!sim.hazard && (sim.endPos.x !== this.ballPos.x || sim.endPos.y !== this.ballPos.y)) {
        const endElev = this.level.grid[sim.endPos.y][sim.endPos.x].elev;
        const ep = this.gridToWorld(sim.endPos.x, sim.endPos.y, endElev);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.18, 0.25, 20),
          new THREE.MeshBasicMaterial({
            color: sim.won ? 0xfbbf24 : color,
            transparent: true,
            opacity: isRec ? 0.85 : 0.45,
            side: THREE.DoubleSide,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(ep.x, ep.y + 0.03, ep.z);
        this.previewGroup.add(ring);
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
      this.animQueue = {
        segments: simResult.path,
        index: 0,
        t: 0,
        simResult,
        onEvent,
        firedEvents: new Set(),
      };
      this.animResolve = resolve;
    });
  }

  spawnParticles(worldPos, colorHex, count = 12, speed = 2.2) {
    const geo = new THREE.SphereGeometry(0.045, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(worldPos);
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * speed;
      m.userData = {
        vx: Math.cos(ang) * spd,
        vy: 1.4 + Math.random() * 2.2,
        vz: Math.sin(ang) * spd,
        life: 0.55 + Math.random() * 0.35,
        age: 0,
      };
      this.fxGroup.add(m);
      this.particles.push(m);
    }
  }

  spawnVictoryConfetti(gx, gy, elev) {
    const p = this.gridToWorld(gx, gy, elev);
    p.y += 0.3;
    const colors = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0xd946ef, 0xffffff];
    for (const c of colors) {
      this.spawnParticles(p, c, 6, 3.0);
    }
  }

  fitCamera() {
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const aspect = w / h;

    const boardSpan = this.level ? Math.max(this.level.width, this.level.height) : 6;
    // Extra breathing room on narrow portrait mobile so the whole diamond fits cleanly!
    const portraitBoost = aspect < 0.85 ? 1.28 / Math.max(0.55, aspect) : 1.05;
    this.frustumSize = Math.max(6.2, boardSpan * 1.48) * Math.min(2.15, portraitBoost);

    this.camera.left = (-this.frustumSize * aspect) / 2;
    this.camera.right = (this.frustumSize * aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
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

    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.dragStart) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const dist = Math.hypot(dx, dy);
      this.dragStart = null;

      // Tap / Click on a 3D arrow
      if (dist < 18) {
        if (this.arrowHitMeshes.length > 0 && this.onDirectionPick) {
          getNDC(e.clientX, e.clientY);
          this.raycaster.setFromCamera(this.pointer, this.camera);
          const hits = this.raycaster.intersectObjects(this.arrowHitMeshes, false);
          if (hits.length > 0) {
            this.onDirectionPick(hits[0].object.userData.dirId);
          }
        }
        return;
      }

      // Swipe gesture -> map screen swipe vector onto isometric world cardinal directions!
      if (dist >= 28 && this.onSwipeDirection) {
        const dirId = this.screenVectorToDir(dx, dy);
        if (dirId !== null) this.onSwipeDirection(dirId);
      }
    });
  }

  /**
   * Project screen-space swipe (dx, dy) against the 4 world cardinal directions
   * as seen by the current isometric camera!
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
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.getElapsedTime();

    // Smooth camera orbit
    this.orbitAngle = THREE.MathUtils.damp(this.orbitAngle, this.targetOrbitAngle, 8, dt);
    const radius = 16;
    const camY = 12.2;
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.25 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.25 : 0;
    this.shake = Math.max(0, this.shake - dt * 3.5);

    this.camera.position.set(
      Math.cos(this.orbitAngle) * radius + shakeX,
      camY + shakeY,
      Math.sin(this.orbitAngle) * radius
    );
    this.camera.lookAt(0, 0.2, 0);

    // Subtle floating island breath
    this.islandGroup.position.y = Math.sin(elapsed * 1.15) * 0.045;

    // Animated water & portals & flag
    for (const wm of this.waterMeshes) {
      wm.position.y = wm.userData.baseY + Math.sin(elapsed * 2.4 + wm.userData.phase) * 0.014;
    }
    for (const pr of this.portalRings) {
      pr.rotation.z = elapsed * 2.2;
    }
    if (this.flagCloth) {
      this.flagCloth.rotation.y = Math.sin(elapsed * 4.5) * 0.16;
    }

    // Pulse direction arrows
    for (const child of this.arrowGroup.children) {
      child.position.y = child.userData.baseY + Math.sin(elapsed * 5 + child.userData.dirId) * 0.04;
    }

    // Update shot animation
    if (this.animQueue) {
      this.stepAnimation(dt);
    }

    // Update particles
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
      const s = 1 - p.userData.age / p.userData.life;
      p.scale.setScalar(Math.max(0.01, s));
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
      this.ballGroup.position.set(x, baseY + 0.18 + arcY, z);
      this.ballShadow.position.set(x, baseY + 0.015, z);
      const shScale = Math.max(0.35, 1 - arcY * 0.4);
      this.ballShadow.scale.setScalar(shScale);
    } else if (seg.type === 'bounce' || seg.type === 'bump' || seg.type === 'bounce_arc') {
      const tri = u < 0.5 ? u * 2 : (1 - u) * 2;
      const x = THREE.MathUtils.lerp(p0.x, p1.x, tri);
      const z = THREE.MathUtils.lerp(p0.z, p1.z, tri);
      const arcY = seg.type === 'bounce_arc' ? Math.sin(u * Math.PI) * 0.55 : 0;
      this.ballGroup.position.set(x, p0.y + 0.18 + arcY, z);
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
      this.ballGroup.position.set(pos.x, pos.y + 0.18, pos.z);
      this.ballGroup.scale.setScalar(Math.max(0.05, scale));
      this.ballShadow.position.set(pos.x, pos.y + 0.015, pos.z);
      if (!half && !q.firedEvents.has(`tp-${q.index}`)) {
        q.firedEvents.add(`tp-${q.index}`);
        this.spawnParticles(p1, 0xd946ef, 12, 2.2);
        if (q.onEvent) q.onEvent('portal');
      }
    } else {
      const x = THREE.MathUtils.lerp(p0.x, p1.x, u);
      const z = THREE.MathUtils.lerp(p0.z, p1.z, u);
      const y = THREE.MathUtils.lerp(p0.y, p1.y, u);
      this.ballGroup.position.set(x, y + 0.18, z);
      this.ballShadow.position.set(x, y + 0.015, z);
      this.ballShadow.scale.setScalar(1);
    }

    if (q.t >= 1) {
      q.index++;
      q.t = 0;

      // Per-segment arrival feedback
      if (seg.type === 'spring' && q.onEvent) q.onEvent('spring');
      if (seg.type === 'slide' && !q.firedEvents.has('ice')) {
        q.firedEvents.add('ice');
        if (q.onEvent) q.onEvent('ice');
      }

      if (q.index >= q.segments.length) {
        const res = q.simResult;
        const endTile = this.level.grid[res.endPos.y][res.endPos.x];
        if (res.hazard === 'water' || res.hazard === 'void') {
          this.shake = 0.5;
          this.spawnParticles(this.ballGroup.position, 0x38bdf8, 16, 2.6);
          if (q.onEvent) q.onEvent('water');
        } else if (res.events.includes('sand_stop') || res.stuckInSand) {
          this.spawnParticles(this.ballGroup.position, 0xebd08b, 12, 1.8);
          if (q.onEvent) q.onEvent('sand');
        } else if (res.won) {
          this.spawnVictoryConfetti(res.endPos.x, res.endPos.y, endTile.elev);
          if (q.onEvent) q.onEvent('sink');
        }

        this.placeBallImmediate(res.endPos.x, res.endPos.y, endTile.elev);
        const done = this.animResolve;
        this.animQueue = null;
        this.animResolve = null;
        if (done) done();
      }
    }
  }
}
