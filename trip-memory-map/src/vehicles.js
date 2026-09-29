/* 3D vehicles on the map — a MapLibre custom layer drawn with three.js.
   Every model is built from primitives here (no downloaded assets), in a
   small toy style: walker, bicycle, car, bus, shinkansen, metro, airliner,
   boat and a hot-air balloon for unknown legs.

   Local frame: x east, y up, z south, 1 unit = 1 screen pixel at the
   current zoom, origin at the map centre. That keeps models a constant
   on-screen size and keeps float32 precision fine at any zoom. When the map
   is flat the models are tipped back so they still read as 3D objects;
   during the replay the camera itself pitches and the tip goes away. */

import * as THREE from '../vendor/three/three.min.mjs';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const VIEW_ANGLE = 52; // degrees from vertical the models are always seen at

/* Toy proportions: long vehicles get taller and wider than life so they
   still read as a train or a bus at map scale. */
const CHUNK = { shinkansen: 1.8, metro: 1.75, bus: 1.35, boat: 1.3, car: 1.18 };
const MOVER_SCALE = 1.45;
const LEG_SCALE = 0.78;

/* ------------------------------------------------------------- helpers */

const matCache = new Map();
function mat(color, { rough = 0.6, metal = 0.05, flat = true, glow = false } = {}) {
  const key = `${color}|${rough}|${metal}|${flat}|${glow}`;
  if (!matCache.has(key)) {
    const m = glow
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat });
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

function rod(a, b, r, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  return m;
}

/** Extrude a side profile (x forward, y up) symmetrically across z. */
function side(shape, depth, bevel = 0, segments = 2) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: segments, curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function roundRect(x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function wheel(r, w, x, y, z) {
  const g = new THREE.Group();
  const tire = new THREE.CylinderGeometry(r, r, w, 18);
  tire.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(tire, mat('#1d2126', { rough: 0.9 })));
  const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.06, 10);
  hub.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(hub, mat('#aab2bb', { metal: 0.35, rough: 0.4 })));
  g.add(box(r * 1.5, r * 0.2, w * 1.1, mat('#59616b')));
  g.position.set(x, y, z);
  g.name = 'wheel';
  return g;
}

const SKIN = '#f1c7a0';

/* -------------------------------------------------------------- models */

function person() {
  const g = new THREE.Group();
  const skin = mat(SKIN);
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.6, 4, 8);
  for (const s of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.9, 0.1 * s);
    hip.name = s > 0 ? 'legL' : 'legR';
    hip.add(mesh(legGeo, mat('#2f3e5c'), 0, -0.4, 0));
    hip.add(box(0.25, 0.09, 0.13, mat('#22262c'), 0.05, -0.85, 0));
    g.add(hip);
  }
  const torso = mesh(new THREE.CapsuleGeometry(0.19, 0.36, 4, 10), mat('#e4572e'), 0, 1.2, 0);
  torso.scale.set(0.85, 1, 1.08);
  g.add(torso);
  const armGeo = new THREE.CapsuleGeometry(0.06, 0.44, 4, 6);
  for (const s of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 1.4, 0.26 * s);
    shoulder.name = s > 0 ? 'armL' : 'armR';
    shoulder.add(mesh(armGeo, mat('#e4572e'), 0, -0.27, 0));
    shoulder.add(mesh(new THREE.SphereGeometry(0.065, 8, 6), skin, 0, -0.55, 0));
    g.add(shoulder);
  }
  g.add(mesh(new THREE.SphereGeometry(0.15, 16, 12), skin, 0.01, 1.63, 0));
  g.add(mesh(new THREE.SphereGeometry(0.158, 16, 8, 0, TAU, 0, Math.PI / 2), mat('#2b2620'), -0.01, 1.66, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 20), mat('#e9d8a6'), 0, 1.72, 0)); // hat brim
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.12, 16), mat('#e9d8a6'), 0, 1.78, 0));
  g.add(box(0.17, 0.36, 0.32, mat('#1f3a5f'), -0.21, 1.23, 0)); // backpack
  return { group: g, size: 1.85, px: 46 };
}

