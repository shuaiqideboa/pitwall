import * as THREE from 'three';
import { BLOCK_CENTERS } from '../game/track';
import { FILM_CHAPTERS, FILM_DURATION, FILM_HEIGHT, FILM_WIDTH, captionAt, chapterAt } from './script';

const INK = '#080b10';
const PAPER = '#f3f0e8';
const RED = '#ff493b';
const MINT = '#8ce4c1';
const MUTED = '#9da6b4';
const TAU = Math.PI * 2;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (v: number) => { const x = clamp(v); return x * x * (3 - 2 * x); };
const out = (v: number) => 1 - (1 - clamp(v)) ** 3;
const font = (size: number, weight = 600) => `${weight} ${size}px "Barlow", Arial, sans-serif`;
const display = (size: number, weight = 800) => `${weight} ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;

type Surface = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture };

/** A fixed composition with a deterministic timeline. Its canvas is also the video master. */
export function createFilmRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(INK);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(INK, 0.028);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
  camera.position.set(0, 4.3, 18.5);
  camera.lookAt(0, 0.2, 0);
  const surfaces: Surface[] = [];
  const extraMaterials: THREE.Material[] = [];
  const groups: THREE.Group[] = [];

  function surface(width: number, height: number): Surface {
    const source = document.createElement('canvas');
    source.width = width; source.height = height;
    const context = source.getContext('2d');
    if (!context) throw new Error('The film needs canvas rendering support.');
    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const result = { canvas: source, context, texture };
    surfaces.push(result);
    return result;
  }
  function physical(color: THREE.ColorRepresentation, metalness = 0.55, roughness = 0.3) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }
  function luminous(color: THREE.ColorRepresentation, opacity = 1) {
    return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
  }
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, position?: [number, number, number]) {
    const item = new THREE.Mesh(geometry, material);
    if (position) item.position.set(...position);
    parent.add(item);
    return item;
  }
  function group() {
    const item = new THREE.Group(); scene.add(item); groups.push(item); return item;
  }
  function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = PAPER, weight = 600) {
    ctx.font = font(size, weight); ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function card(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, parent: THREE.Object3D, worldWidth: number) {
    const s = surface(width, height); draw(s.context); s.texture.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: s.texture, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const plane = mesh(new THREE.PlaneGeometry(worldWidth, worldWidth * height / width), mat, parent);
    return { plane, surface: s };
  }
  function pill(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, width: number) {
    rect(ctx, x, y, width, 40, 20, color === MINT ? '#12332b' : '#391d1c');
    text(ctx, value, x + 17, y + 27, 19, color, 700);
  }
  function check(ctx: CanvasRenderingContext2D, x: number, y: number, color = MINT) {
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x + 7, y + 14); ctx.lineTo(x + 22, y - 4); ctx.stroke();
  }

  scene.add(new THREE.AmbientLight(0xb6c7df, 1.4));
  const key = new THREE.DirectionalLight(0xfff1de, 5); key.position.set(2, 8, 8); scene.add(key);
  const rim = new THREE.PointLight(0xff3f2e, 100, 20, 2); rim.position.set(5, 3, -4); scene.add(rim);
  const cool = new THREE.PointLight(0x8ce4dc, 65, 20, 2); cool.position.set(-2, 3, 4); scene.add(cool);
  const floor = mesh(new THREE.PlaneGeometry(100, 100), physical(0x090d12, 0.8, 0.4), scene);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -3.3;
  const grid = new THREE.GridHelper(80, 100, 0x26313a, 0x172029); grid.position.y = -3.29;
  (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.45; scene.add(grid);

  // Quiet, deterministic atmospheric particles; no random state is consumed during playback.
  const starPositions = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) {
    starPositions[i * 3] = Math.sin(i * 78.233) * 24;
    starPositions[i * 3 + 1] = 1 + (Math.sin(i * 35.2) + 1) * 6;
    starPositions[i * 3 + 2] = Math.cos(i * 19.17) * 16 - 8;
  }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8e9baa, size: 0.023, transparent: true, opacity: 0.6 })); scene.add(stars);

  // A dimensional model of the same Albert Park circuit used by the playable game.
  const circuit = group();
  const trackRig = new THREE.Group(); circuit.add(trackRig);
  const curve = new THREE.CatmullRomCurve3(BLOCK_CENTERS.map((p) => new THREE.Vector3((p.x - 500) / 88, 0, (p.y - 330) / 88)), true, 'catmullrom', 0.5);
  const edgeCurve = (offset: number, y: number) => new THREE.CatmullRomCurve3(Array.from({ length: 260 }, (_, i) => {
    const p = curve.getPointAt(i / 260); const tangent = curve.getTangentAt(i / 260);
    return new THREE.Vector3(p.x - tangent.z * offset, y, p.z + tangent.x * offset);
  }), true);
  mesh(new THREE.TubeGeometry(curve, 300, 0.24, 8, true), physical(0x29303a, 0.65, 0.32), trackRig);
  mesh(new THREE.TubeGeometry(edgeCurve(0.28, 0.015), 300, 0.025, 5, true), luminous(RED), trackRig);
  mesh(new THREE.TubeGeometry(edgeCurve(-0.28, 0.015), 300, 0.025, 5, true), luminous(0x637789), trackRig);
  mesh(new THREE.TubeGeometry(edgeCurve(0, -0.23), 300, 0.32, 6, true), physical(0x0e151e, 0.9, 0.2), trackRig);
  for (let i = 0; i < 100; i++) {
    const p = curve.getPointAt(i / 100); const tangent = curve.getTangentAt(i / 100);
    const marker = mesh(new THREE.BoxGeometry(0.055, 0.014, 0.11), luminous(i % 2 ? 0x736e66 : PAPER), trackRig, [p.x, 0.247, p.z]);
    marker.rotation.y = Math.atan2(tangent.x, tangent.z);
  }
  const starting = curve.getPointAt(0);
  for (let i = 0; i < 8; i++) {
    const block = mesh(new THREE.BoxGeometry(0.07, 0.015, 0.07), luminous(i % 2 ? PAPER : INK), trackRig, [starting.x, 0.26, starting.z - 0.245 + i * 0.07]);
    block.rotation.y = Math.PI / 2;
  }
  const lake = mesh(new THREE.CircleGeometry(1.75, 80), physical(0x153039, 0.96, 0.18), trackRig, [0, -0.55, -0.3]);
  lake.rotation.x = -Math.PI / 2; lake.scale.set(1.65, 0.8, 1);
  const carColors = [0xff493b, 0x8ce4c1, 0xe9d8aa, 0xc9cffa];
  const cars = carColors.map((color) => {
    const car = new THREE.Group(); trackRig.add(car);
    const body = physical(color, 0.6, 0.19);
    mesh(new THREE.BoxGeometry(0.15, 0.09, 0.39), body, car, [0, 0.12, 0]);
    const nose = mesh(new THREE.ConeGeometry(0.085, 0.31, 4), body, car, [0, 0.1, 0.29]); nose.rotation.x = Math.PI / 2; nose.rotation.z = Math.PI / 4;
    mesh(new THREE.BoxGeometry(0.32, 0.025, 0.09), body, car, [0, 0.08, 0.35]);
    mesh(new THREE.BoxGeometry(0.3, 0.04, 0.08), body, car, [0, 0.2, -0.23]);
    mesh(new THREE.SphereGeometry(0.072, 12, 8), physical(0x07090c, 0.85, 0.15), car, [0, 0.185, -0.025]);
    for (const x of [-0.135, 0.135]) for (const z of [-0.15, 0.19]) {
      const tyre = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.065, 12), physical(0x06070a, 0.3, 0.7), car, [x, 0.075, z]); tyre.rotation.z = Math.PI / 2;
      const hub = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.07, 10), physical(0xb7b9bd, 1, 0.3), car, [x, 0.075, z]); hub.rotation.z = Math.PI / 2;
    }
    car.scale.setScalar(1.22); return car;
  });
  const trails = carColors.map((color) => {
    const positions = new Float32Array(55 * 3); const colors = new Float32Array(55 * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < 55; i++) { const fade = (1 - i / 55) ** 1.6; colors.set([c.r * fade, c.g * fade, c.b * fade], i * 3); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })); trackRig.add(trail); return trail;
  });
  const trackLabel = card(640, 120, (ctx) => {
    text(ctx, 'ALBERT PARK', 20, 44, 27, PAPER, 700); text(ctx, 'THE PLAYGROUND FOR BETTER IDEAS', 20, 85, 17, MUTED, 500);
  }, circuit, 4.4); trackLabel.plane.position.set(3.3, -1.5, 3); trackLabel.plane.rotation.x = -0.1;

  // Player feedback is embodied as floating product cards.
  const suggest = group();
  const feedback = card(800, 510, (ctx) => {
    rect(ctx, 2, 2, 796, 506, 28, '#111821', '#3d454f');
    rect(ctx, 30, 30, 52, 52, 26, '#4a2825'); text(ctx, 'P', 47, 65, 26, '#ffa297', 700);
    text(ctx, 'PLAYER FEEDBACK', 102, 61, 22, MUTED, 600); text(ctx, 'Just now', 659, 61, 18, '#74818c', 500);
    line(ctx, 32, 108, 768, 108, '#29313b', 2);
    text(ctx, '“The first player', 45, 190, 53, PAPER, 600); text(ctx, 'wins too often.”', 45, 253, 53, PAPER, 600);
    text(ctx, 'Could we make the start fairer?', 45, 316, 28, MUTED, 400);
    pill(ctx, 'Sent to Pit Wall', 45, 394, MINT, 208);
    ctx.beginPath(); ctx.arc(728, 415, 25, 0, TAU); ctx.fillStyle = RED; ctx.fill(); text(ctx, '↗', 712, 426, 30, PAPER, 500);
  }, suggest, 6.55);
  const suggestions = ['A clearer home screen.', 'Let us switch to light mode.'].map((value, i) => {
    const c = card(650, 160, (ctx) => { rect(ctx, 2, 2, 646, 156, 22, '#101720', '#293744'); text(ctx, 'ANOTHER PLAYER', 30, 48, 17, MUTED, 600); text(ctx, value, 30, 105, 31, PAPER, 600); }, suggest, 5.2);
    c.plane.position.set(i ? 1 : -0.7, i ? -2.35 : 2.5, -1.7); c.plane.rotation.z = i ? 0.04 : -0.045;
    return c.plane;
  });
  const sendRing = mesh(new THREE.TorusGeometry(0.7, 0.018, 8, 70), luminous(RED), suggest); sendRing.position.set(3, -1.9, -0.6);

  // A mechanical processing core: data enters, a tested proposal emerges.
  const build = group();
  const core = new THREE.Group(); build.add(core);
  mesh(new THREE.IcosahedronGeometry(1.06, 0), physical(0xff493b, 0.58, 0.19), core);
  const shell = mesh(new THREE.IcosahedronGeometry(1.55, 1), new THREE.MeshBasicMaterial({ color: 0xb0c5c9, wireframe: true, transparent: true, opacity: 0.14 }), core);
  const rings = [0, 1, 2].map((i) => {
    const ring = mesh(new THREE.TorusGeometry(1.9 + i * 0.25, 0.018, 8, 90), luminous(i === 1 ? MINT : 0x637784, i === 1 ? 0.8 : 0.4), core);
    ring.rotation.set(i * 0.6 + 0.8, i * 0.7, i * 0.3); return ring;
  });
  const steps = ['READ THE CODE', 'BUILD THE CHANGE', 'RUN THE CHECKS'].map((value, i) => {
    const c = card(540, 136, (ctx) => {
      rect(ctx, 2, 2, 536, 132, 20, '#111a23', '#3b4b53');
      text(ctx, `0${i + 1}`, 28, 77, 30, RED, 700); text(ctx, value, 96, 59, 23, PAPER, 700);
      text(ctx, ['Understand the rules', 'Keep the change focused', 'Protect a fair game'][i], 96, 99, 18, MUTED, 400);
    }, build, 3.7);
    c.plane.position.set(i === 1 ? 1.3 : -0.9, 2.35 - i * 2.35, i === 1 ? 1.4 : 0.3); return c.plane;
  });
  const packetGeo = new THREE.SphereGeometry(0.045, 7, 5);
  const packets = Array.from({ length: 22 }, (_, i) => mesh(packetGeo, luminous(i % 3 === 0 ? MINT : RED), build));

  // Community priorities, shown as an illustrative UI, without invented vote totals.
  const vote = group();
  const voteCards = [
    { title: 'A fairer start', detail: 'Give every seat a chance', label: 'TOP COMMUNITY IDEA', accent: MINT },
    { title: 'Light & dark mode', detail: 'Your preferred way to play', label: 'PLAYER SUGGESTION', accent: '#9dabc6' },
    { title: 'A clearer home screen', detail: 'A better place to begin', label: 'PLAYER SUGGESTION', accent: '#9dabc6' },
  ].map((idea) => {
    const c = card(740, 222, (ctx) => {
      rect(ctx, 2, 2, 736, 218, 24, '#121a22', idea.accent === MINT ? '#416857' : '#33414e');
      text(ctx, idea.label, 32, 45, 17, idea.accent, 700); text(ctx, idea.title, 32, 105, 37, PAPER, 700);
      text(ctx, idea.detail, 32, 158, 23, MUTED, 400); rect(ctx, 609, 46, 92, 119, 18, '#1e3030');
      text(ctx, '↑', 640, 97, 37, idea.accent, 600); text(ctx, '+1', 636, 139, 25, idea.accent, 700);
    }, vote, 6.2); return c.plane;
  });
  const votePulses = Array.from({ length: 9 }, (_, i) => {
    const c = card(100, 100, (ctx) => { ctx.beginPath(); ctx.arc(50, 50, 46, 0, TAU); ctx.fillStyle = '#142d26'; ctx.fill(); text(ctx, '+1', 24, 64, 38, MINT, 700); }, vote, 0.6); c.plane.userData.index = i; return c.plane;
  });

  // Human review remains a clear, visible gate between AI work and deployment.
  const approve = group();
  const reviewSurface = surface(860, 780);
  const review = mesh(new THREE.PlaneGeometry(6.2, 6.2 * 780 / 860), new THREE.MeshBasicMaterial({ map: reviewSurface.texture, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: false }), approve);
  function drawReview(progress: number) {
    const ctx = reviewSurface.context; ctx.clearRect(0, 0, 860, 780);
    rect(ctx, 2, 2, 856, 776, 30, '#111923', '#3d4a56');
    text(ctx, 'PULL REQUEST / #9', 42, 65, 22, RED, 700); text(ctx, 'A fairer start.', 42, 141, 53, PAPER, 700);
    line(ctx, 42, 182, 818, 182, '#34404d', 2);
    const rows = [ ['WHAT CHANGED', 'A simultaneous start for all four players.'], ['IMPACT', 'Every seat gets a fairer chance to win.'], ['RISK', 'Medium · changes how every race starts.'], ['CHECKS', 'Rules + 3,000-race balance simulation.'] ];
    rows.forEach(([label, value], i) => { const y = 239 + i * 106; text(ctx, label, 42, y, 18, MUTED, 700); text(ctx, value, 42, y + 39, 26, PAPER, 500); });
    const approved = progress > 0.57;
    rect(ctx, 42, 670, 776, 67, 14, approved ? '#17392d' : '#2b3039', approved ? '#4a8d6e' : undefined);
    if (approved) { check(ctx, 78, 697); text(ctx, 'APPROVED BY THE DEVELOPER', 126, 714, 25, MINT, 700); }
    else text(ctx, 'READY FOR HUMAN REVIEW', 76, 714, 25, PAPER, 700);
    reviewSurface.texture.needsUpdate = true;
  }
  const approvalRing = mesh(new THREE.TorusGeometry(3.6, 0.025, 8, 100), luminous(MINT, 0.45), approve); approvalRing.position.z = -0.5;

  // Measured product proof. Only the documented PR #9 numbers appear here.
  const proof = group();
  const proofSurface = surface(900, 700);
  const proofPanel = mesh(new THREE.PlaneGeometry(7, 7 * 700 / 900), new THREE.MeshBasicMaterial({ map: proofSurface.texture, transparent: true, side: THREE.DoubleSide, toneMapped: false, fog: false }), proof);
  function drawProof(progress: number) {
    const ctx = proofSurface.context; ctx.clearRect(0, 0, 900, 700);
    rect(ctx, 2, 2, 896, 696, 30, '#101920', '#384c50');
    pill(ctx, 'LIVE IN THE GAME', 38, 32, MINT, 221);
    text(ctx, 'A fairer start. Measured.', 38, 137, 44, PAPER, 700);
    text(ctx, 'WIN RATE BY STARTING SEAT', 38, 183, 20, MUTED, 600);
    // Finish the measured comparison before local second four, leaving time to read it.
    const after = smooth((progress - 0.12) / 0.42);
    const settled = after === 1;
    // Published PR #9 measurements, rounded to one decimal in the source.
    const old = [0.502, 0.217, 0.169, 0.112]; const next = [0.261, 0.258, 0.241, 0.241];
    for (let i = 0; i < 4; i++) {
      const x = 66 + i * 208; const value = old[i] + (next[i] - old[i]) * after;
      const barHeight = value * 420; const y = 470 - barHeight;
      rect(ctx, x, 235, 126, 235, 8, '#17232c');
      rect(ctx, x, y, 126, barHeight, 8, after > 0.6 ? MINT : (i === 0 ? RED : '#778797'));
      text(ctx, `${(value * 100).toFixed(1)}%`, x + 12, y - 20, 33, PAPER, 700);
      text(ctx, `SEAT ${i + 1}`, x + 24, 510, 20, MUTED, 600);
    }
    line(ctx, 38, 551, 862, 551, '#33454d', 2);
    text(ctx, settled ? '~24–26%' : '50.2%', 40, 631, settled ? 57 : 65, settled ? MINT : RED, 700);
    text(ctx, settled ? 'across all four seats' : 'first-seat win rate before', 314, 612, 27, PAPER, 500);
    text(ctx, '3,000 simulated races · shipped in PR #9', 314, 650, 20, MUTED, 400);
    proofSurface.texture.needsUpdate = true;
  }

  // Single compositor: typography is part of the recorded image, not a DOM overlay.
  const overlay = surface(FILM_WIDTH, FILM_HEIGHT);
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); overlayCamera.position.z = 1;
  const overlayMaterial = new THREE.MeshBasicMaterial({ map: overlay.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  extraMaterials.push(overlayMaterial);
  const overlayQuad = mesh(new THREE.PlaneGeometry(2, 2), overlayMaterial, overlayScene);

  function drawOverlay(time: number, index: number, progress: number) {
    const ctx = overlay.context; ctx.clearRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
    const chapter = FILM_CHAPTERS[index];
    const local = time - chapter.start;
    const chapterOpacity = Math.min(out(local / 0.6), index === 6 ? 1 : smooth((chapter.end - time) / 0.43));
    // Light absorbs into the copy area; the moving circuit is always visible underneath.
    const gradient = ctx.createLinearGradient(0, 0, 1160, 0);
    gradient.addColorStop(0, 'rgba(8,11,16,.93)'); gradient.addColorStop(0.63, 'rgba(8,11,16,.82)'); gradient.addColorStop(1, 'rgba(8,11,16,0)');
    if (index !== 6) { ctx.fillStyle = gradient; ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT); }
    const vignette = ctx.createLinearGradient(0, 0, 0, FILM_HEIGHT);
    vignette.addColorStop(0, 'rgba(8,11,16,.5)'); vignette.addColorStop(0.28, 'rgba(8,11,16,0)'); vignette.addColorStop(0.77, 'rgba(8,11,16,0)'); vignette.addColorStop(1, 'rgba(8,11,16,.94)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);

    ctx.save(); ctx.translate(100, 69); ctx.fillStyle = RED;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(i * 12, 0); ctx.lineTo(i * 12 + 8, 0); ctx.lineTo(i * 12 + 20, 25); ctx.lineTo(i * 12 + 12, 25); ctx.fill(); }
    text(ctx, 'PITWALL', 64, 24, 27, PAPER, 700); ctx.restore();
    ctx.textAlign = 'right'; text(ctx, 'THE PLAYER → PRODUCT LOOP', 1818, 91, 19, MUTED, 500); ctx.textAlign = 'left';
    line(ctx, 100, 126, 1820, 126, '#313840');

    ctx.save(); ctx.globalAlpha = chapterOpacity;
    const slide = 30 * (1 - out(local / 0.9));
    if (index === 6) {
      ctx.fillStyle = 'rgba(8,11,16,.3)'; ctx.fillRect(0, 126, FILM_WIDTH, 730);
      ctx.textAlign = 'center'; text(ctx, chapter.kicker, 960, 315 + slide, 25, RED, 700);
      ctx.font = display(250); ctx.fillStyle = PAPER; ctx.fillText('PITWALL', 960, 573 + slide);
      text(ctx, 'Your game. Your voice. Your next lap.', 960, 665 + slide, 40, PAPER, 500);
      text(ctx, chapter.detail, 960, 744 + slide, 22, MUTED, 600);
      text(ctx, 'AI-GENERATED NARRATION · ORIGINAL SCORE', 960, 800 + slide, 16, '#87929e', 500); ctx.textAlign = 'left';
    } else {
      text(ctx, chapter.kicker, 106, 305 + slide, 23, RED, 700);
      let size = index === 0 ? 130 : 112;
      ctx.font = display(size);
      const maxWidth = 845;
      while (chapter.title.some((value) => ctx.measureText(value).width > maxWidth) && size > 72) { size -= 2; ctx.font = display(size); }
      chapter.title.forEach((value, i) => {
        ctx.fillStyle = i === 1 ? (index === 5 ? MINT : PAPER) : PAPER;
        const lineSlide = 25 * (1 - out((local - i * 0.1) / 0.9));
        ctx.fillText(value, 100, 437 + i * (size * 1.08) + slide + lineSlide);
      });
      line(ctx, 106, 648, 166, 648, index === 5 ? MINT : RED, 4);
      const detailWidth = 800; let detailSize = 19; ctx.font = font(detailSize, 600);
      while (ctx.measureText(chapter.detail).width > detailWidth) { detailSize--; ctx.font = font(detailSize, 600); }
      text(ctx, chapter.detail, 106, 697, detailSize, MUTED, 600);
      if (index === 0) {
        text(ctx, 'Feedback should be a starting line.', 106, 759, 27, '#c1c8ce', 400);
      }
      if (index === 2) {
        const status = progress < 0.32 ? 'READING THE RULES' : progress < 0.65 ? 'BUILDING A FOCUSED CHANGE' : 'TESTS PASSED · PR READY';
        ctx.beginPath(); ctx.arc(112, 755, 5, 0, TAU); ctx.fillStyle = progress < 0.65 ? RED : MINT; ctx.fill();
        text(ctx, status, 132, 762, 20, progress < 0.65 ? MUTED : MINT, 600);
      }
      if (index === 3) text(ctx, 'Illustrative community view', 1144, 856, 17, '#82919a', 400);
      if (index === 4 && progress > 0.6) text(ctx, 'Human approval comes before deployment.', 106, 759, 25, MINT, 500);
    }
    ctx.restore();

    // Subtitles have their own quiet region, safely away from scene artwork.
    ctx.textAlign = 'center'; ctx.globalAlpha = Math.max(0.4, chapterOpacity);
    text(ctx, captionAt(time), 960, 937, 31, PAPER, 500); ctx.globalAlpha = 1; ctx.textAlign = 'left';
    const barWidth = 1720 / 7;
    FILM_CHAPTERS.forEach((part, i) => {
      const x = 100 + i * barWidth;
      line(ctx, x, 993, x + barWidth - 12, 993, '#333e47', 3);
      const p = clamp((time - part.start) / (part.end - part.start));
      if (p > 0) line(ctx, x, 993, x + (barWidth - 12) * p, 993, i === 5 ? MINT : RED, 3);
      text(ctx, part.label.toUpperCase(), x, 1031, 16, i === index ? PAPER : '#74808a', 600);
    });
    // A soft directional cut keeps chapters linked, without flashing the entire screen.
    const transition = Math.max(0, 1 - local / 0.5);
    if (index > 0 && transition > 0) {
      ctx.fillStyle = `rgba(255,73,59,${transition * 0.15})`;
      ctx.fillRect(1920 * (1 - transition), 126, 3 + 90 * transition, 730);
    }
    overlay.texture.needsUpdate = true;
  }

  const direction = new THREE.Vector3();
  let disposed = false;
  function render(rawTime: number) {
    if (disposed) return;
    const time = clamp(rawTime, 0, FILM_DURATION);
    const chapter = chapterAt(time);
    const index = FILM_CHAPTERS.indexOf(chapter);
    const local = time - chapter.start; const progress = clamp(local / (chapter.end - chapter.start));
    const enter = out(local / 1.15);
    groups.forEach((g) => { g.visible = false; });
    circuit.visible = index === 0 || index === 5 || index === 6;
    circuit.position.set(index === 6 ? 0 : 4.0, index === 5 ? -2.2 : index === 0 ? 0.6 : -0.25, -0.5);
    circuit.scale.setScalar(index === 5 ? 0.6 : index === 6 ? 1.55 : 1.1);
    trackRig.rotation.y = index === 6 ? -0.15 + (time - 43) * 0.025 : -0.25 + time * 0.025;
    trackRig.rotation.z = index === 0 ? 0.04 * Math.sin(time * 0.2) : 0;
    trackLabel.plane.visible = index === 0;
    if (index === 0) {
      circuit.position.x = 4.25 + (1 - enter) * 1.2;
      circuit.rotation.x = 0.35 + 0.03 * smooth(progress);
      circuit.scale.setScalar(1.05 + 0.12 * smooth(progress));
    } else circuit.rotation.x = 0;
    cars.forEach((car, i) => {
      const p = (time * (0.047 + i * 0.001) + i * 0.17) % 1;
      const at = curve.getPointAt(p); direction.copy(curve.getTangentAt(p));
      const lane = (i % 2 ? 1 : -1) * 0.07;
      car.position.set(at.x - direction.z * lane, 0.25, at.z + direction.x * lane);
      car.rotation.y = Math.atan2(direction.x, direction.z);
      const positions = trails[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < 55; j++) {
        const t = (p - j * 0.0018 + 1) % 1; const pt = curve.getPointAt(t);
        positions.setXYZ(j, pt.x, 0.31, pt.z);
      }
      positions.needsUpdate = true;
    });
    const targetCameraY = index === 0 ? 7 - progress * 1.5 : index === 6 ? 8 : 3.5;
    camera.position.set(0, targetCameraY, index === 6 ? 20.5 : 18.5);
    camera.lookAt(0, 0.1, 0);
    if (index === 1) {
      suggest.visible = true; suggest.position.set(4.3 + 1.2 * (1 - enter), 0.6, 0); suggest.rotation.y = -0.16 + 0.04 * Math.sin(local * 0.5);
      feedback.plane.position.y = Math.sin(local * 0.7) * 0.12; feedback.plane.rotation.z = -0.025 + 0.012 * Math.sin(local * 0.4);
      suggestions.forEach((g, i) => { g.position.x = (i ? 1 : -0.7) + Math.sin(local * 0.45 + i) * 0.14; });
      sendRing.scale.setScalar(1 + (local % 2) * 0.4); (sendRing.material as THREE.MeshBasicMaterial).opacity = (1 - (local % 2) / 2) * 0.5; (sendRing.material as THREE.MeshBasicMaterial).transparent = true;
    }
    if (index === 2) {
      build.visible = true; build.position.set(4.5 + (1 - enter), 0.5, 0);
      core.rotation.set(time * 0.15, time * 0.23, 0.12); shell.rotation.y = -time * 0.12;
      rings.forEach((ring, i) => { ring.rotation.z = local * (0.25 + i * 0.12); });
      steps.forEach((step, i) => { const move = out((local - i * 1.4) / 0.8); step.visible = move > 0; step.position.x = (i === 1 ? 1.4 : -0.4) + (1 - move) * 2; step.rotation.y = -0.16; });
      packets.forEach((packet, i) => { const angle = time * 0.6 + i * TAU / packets.length; packet.position.set(Math.cos(angle) * 2.65, Math.sin(angle * 1.5) * 1.8, Math.sin(angle) * 2.1); });
    }
    if (index === 3) {
      vote.visible = true; vote.position.set(4.6 + (1 - enter), 0.7, 0); vote.rotation.y = -0.13;
      voteCards.forEach((plane, i) => { plane.position.set(i * 0.13, 2 - i * 2.02 + Math.sin(time * 0.6 + i) * 0.05, -i * 0.4); plane.rotation.z = i === 0 ? -0.015 : 0.012; });
      votePulses.forEach((pulse, i) => { const p = (local * 0.24 + i / votePulses.length) % 1; pulse.position.set(2.8 + Math.sin(i * 13.7) * 0.7, -2.6 + p * 6.3, 1 + i * 0.03); pulse.scale.setScalar(0.7 + Math.sin(p * Math.PI) * 0.5); (pulse.material as THREE.MeshBasicMaterial).opacity = Math.sin(p * Math.PI) * 0.9; });
    }
    if (index === 4) {
      approve.visible = true; approve.position.set(4.7 + (1 - enter) * 1.1, 0.75, -0.2); approve.rotation.y = -0.13 + Math.sin(local * 0.4) * 0.02;
      review.position.y = Math.sin(local * 0.5) * 0.06; approvalRing.rotation.z = time * 0.1; approvalRing.visible = progress > 0.57;
      approvalRing.scale.setScalar(0.95 + (progress - 0.57) * 0.3); drawReview(progress);
    }
    if (index === 5) {
      proof.visible = true; proof.position.set(4.5 + (1 - enter) * 1.2, 0.95, 0.4); proof.rotation.y = -0.11; proofPanel.position.y = Math.sin(local * 0.5) * 0.03; drawProof(progress);
    }
    stars.rotation.y = time * 0.008;
    drawOverlay(time, index, progress);
    renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(overlayScene, overlayCamera);
  }

  function resize(width: number, height: number, pixelRatio = Math.min(window.devicePixelRatio || 1, 2)) {
    renderer.setPixelRatio(Math.min(pixelRatio, 2)); renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = 16 / 9; camera.updateProjectionMatrix();
  }
  function dispose() {
    if (disposed) return; disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
    scene.traverse((node) => { const object = node as THREE.Mesh; if (object.geometry) geometries.add(object.geometry); if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m)); });
    geometries.add(overlayQuad.geometry); extraMaterials.forEach((m) => materials.add(m));
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); surfaces.forEach((s) => s.texture.dispose());
    // Do not force context loss: React may immediately reuse this canvas during HMR.
    renderer.dispose();
  }
  resize(FILM_WIDTH, FILM_HEIGHT, 1); render(0);
  return { render, resize, dispose };
}
