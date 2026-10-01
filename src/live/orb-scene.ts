/**
 * The holographic orb — a port of the open-source ULTRON orb UI
 * (https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds, MIT).
 *
 * Layered wireframe shells, a spiral geodesic core, drifting code-text
 * sprites, orbiting debris, dust, sweeping scan rings, and a bloom +
 * chromatic-aberration post stack.
 *
 * Adapted from the original in three ways, all of which matter here:
 *
 *  • It is driven by the live conversation. The original is a standalone
 *    scene; ours is a face for an assistant, so `setEnergy` and `setMood`
 *    let it react to the mic while listening and to the reply while
 *    speaking. An orb that looks identical whether you are talking or it is
 *    talking back is a screensaver, not an interface.
 *  • Element counts scale to the device. The original always builds ~1,700
 *    individually-canvased text sprites plus 2,000 dust points, which is
 *    fine on a desktop GPU and a slideshow on a phone.
 *  • It accepts an existing camera stream. See hand-tracker.ts.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { Mood } from "@/lib/voice-mood";

export interface OrbSceneApi {
  /** Rotate the camera around the orb (radians). */
  rotateBy(deltaTheta: number, deltaPhi: number): void;
  /** Multiply camera distance: <1 zooms in, >1 zooms out. */
  zoomBy(factor: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  /** 0..1 — mic level while listening, speech level while replying. */
  setEnergy(level: number): void;
  /** Shifts the palette so the orb reflects how the user sounded. */
  setMood(mood: Mood | null): void;
  dispose(): void;
}

const HOME_POSITION = new THREE.Vector3(0, 0.5, 5.5);
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 40;

const C_BRIGHT = 0xffaa30;
const C_MID = 0xdd7700;
const C_DIM = 0x884400;
const C_FAINT = 0x553300;
const C_HOT = 0xffcc66;

/**
 * Palettes per mood.
 *
 * Shifted rather than swapped outright: the orb should still read as the same
 * object, just warmer or cooler, or it flickers between identities as the
 * coarse mood estimate moves around.
 */
const MOOD_TINTS: Record<Mood, { core: number; glow: number }> = {
  stressed: { core: 0x3f7fd0, glow: 0x1d3f6b },
  animated: { core: 0xff7a2e, glow: 0xff3300 },
  tired: { core: 0x7a6a52, glow: 0x2e2a20 },
  calm: { core: C_HOT, glow: C_MID },
};

interface SpriteDrift {
  phi: number;
  theta: number;
  r: number;
  speed: number;
}

interface DebrisOrbit {
  orbitR: number;
  speed: number;
  tiltX: number;
  tiltZ: number;
  phase: number;
}

const CODE_SNIPPETS = [
  "sys.init()", "0xFF3A", "malloc()", ">> SCAN", "void*", "ACK",
  "SYNC OK", "ptr_ref", "exec()", "hash256", "::bind", "core.0",
  "01101001", "10110100", ">>> RDY", "HEAP 4K", "TCP/SYN",
  "mutex.lk", "IRQ 0x7", "DMA xfer", "REG EAX", "FAULT 0",
  "kernel.d", "pipe |>", "chmod +x", "fork()", "SIGTERM",
  "eth0: UP", "AES-256", "RSA 4096", "TLS 1.3", "HTTP/2",
  "latency", "200 OK", "PATCH /", "fn main", "use std",
  "impl Orb", "async {}", "spawn()", "arc::new", ".unwrap",
];

/** Element budgets, halved on constrained devices. */
function budgets() {
  const lean =
    typeof navigator !== "undefined" &&
    (navigator.hardwareConcurrency ?? 8) <= 4;
  const scale = lean ? 0.4 : 1;
  return {
    textOuter: Math.round(1200 * scale),
    textInner: Math.round(100 * scale),
    textAmbient: Math.round(400 * scale),
    debris: Math.round(250 * scale),
    dust: Math.round(2000 * scale),
    panels: Math.round(30 * scale),
    shellArcs: Math.round(16 * scale),
  };
}