function bike() {
  const g = new THREE.Group();
  const frame = mat('#2a9d8f', { metal: 0.25, rough: 0.45 });
  const wr = 0.34;
  for (const x of [-0.52, 0.52]) {
    const w = new THREE.Group();
    w.position.set(x, wr, 0);
    w.name = 'wheel';
    w.add(new THREE.Mesh(new THREE.TorusGeometry(wr, 0.04, 6, 26), mat('#1d2126', { rough: 0.9 })));
    const spoke = mat('#c3cad1', { metal: 0.3 });
    w.add(box(wr * 1.9, 0.025, 0.025, spoke));
    w.add(box(0.025, wr * 1.9, 0.025, spoke));
    g.add(w);
  }
  const rear = V(-0.52, wr, 0);
  const bb = V(-0.05, 0.3, 0);
  const seat = V(-0.2, 0.95, 0);
  const head = V(0.42, 0.98, 0);
  const front = V(0.52, wr, 0);
  g.add(rod(rear, bb, 0.026, frame), rod(bb, seat, 0.03, frame), rod(seat, head, 0.03, frame),
    rod(bb, head, 0.032, frame), rod(rear, seat, 0.022, frame), rod(head, front, 0.028, frame));
  g.add(box(0.24, 0.05, 0.11, mat('#22262c'), -0.22, 0.99, 0));
  g.add(box(0.05, 0.05, 0.52, mat('#22262c'), 0.43, 1.03, 0));
  const skin = mat(SKIN);
  const jacket = mat('#264653');
  for (const s of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(-0.2, 1.02, 0.12 * s);
    hip.name = s > 0 ? 'legL' : 'legR';
    hip.add(mesh(new THREE.CapsuleGeometry(0.075, 0.52, 4, 6), mat('#2f3e5c'), 0, -0.32, 0));
    g.add(hip);
  }
  const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 8), jacket, 0.02, 1.34, 0);
  torso.rotation.z = -0.6;
  g.add(torso);
  g.add(rod(V(0.08, 1.5, 0.22), V(0.42, 1.05, 0.24), 0.05, jacket), rod(V(0.08, 1.5, -0.22), V(0.42, 1.05, -0.24), 0.05, jacket));
  g.add(mesh(new THREE.SphereGeometry(0.14, 14, 10), skin, 0.24, 1.66, 0));
  g.add(mesh(new THREE.SphereGeometry(0.165, 14, 8, 0, TAU, 0, Math.PI / 2), mat('#e9c46a'), 0.22, 1.69, 0));
  return { group: g, size: 1.8, px: 52 };
}

function car() {
  const g = new THREE.Group();
  const p = new THREE.Shape();
  p.moveTo(-2.1, 0.3);
  p.lineTo(2.05, 0.3);
  p.quadraticCurveTo(2.25, 0.32, 2.2, 0.72);
  p.lineTo(1.35, 0.9);
  p.lineTo(0.55, 1.42);
  p.lineTo(-1.25, 1.44);
  p.lineTo(-1.95, 1.0);
  p.quadraticCurveTo(-2.18, 0.9, -2.12, 0.5);
  p.lineTo(-2.1, 0.3);
  g.add(mesh(side(p, 1.64, 0.1), mat('#3d5a80', { rough: 0.35, metal: 0.3 })));
  const glass = new THREE.Shape();
  glass.moveTo(1.22, 0.93);
  glass.lineTo(0.54, 1.37);
  glass.lineTo(-1.18, 1.39);
  glass.lineTo(-1.8, 1.0);
  glass.lineTo(1.22, 0.93);
  g.add(mesh(side(glass, 1.88), mat('#1b2633', { rough: 0.2, metal: 0.5 })));
  g.add(box(0.06, 0.12, 1.5, mat('#e7ecf2', { rough: 0.3 }), 2.24, 0.52, 0)); // bumper
  for (const z of [0.58, -0.58]) {
    g.add(box(0.08, 0.12, 0.34, mat('#fff4c8', { glow: true }), 2.22, 0.66, z));
    g.add(box(0.06, 0.12, 0.3, mat('#d94b3d', { glow: true }), -2.18, 0.7, z));
  }
  for (const x of [1.35, -1.35]) for (const z of [0.86, -0.86]) g.add(wheel(0.36, 0.26, x, 0.36, z));
  return { group: g, size: 4.45, px: 54 };
}

function bus() {
  const g = new THREE.Group();
  g.add(mesh(side(roundRect(-5.5, 0.4, 11, 2.9, 0.45), 2.4, 0.08), mat('#7b5ea7', { rough: 0.45 })));
  g.add(box(10.1, 0.95, 2.58, mat('#1b2633', { rough: 0.2, metal: 0.5 }), -0.15, 2.35, 0));
  g.add(box(0.1, 1.5, 2.2, mat('#1b2633', { rough: 0.2, metal: 0.5 }), 5.52, 2.25, 0));
  g.add(box(10.4, 0.1, 2.3, mat('#f4f1ea'), 0, 3.36, 0));
  g.add(box(10.8, 0.28, 2.58, mat('#f4f1ea'), 0, 1.25, 0)); // cream band
  for (const z of [0.9, -0.9]) g.add(box(0.08, 0.22, 0.4, mat('#fff4c8', { glow: true }), 5.55, 0.95, z));
  for (const x of [3.6, -3.4]) for (const z of [1.18, -1.18]) g.add(wheel(0.52, 0.34, x, 0.52, z));
  return { group: g, size: 11.1, px: 66 };
}

function shinkansenCar(lead) {
  const g = new THREE.Group();
  const p = new THREE.Shape();
  if (lead) {
    p.moveTo(-12, 0.7);
    p.lineTo(10.2, 0.7);
    p.quadraticCurveTo(12.5, 0.75, 12.3, 1.3);
    p.bezierCurveTo(11.6, 2.3, 7.4, 3.75, 2.2, 3.95);
    p.lineTo(-12, 3.95);
    p.lineTo(-12, 0.7);
  } else {
    p.moveTo(-12, 0.7);
    p.lineTo(12, 0.7);
    p.lineTo(12, 3.95);
    p.lineTo(-12, 3.95);
    p.lineTo(-12, 0.7);
  }
  g.add(mesh(side(p, 3.0, 0.28, 3), mat('#f5f6f8', { rough: 0.3, metal: 0.15, flat: false })));
  const blue = mat('#1f5aa6', { rough: 0.35 });
  g.add(box(lead ? 20.5 : 24, 0.42, 3.6, blue, lead ? -1.6 : 0, 1.5, 0));
  g.add(box(lead ? 19 : 24, 0.1, 3.6, blue, lead ? -2.4 : 0, 1.9, 0));
  g.add(box(lead ? 17.5 : 23, 0.55, 3.6, mat('#18212c', { rough: 0.2, metal: 0.5 }), lead ? -3.3 : 0, 2.75, 0));
  if (lead) {
    const cockpit = box(2.8, 0.18, 2.3, mat('#18212c', { rough: 0.2, metal: 0.5 }), 6.6, 3.52, 0);
    cockpit.rotation.z = -0.24;
    g.add(cockpit);
    g.add(box(0.2, 0.14, 0.5, mat('#fff4c8', { glow: true }), 11.9, 1.45, 0.9));
    g.add(box(0.2, 0.14, 0.5, mat('#fff4c8', { glow: true }), 11.9, 1.45, -0.9));
  } else {
    g.add(box(1.4, 0.35, 0.5, mat('#6c7684', { metal: 0.4 }), 4, 4.25, 0)); // pantograph base
    g.add(rod(V(4, 4.35, 0), V(5.3, 5.0, 0), 0.05, mat('#6c7684', { metal: 0.4 })));
  }
  g.add(box(lead ? 21 : 23.5, 0.45, 2.7, mat('#3a414b', { rough: 0.8 }), lead ? -1.5 : 0, 0.45, 0)); // skirt
  return g;
}

function shinkansen() {
  const g = new THREE.Group();
  const lead = shinkansenCar(true);
  lead.position.x = 12.4;
  const tail = shinkansenCar(true);
  tail.scale.x = -1;
  tail.position.x = -12.4;
  g.add(lead, tail);
  g.add(box(0.9, 3, 2.8, mat('#2a3038'), 0, 2.3, 0));
  return { group: g, size: 49.6, px: 124 };
}