export function createOrbScene(container: HTMLElement): OrbSceneApi {
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const B = budgets();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
  camera.position.copy(HOME_POSITION);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  container.appendChild(renderer.domElement);

  // --- Post processing -------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.8,
    0.4,
    0.2,
  );
  composer.addPass(bloom);

  const chromaticPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uIntensity: { value: 0.003 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - vec2(0.5);
        float d = length(dir);
        float offset = uIntensity * d;
        float flicker = 1.0 + 0.02 * sin(uTime * 30.0) * sin(uTime * 7.3);
        vec4 cr = texture2D(tDiffuse, vUv + dir * offset);
        vec4 cg = texture2D(tDiffuse, vUv);
        vec4 cb = texture2D(tDiffuse, vUv - dir * offset * 0.5);
        gl_FragColor = vec4(cr.r, cg.g * 1.05, cb.b * 0.6, 1.0) * flicker;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.15, 0.85, 0.55), 0.3);
      }
    `,
  });
  composer.addPass(chromaticPass);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.zoomSpeed = 1.4;
  controls.enablePan = false;

  // --- Geometry helpers ------------------------------------------------
  const lineMat = (color: number, opacity = 1) =>
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

  const latRing = (radius: number, lat: number, segs = 120) => {
    const r = radius * Math.cos(lat);
    const y = radius * Math.sin(lat);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  };

  const meridian = (radius: number, lon: number, segs = 120) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const lat = (i / segs) * Math.PI - Math.PI / 2;
      pts.push(
        new THREE.Vector3(
          radius * Math.cos(lat) * Math.cos(lon),
          radius * Math.sin(lat),
          radius * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  };

  const orbGroup = new THREE.Group();
  scene.add(orbGroup);

  const R1 = 2.0;
  const R2 = 2.12;
  const R3 = 0.9;

  // --- Layer 1: outer wireframe shell ---------------------------------
  const outerShell = new THREE.Group();
  for (let i = -15; i <= 15; i++) {
    const lat = (i / 15) * (Math.PI / 2) * 0.95;
    outerShell.add(
      new THREE.Line(
        latRing(R1, lat),
        lineMat(i % 3 === 0 ? C_MID : C_FAINT, i % 3 === 0 ? 0.5 : 0.12),
      ),
    );
  }
  for (let i = 0; i < 24; i++) {
    const lon = (i / 24) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    outerShell.add(
      new THREE.Line(
        meridian(R1, lon),
        lineMat(isMajor ? C_MID : C_FAINT, isMajor ? 0.6 : 0.1),
      ),
    );
  }
  // Four bright cross meridians, faded toward their edges.
  for (let i = 0; i < 4; i++) {
    const lon = (i / 4) * Math.PI * 2;
    for (let j = 0; j < 18; j++) {
      const t = (j / 17) * 2 - 1;
      const falloff = 1 - Math.abs(t) * 0.7;
      outerShell.add(
        new THREE.Line(
          meridian(R1, lon + (t * 0.25) / 2, 200),
          lineMat(
            Math.abs(t) < 0.3 ? C_BRIGHT : C_MID,
            0.85 * falloff,
          ),
        ),
      );
    }
  }
  // Bright equator band.
  for (let j = 0; j < 20; j++) {
    const t = (j / 19) * 2 - 1;
    const falloff = 1 - Math.abs(t) * 0.65;
    outerShell.add(
      new THREE.Line(
        latRing(R1, (t * 0.35) / 2, 200),
        lineMat(Math.abs(t) < 0.3 ? C_BRIGHT : C_MID, 0.8 * falloff),
      ),
    );
  }
  orbGroup.add(outerShell);

  // --- Layer 2: scattered grid panels ---------------------------------
  const panelGroup = new THREE.Group();
  const createPanel = (
    latC: number,
    lonC: number,
    span: number,
    radius: number,
    divisions: number,
  ) => {
    const g = new THREE.Group();
    const mat = lineMat(C_DIM, 0.25);
    for (let i = 0; i <= divisions; i++) {
      const lat = latC - span / 2 + (i / divisions) * span;
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= divisions * 4; j++) {
        const lon = lonC - span / 2 + (j / (divisions * 4)) * span;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    for (let j = 0; j <= divisions; j++) {
      const lon = lonC - span / 2 + (j / divisions) * span;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= divisions * 4; i++) {
        const lat = latC - span / 2 + (i / (divisions * 4)) * span;
        pts.push(
          new THREE.Vector3(
            radius * Math.cos(lat) * Math.cos(lon),
            radius * Math.sin(lat),
            radius * Math.cos(lat) * Math.sin(lon),
          ),
        );
      }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    return g;
  };
  for (let i = 0; i < B.panels; i++) {
    const size = 0.15 + Math.random() * 0.25;
    panelGroup.add(
      createPanel(
        (Math.random() - 0.5) * Math.PI * 0.8,
        Math.random() * Math.PI * 2,
        size,
        R1 + 0.01,
        3 + Math.floor(Math.random() * 3),
      ),
    );
  }
  orbGroup.add(panelGroup);

  // --- Layer 3: secondary shell, partial arcs -------------------------
  const shell2 = new THREE.Group();
  for (let i = 0; i < B.shellArcs; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.85;
    const startLon = Math.random() * Math.PI * 2;
    const arcLen = 0.3 + Math.random() * 1.2;
    const r = R2 * Math.cos(lat);
    const y = R2 * Math.sin(lat);
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 60; j++) {
      const a = startLon + (j / 60) * arcLen;
      pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_MID, 0.2 + Math.random() * 0.3),
      ),
    );
  }
  for (let i = 0; i < Math.round(12 * (B.panels / 30)); i++) {
    const lon = Math.random() * Math.PI * 2;
    const startLat = (Math.random() - 0.5) * Math.PI * 0.8;
    const arcLen = 0.3 + Math.random() * 0.8;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 40; j++) {
      const lat = startLat + (j / 40) * arcLen;
      pts.push(
        new THREE.Vector3(
          R2 * Math.cos(lat) * Math.cos(lon),
          R2 * Math.sin(lat),
          R2 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    shell2.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_DIM, 0.15 + Math.random() * 0.2),
      ),
    );
  }
  orbGroup.add(shell2);

  // --- Layer 4: spiral geodesic core ----------------------------------
  const innerCore = new THREE.Group();
  for (let s = 0; s < 8; s++) {
    const pts: THREE.Vector3[] = [];
    const turns = 3 + Math.random() * 2;
    const phase = (s / 8) * Math.PI * 2;
    for (let i = 0; i <= 300; i++) {
      const t = i / 300;
      const lat = t * Math.PI - Math.PI / 2;
      const lon = t * turns * Math.PI * 2 + phase;
      pts.push(
        new THREE.Vector3(
          R3 * Math.cos(lat) * Math.cos(lon),
          R3 * Math.sin(lat),
          R3 * Math.cos(lat) * Math.sin(lon),
        ),
      );
    }
    innerCore.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lineMat(C_BRIGHT, 0.3 + Math.random() * 0.2),
      ),
    );
  }
  for (let i = -6; i <= 6; i++) {
    innerCore.add(
      new THREE.Line(latRing(R3, (i / 6) * (Math.PI / 2) * 0.9, 80), lineMat(C_DIM, 0.2)),
    );
  }
  for (let i = 0; i < 12; i++) {
    innerCore.add(
      new THREE.Line(meridian(R3, (i / 12) * Math.PI * 2, 80), lineMat(C_DIM, 0.15)),
    );
  }
  orbGroup.add(innerCore);

  // --- Layer 5: hot innermost core ------------------------------------
  const icoGeo = new THREE.IcosahedronGeometry(0.25, 1);
  const icoWireMat = lineMat(C_HOT, 0.9);
  const icoWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(icoGeo),
    icoWireMat,
  );
  orbGroup.add(icoWire);

  const coreSphereMat = new THREE.MeshBasicMaterial({
    color: C_HOT,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
  });
  const coreSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    coreSphereMat,
  );
  orbGroup.add(coreSphere);

  const glowSphereMat = new THREE.MeshBasicMaterial({
    color: C_MID,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
  });
  const glowSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    glowSphereMat,
  );
  orbGroup.add(glowSphere);

  // --- Drifting code text ----------------------------------------------
  const makeTextSprite = (text: string, size: number) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.font = "bold 14px Courier New";
    const alpha = 0.35 + Math.random() * 0.55;
    ctx.fillStyle = `rgba(255, ${(130 + Math.random() * 80) | 0}, ${(20 + Math.random() * 30) | 0}, ${alpha})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.scale.set(size * 5, size * 0.7, 1);
    return s;
  };

  const scatterText = (
    count: number,
    sizeFn: () => number,
    rFn: () => number,
    speed: [number, number],
  ) => {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const sp = makeTextSprite(
        CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)],
        sizeFn(),
      );
      if (!sp) continue;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = rFn();
      sp.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
      sp.userData = {
        phi,
        theta,
        r,
        speed: (speed[0] + Math.random() * speed[1]) * (Math.random() > 0.5 ? 1 : -1),
      } satisfies SpriteDrift;
      group.add(sp);
    }
    return group;
  };

  const textOuter = scatterText(
    B.textOuter,
    () => 0.04 + Math.random() * 0.04,
    () => R1 + 0.03 + Math.random() * 0.08,
    [0.0002, 0.0008],
  );
  orbGroup.add(textOuter);
  const textInner = scatterText(
    B.textInner,
    () => 0.03 + Math.random() * 0.03,
    () => R3 + 0.02,
    [0.0005, 0.001],
  );
  orbGroup.add(textInner);
  const textAmbient = scatterText(
    B.textAmbient,
    () => 0.03,
    () => R3 + 0.2 + Math.random() * (R1 - R3 - 0.3),
    [0.0003, 0.0006],
  );
  orbGroup.add(textAmbient);

  // --- Orbiting debris --------------------------------------------------
  const debrisGeos = [
    new THREE.IcosahedronGeometry(0.012, 0),
    new THREE.IcosahedronGeometry(0.02, 0),
    new THREE.IcosahedronGeometry(0.03, 1),
    new THREE.IcosahedronGeometry(0.008, 0),
    new THREE.TetrahedronGeometry(0.015, 0),
    new THREE.OctahedronGeometry(0.018, 0),
  ];
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < B.debris; i++) {
    const mesh = new THREE.Mesh(
      debrisGeos[Math.floor(Math.random() * debrisGeos.length)],
      new THREE.MeshBasicMaterial({
        color: Math.random() > 0.7 ? C_BRIGHT : C_MID,
        transparent: true,
        opacity: 0.3 + Math.random() * 0.6,
        blending: THREE.AdditiveBlending,
      }),
    );
    const orbitR = 1.2 + Math.random() * 4.0;
    mesh.userData = {
      orbitR,
      speed: (0.08 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1),
      tiltX: (Math.random() - 0.5) * Math.PI * 0.9,
      tiltZ: (Math.random() - 0.5) * Math.PI * 0.5,
      phase: Math.random() * Math.PI * 2,
    } satisfies DebrisOrbit;
    debris.push(mesh);
    orbGroup.add(mesh);
  }

  // --- Dust -------------------------------------------------------------
  const dustPos = new Float32Array(B.dust * 3);
  for (let i = 0; i < B.dust; i++) {
    const rr = 0.5 + Math.pow(Math.random(), 0.6) * 7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    dustPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
    dustPos[i * 3 + 1] = rr * Math.cos(phi);
    dustPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dustPos, 3));

  const dotC = document.createElement("canvas");
  dotC.width = dotC.height = 64;
  const dCtx = dotC.getContext("2d");
  if (dCtx) {
    const grad = dCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,170,48,1)");
    grad.addColorStop(0.2, "rgba(255,120,20,0.6)");
    grad.addColorStop(0.5, "rgba(200,80,0,0.15)");
    grad.addColorStop(1, "rgba(100,40,0,0)");
    dCtx.fillStyle = grad;
    dCtx.fillRect(0, 0, 64, 64);
  }
  const dustPoints = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      map: dCtx ? new THREE.CanvasTexture(dotC) : undefined,
      size: 0.04,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      color: C_BRIGHT,
    }),
  );
  orbGroup.add(dustPoints);

  // --- Sweeping scan rings ----------------------------------------------
  const makeScanRing = (radius: number, thickness: number) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius - thickness, radius + thickness, 120),
      new THREE.MeshBasicMaterial({
        color: C_BRIGHT,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  const scanRing1 = makeScanRing(R1, 0.01);
  const scanRing2 = makeScanRing(R3 * 0.7, 0.008);
  orbGroup.add(scanRing1, scanRing2);

  // --- Hexagonal nodes --------------------------------------------------
  for (let i = 0; i < 15; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const hex = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.CircleGeometry(0.03 + Math.random() * 0.02, 6),
      ),
      lineMat(C_MID, 0.5),
    );
    hex.position.set(
      (R1 + 0.02) * Math.sin(phi) * Math.cos(theta),
      (R1 + 0.02) * Math.cos(phi),
      (R1 + 0.02) * Math.sin(phi) * Math.sin(theta),
    );
    hex.lookAt(0, 0, 0);
    outerShell.add(hex);
  }

  // --- Camera control ---------------------------------------------------
  const sphericalScratch = new THREE.Spherical();
  const offsetScratch = new THREE.Vector3();

  const rotateBy = (deltaTheta: number, deltaPhi: number) => {
    offsetScratch.copy(camera.position).sub(controls.target);
    sphericalScratch.setFromVector3(offsetScratch);
    sphericalScratch.theta -= deltaTheta;
    sphericalScratch.phi = THREE.MathUtils.clamp(
      sphericalScratch.phi - deltaPhi,
      0.05,
      Math.PI - 0.05,
    );
    sphericalScratch.makeSafe();
    offsetScratch.setFromSpherical(sphericalScratch);
    camera.position.copy(controls.target).add(offsetScratch);
    camera.lookAt(controls.target);
  };

  const zoomBy = (factor: number) => {
    offsetScratch.copy(camera.position).sub(controls.target);
    const dist = THREE.MathUtils.clamp(
      offsetScratch.length() * factor,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    offsetScratch.setLength(dist);
    camera.position.copy(controls.target).add(offsetScratch);
  };

  const resetView = () => {
    camera.position.copy(HOME_POSITION);
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
  };

  // --- Live conversation reactivity -------------------------------------
  // Smoothed so a single loud frame does not strobe the whole orb.
  let energy = 0;
  let targetEnergy = 0;
  const tintTarget = new THREE.Color(C_HOT);
  const tintNow = new THREE.Color(C_HOT);

  const setEnergy = (level: number) => {
    targetEnergy = Math.max(0, Math.min(1, level));
  };

  const setMood = (mood: Mood | null) => {
    const tint = MOOD_TINTS[mood ?? "calm"];
    tintTarget.setHex(tint.core);
    glowSphereMat.color.setHex(tint.glow);
  };

  // --- Animation --------------------------------------------------------
  const clock = new THREE.Clock();
  let rafId = 0;
  let disposed = false;
  const driftGroups: [THREE.Group, number][] = [
    [textOuter, 1],
    [textInner, 2],
    [textAmbient, 1.2],
  ];

  const animate = () => {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    energy += (targetEnergy - energy) * 0.12;
    tintNow.lerp(tintTarget, 0.03);

    outerShell.rotation.y += 0.0015;
    outerShell.rotation.x = Math.sin(t * 0.08) * 0.05;
    panelGroup.rotation.y += 0.0018;
    panelGroup.rotation.x = Math.sin(t * 0.08 + 0.5) * 0.04;
    shell2.rotation.y -= 0.001;
    shell2.rotation.z = Math.sin(t * 0.12) * 0.03;
    innerCore.rotation.y -= 0.005;
    innerCore.rotation.z += 0.002;
    innerCore.rotation.x = Math.cos(t * 0.1) * 0.08;
    icoWire.rotation.x += 0.008;
    icoWire.rotation.y += 0.012;

    // Core surge: a slow idle pulse, plus rare bigger spikes, all lifted by
    // how loud the conversation currently is.
    const wave1 = Math.sin(t * 1.2);
    const wave3 = Math.pow(Math.max(0, Math.sin(t * 0.4)), 5);
    const wave4 = Math.pow(Math.max(0, Math.sin(t * 0.7 + 2)), 8);
    const fadeOut = Math.pow(Math.max(0, Math.sin(t * 0.25)), 3);
    const surge = wave3 * 1.5 + wave4 * 2.0 + energy * 1.6;
    coreSphere.scale.setScalar(1 + surge + Math.sin(t * 5) * 0.05);
    coreSphereMat.color.copy(tintNow);
    coreSphereMat.opacity = Math.min(
      0.75,
      Math.max(
        0,
        (0.08 + wave1 * 0.05 + surge * 0.2 + energy * 0.3) * (1 - fadeOut * 0.95),
      ),
    );
    glowSphere.scale.setScalar(1 + surge * 0.8);
    glowSphereMat.opacity = Math.max(
      0,
      (0.03 + surge * 0.08 + energy * 0.1) * (1 - fadeOut * 0.9),
    );
    icoWire.scale.setScalar(1 + surge * 0.6);
    icoWireMat.color.copy(tintNow);
    icoWireMat.opacity = Math.min(1, 0.5 + surge * 0.4);

    for (const d of debris) {
      const u = d.userData as DebrisOrbit;
      const a = t * u.speed + u.phase;
      d.position.set(
        u.orbitR * Math.cos(a) * Math.cos(u.tiltX),
        u.orbitR * Math.sin(u.tiltX) * Math.sin(a * 0.8) +
          Math.sin(a * 0.3 + u.tiltZ) * 0.2,
        u.orbitR * Math.sin(a) * Math.cos(u.tiltZ),
      );
      d.rotation.x += 0.015;
      d.rotation.z += 0.01;
    }

    for (const [group, mult] of driftGroups) {
      group.children.forEach((sp) => {
        const u = sp.userData as SpriteDrift;
        u.theta += u.speed * mult;
        sp.position.set(
          u.r * Math.sin(u.phi) * Math.cos(u.theta),
          u.r * Math.cos(u.phi),
          u.r * Math.sin(u.phi) * Math.sin(u.theta),
        );
      });
    }

    const scanY1 = Math.sin(t * 0.4) * R1;
    scanRing1.position.y = scanY1;
    const scanS1 = Math.sqrt(Math.max(0, R1 * R1 - scanY1 * scanY1)) / R1;
    scanRing1.scale.set(scanS1, scanS1, 1);
    (scanRing1.material as THREE.MeshBasicMaterial).opacity = 0.2 * scanS1;
    const scanY2 = Math.sin(t * 0.6 + 2) * R3;
    scanRing2.position.y = scanY2;
    const scanS2 = Math.sqrt(Math.max(0, R3 * R3 - scanY2 * scanY2)) / R3;
    scanRing2.scale.set(scanS2, scanS2, 1);
    (scanRing2.material as THREE.MeshBasicMaterial).opacity = 0.15 * scanS2;

    dustPoints.rotation.y += 0.0002;

    // Energy also drives the bloom, so the whole frame brightens when you
    // speak rather than only the core.
    bloom.strength = 1.6 + Math.sin(t * 0.8) * 0.3 + energy * 1.1;
    chromaticPass.uniforms.uTime.value = t;
    // More separation while talking, calmer at rest.
    chromaticPass.uniforms.uIntensity.value = 0.002 + energy * 0.004;

    controls.update();
    composer.render();
  };
  animate();

  const onResize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  window.addEventListener("resize", onResize);

  const dispose = () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    controls.dispose();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const withMap = mat as THREE.Material & { map?: THREE.Texture };
        withMap.map?.dispose();
        mat.dispose();
      }
    });
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return {
    rotateBy,
    zoomBy,
    zoomIn: () => zoomBy(0.65),
    zoomOut: () => zoomBy(1.55),
    resetView,
    setEnergy,
    setMood,
    dispose,
  };
}