function metroCar(front) {
  const g = new THREE.Group();
  g.add(mesh(side(roundRect(-9, 0.55, 18, 3.3, 0.5), 2.7, 0.12), mat('#d6dbe1', { rough: 0.3, metal: 0.45 })));
  g.add(box(18.1, 0.4, 2.98, mat('#1f3a5f'), 0, 1.45, 0));
  g.add(box(16.6, 0.9, 2.98, mat('#18212c', { rough: 0.2, metal: 0.5 }), -0.2, 2.65, 0));
  if (front) {
    g.add(box(0.14, 1.4, 2.4, mat('#18212c', { rough: 0.2, metal: 0.5 }), 9.08, 2.55, 0));
    for (const z of [0.9, -0.9]) g.add(box(0.12, 0.2, 0.4, mat('#fff4c8', { glow: true }), 9.1, 1.2, z));
  }
  g.add(box(16, 0.4, 2.4, mat('#3a414b', { rough: 0.8 }), 0, 0.4, 0));
  return g;
}

function metro() {
  const g = new THREE.Group();
  const a = metroCar(true);
  a.position.x = 9.3;
  const b = metroCar(true);
  b.scale.x = -1;
  b.position.x = -9.3;
  g.add(a, b);
  return { group: g, size: 37, px: 98 };
}

function plane() {
  const g = new THREE.Group();
  const white = mat('#f7f7f5', { rough: 0.35, metal: 0.1, flat: false });
  const body = new THREE.CylinderGeometry(1.9, 1.9, 26, 20);
  body.rotateZ(Math.PI / 2);
  g.add(mesh(body, white));
  const nose = mesh(new THREE.SphereGeometry(1.9, 20, 14), white, 13, 0, 0);
  nose.scale.set(2.1, 1, 1);
  g.add(nose);
  const tail = new THREE.ConeGeometry(1.9, 8, 20);
  tail.rotateZ(Math.PI / 2);
  g.add(mesh(tail, white, -17, 0.35, 0));
  g.add(box(19, 0.34, 3.86, mat('#1b2633', { rough: 0.3 }), 1, 0.62, 0)); // window line
  const cockpit = box(1.3, 0.36, 1.9, mat('#1b2633', { rough: 0.3 }), 14.5, 1.32, 0);
  cockpit.rotation.z = -0.42;
  g.add(cockpit);
  const planform = (pts) => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.42, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    return geo;
  };
  const wingMat = mat('#e9ecef', { rough: 0.4, metal: 0.15 });
  g.add(mesh(planform([[3.2, 1.6], [-5.6, 16.5], [-7.8, 16.5], [-3.4, 1.6], [-3.4, -1.6], [-7.8, -16.5], [-5.6, -16.5], [3.2, -1.6]]), wingMat, 0, -0.55, 0));
  g.add(mesh(planform([[1, 0.6], [-2.6, 6.6], [-4.2, 6.6], [-3.2, 0.6], [-3.2, -0.6], [-4.2, -6.6], [-2.6, -6.6], [1, -0.6]]), wingMat, -17.6, 0.9, 0));
  const fin = new THREE.Shape();
  fin.moveTo(-14.2, 1.2);
  fin.lineTo(-19.4, 8.4);
  fin.lineTo(-21.8, 8.4);
  fin.lineTo(-21, 1.2);
  fin.lineTo(-14.2, 1.2);
  g.add(mesh(side(fin, 0.45), mat('#d4553d', { rough: 0.45 })));
  const engine = new THREE.CylinderGeometry(0.95, 0.8, 4.4, 16);
  engine.rotateZ(Math.PI / 2);
  for (const z of [6.2, -6.2]) {
    g.add(mesh(engine, mat('#c9ced4', { metal: 0.4, rough: 0.35 }), 1.2, -1.55, z));
    g.add(mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 16).rotateZ(Math.PI / 2), mat('#2a3038'), 3.42, -1.55, z));
  }
  return { group: g, size: 38, px: 98 };
}

function boat() {
  const g = new THREE.Group();
  const hull = new THREE.Shape();
  hull.moveTo(-6, 0.25);
  hull.lineTo(4.4, 0.25);
  hull.quadraticCurveTo(6.6, 0.5, 7.2, 1.9);
  hull.lineTo(-6.3, 1.9);
  hull.lineTo(-6.3, 0.7);
  hull.lineTo(-6, 0.25);
  g.add(mesh(side(hull, 3.4, 0.25), mat('#f4f1ea', { rough: 0.5 })));
  g.add(box(12.6, 0.3, 3.95, mat('#2f80ed'), 0.2, 0.75, 0)); // waterline stripe
  g.add(box(12.4, 0.12, 3.5, mat('#b98a5a', { rough: 0.8 }), 0.3, 2.0, 0)); // deck
  g.add(mesh(side(roundRect(-3.5, 2.0, 6, 1.7, 0.3), 2.6), mat('#ffffff', { rough: 0.5 })));
  g.add(box(5.4, 0.55, 2.66, mat('#1b2633', { rough: 0.25, metal: 0.4 }), -0.5, 3.05, 0));
  g.add(box(6.6, 0.18, 3.1, mat('#2f80ed'), -0.5, 3.8, 0)); // roof
  g.add(rod(V(-5.2, 2, 0), V(-5.2, 4.8, 0), 0.06, mat('#8a6a4a')));
  const flag = box(1.1, 0.7, 0.05, mat('#d4553d'), -4.6, 4.45, 0);
  flag.name = 'flag';
  g.add(flag);
  return { group: g, size: 13.5, px: 74 };
}

function balloon() {
  const g = new THREE.Group();
  const profile = [];
  for (let i = 0; i <= 18; i += 1) {
    const t = i / 18;
    const s = 0.06 + t * 0.94;
    const r = 2.9 * Math.pow(Math.sin(Math.PI * s), 0.7);
    profile.push(new THREE.Vector2(Math.max(0.01, r), 3.4 + t * 6));
  }
  const gores = 10;
  for (let i = 0; i < gores; i += 1) {
    const geo = new THREE.LatheGeometry(profile, 3, (i / gores) * TAU, TAU / gores);
    g.add(new THREE.Mesh(geo, mat(i % 2 ? '#f1e6cf' : '#d4553d', { rough: 0.55 })));
  }
  const rope = mat('#6b5a45');
  for (const [x, z] of [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]]) g.add(rod(V(x, 1.1, z), V(x * 1.2, 3.45, z * 1.2), 0.03, rope));
  g.add(box(1.1, 0.9, 1.1, mat('#9c7248', { rough: 0.9 }), 0, 0.65, 0));
  return { group: g, size: 9.5, px: 50 };
}

const BUILDERS = { person, bike, car, bus, shinkansen, metro, plane, boat, balloon };
const templates = new Map();

function template(kind) {
  if (!templates.has(kind)) {
    const t = (BUILDERS[kind] || person)();
    t.group.traverse((o) => { o.frustumCulled = false; });
    templates.set(kind, t);
  }
  return templates.get(kind);
}

/** A fresh copy of a model, e.g. for previews. */
export function modelTemplate(kind) {
  const t = template(kind);
  return { group: t.group.clone(), size: t.size };
}

export function kindFor(seg) {
  if (!seg) return 'person';
  if (seg.mode === 'rail') return (seg.speed >= 140 || seg.km >= 80) ? 'shinkansen' : 'metro';
  return { walk: 'person', bike: 'bike', bus: 'bus', car: 'car', boat: 'boat', flight: 'plane', unknown: 'balloon' }[seg.mode] || 'person';
}

/* ------------------------------------------------------------ instance */

let shadowTexture = null;
function shadowMaterial() {
  if (!shadowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(20,16,10,0.42)');
    grad.addColorStop(0.6, 'rgba(20,16,10,0.18)');
    grad.addColorStop(1, 'rgba(20,16,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTexture = new THREE.CanvasTexture(c);
    shadowTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
}

class Vehicle {
  constructor(kind) {
    this.kind = kind;
    const t = template(kind);
    this.base = t;
    this.root = new THREE.Group();
    this.shadowYaw = new THREE.Group();
    const shadowGeo = new THREE.CircleGeometry(0.5, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(shadowGeo, shadowMaterial());
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = -1;
    this.shadowYaw.add(this.shadow);
    this.tilt = new THREE.Group();
    this.yaw = new THREE.Group();
    this.model = t.group.clone();
    this.tilt.add(this.yaw);
    this.yaw.add(this.model);
    this.root.add(this.shadowYaw, this.tilt);
    this.parts = {};
    for (const name of ['legL', 'legR', 'armL', 'armR', 'flag']) this.parts[name] = this.model.getObjectByName(name);
    this.wheels = [];
    this.model.traverse((o) => { if (o.name === 'wheel') this.wheels.push(o); });
    // footprint for the shadow (in model units)
    const long = t.size;
    const wide = kind === 'plane' ? 34 : kind === 'person' ? 0.7 : kind === 'balloon' ? 3 : long * (kind === 'bike' ? 0.35 : kind === 'boat' ? 0.3 : 0.26);
    this.footprint = [kind === 'person' || kind === 'balloon' ? wide : long, wide];
  }

  /**
   * px: target size in pixels, bearing: compass degrees, lift: 0..1 altitude,
   * tiltDeg: how far to tip the model back, t: seconds, moving: animate.
   */
  pose({ x, z, px, bearing, lift = 0, tiltDeg, t, moving, back = 0 }) {
    const k = px / this.base.size;
    const ex = CHUNK[this.kind] || 1;
    const b = (bearing * Math.PI) / 180;
    // "back" parks the vehicle a little behind a stop marker so it stays visible
    this.root.position.set(x - Math.sin(b) * back, 0, z + Math.cos(b) * back);
    const yaw = ((90 - bearing) * Math.PI) / 180;
    this.yaw.rotation.y = yaw;
    this.shadowYaw.rotation.y = yaw;
    this.tilt.rotation.x = (-tiltDeg * Math.PI) / 180;
    this.model.scale.set(k, k * ex, k * ex);

    let height = 0;
    let roll = 0;
    let pitch = 0;
    const kind = this.kind;
    if (kind === 'plane') {
      height = lift * px * 0.9;
      roll = Math.sin(t * 0.9) * 0.05;
      pitch = moving ? (0.5 - lift) * 0.12 : 0;
    } else if (kind === 'balloon') {
      height = (0.25 + lift * 0.4) * px + Math.sin(t * 1.3) * px * 0.04;
    } else if (kind === 'boat') {
      roll = Math.sin(t * 2.1) * 0.05;
      pitch = Math.sin(t * 1.5) * 0.03;
      if (this.parts.flag) this.parts.flag.rotation.y = Math.sin(t * 6) * 0.25;
    } else if (kind === 'person') {
      const s = moving ? Math.sin(t * 9) : 0;
      if (this.parts.legL) {
        this.parts.legL.rotation.z = s * 0.55;
        this.parts.legR.rotation.z = -s * 0.55;
        this.parts.armL.rotation.z = -s * 0.5;
        this.parts.armR.rotation.z = s * 0.5;
      }
      height = moving ? Math.abs(Math.cos(t * 9)) * k * 0.04 : 0;
    } else if (kind === 'bike') {
      const s = moving ? t * 8 : 0;
      if (this.parts.legL) {
        this.parts.legL.rotation.z = 0.35 + Math.sin(s) * 0.4;
        this.parts.legR.rotation.z = 0.35 - Math.sin(s) * 0.4;
      }
    }
    if (moving && this.wheels.length) {
      const spin = -t * (kind === 'bike' ? 9 : 12);
      for (const w of this.wheels) w.rotation.z = spin;
    }
    this.model.position.y = height;
    this.model.rotation.set(roll, 0, pitch);

    // shadow: stays on the ground, fades and shrinks with altitude
    const fade = kind === 'plane' || kind === 'balloon' ? Math.max(0.25, 1 - height / (px * 1.4)) : 1;
    this.shadow.scale.set(this.footprint[0] * k * 1.15 * fade, 1, this.footprint[1] * k * ex * 1.6 * fade);
    this.shadow.material.opacity = fade;
  }
}

/* --------------------------------------------------------------- layer */

export class VehicleLayer {
  constructor(maplibregl) {
    this.id = 'vehicles';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.Mercator = maplibregl.MercatorCoordinate;
    this.legs = [];
    this.moverState = null;
    this.mover = null;
    this.replaying = false;
    this.day = null;
  }

  onAdd(map, gl) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.scene.add(new THREE.HemisphereLight('#fffaf0', '#7d8794', 2.1));
    const sun = new THREE.DirectionalLight('#ffffff', 2.6);
    sun.position.set(-0.55, 1, 0.45);
    this.scene.add(sun);
    this.rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  }

  /** legs: [{ kind, lngLat, bearing, lift, day, a: [lng,lat], b: [lng,lat] }] */
  setLegs(legs) {
    const old = this.legs;
    this.legs = legs.map((leg, i) => {
      let vehicle = old[i]?.vehicle;
      if (!vehicle || vehicle.kind !== leg.kind) {
        vehicle = new Vehicle(leg.kind);
        this.scene.add(vehicle.root);
      }
      return { ...leg, vehicle };
    });
    const kept = new Set(this.legs.map((l) => l.vehicle));
    for (const leg of old) if (!kept.has(leg.vehicle)) this.scene.remove(leg.vehicle.root);
    this.map?.triggerRepaint();
  }

  setDay(day) {
    this.day = day;
    this.map?.triggerRepaint();
  }

  setReplay(on) {
    this.replaying = on;
    if (!on) this.setMover(null);
    this.map?.triggerRepaint();
  }

  /** state: { kind, lngLat, bearing, lift, moving } or null */
  setMover(state) {
    if (!state) {
      if (this.mover) { this.scene.remove(this.mover.root); this.mover = null; }
      this.moverState = null;
      this.map?.triggerRepaint();
      return;
    }
    if (!this.mover || this.mover.kind !== state.kind) {
      if (this.mover) this.scene.remove(this.mover.root);
      this.mover = new Vehicle(state.kind);
      this.scene.add(this.mover.root);
    }
    this.moverState = state;
  }

  render(gl, args) {
    const map = this.map;
    const zoom = map.getZoom();
    const U = 1 / (512 * 2 ** zoom);
    const center = this.Mercator.fromLngLat(map.getCenter());
    const tiltDeg = Math.max(0, VIEW_ANGLE - map.getPitch());
    const t = performance.now() / 1000;
    const local = (lngLat) => {
      const m = this.Mercator.fromLngLat(lngLat);
      return { x: (m.x - center.x) / U, z: (m.y - center.y) / U };
    };
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const fit = w < 600 ? 0.7 : 1; // phones: smaller vehicles

    for (const leg of this.legs) {
      let show = !this.replaying && (this.day == null || leg.day === this.day);
      if (show) {
        const pa = map.project(leg.a);
        const pb = map.project(leg.b);
        const pm = map.project(leg.lngLat);
        const len = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        show = len > 150 && pm.x > -60 && pm.x < w + 60 && pm.y > -60 && pm.y < h + 60;
      }
      leg.vehicle.root.visible = show;
      if (show) {
        const base = leg.vehicle.base;
        leg.vehicle.pose({ ...local(leg.lngLat), px: base.px * LEG_SCALE * fit, bearing: leg.bearing, lift: leg.lift, tiltDeg, t, moving: false });
      }
    }

    if (this.mover && this.moverState) {
      const s = this.moverState;
      this.mover.root.visible = true;
      this.mover.pose({
        ...local(s.lngLat), px: this.mover.base.px * MOVER_SCALE * fit, bearing: s.bearing, lift: s.lift || 0,
        tiltDeg, t, moving: s.moving, back: s.parked ? this.mover.base.px * MOVER_SCALE * fit * 0.62 + 22 : 0,
      });
    }

    const proj = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
    const frame = new THREE.Matrix4().makeTranslation(center.x, center.y, 0).scale(new THREE.Vector3(U, -U, U)).multiply(this.rotX);
    this.camera.projectionMatrix = proj.multiply(frame);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.mover && this.moverState) map.triggerRepaint();
  }

  onRemove() {
    this.renderer?.dispose();
  }
}
