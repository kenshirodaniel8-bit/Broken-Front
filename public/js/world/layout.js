// The district of Kreuzhafen as plain data. Everything that needs to know
// where things are (meshes, collision, navigation, loot, AI, the map) reads
// from here, so this file has no three.js or DOM dependency.
//
// Axes: +X is east, -Z is north, Y is up. One unit is one metre.

import { makeRng } from '../core/util.js';

export const LINES = [-150, -90, -30, 30, 90, 150];
export const ROAD_HALF = 4.75;
export const STREET_HALF = 7.5;
export const DEPTH = 12;
export const EDGE = 176;
export const FLOOR_H = 3.2;
export const GROUND_H = 4.2;

export const STREET_NAMES = {
  z: { '-150': 'Parkstraße', '-90': 'Kirchstraße', '-30': 'Marktstraße', '30': 'Schillerstraße', '90': 'Bahnhofstraße', '150': 'Gleisstraße' },
  x: { '-150': 'Westring', '-90': 'Goethestraße', '-30': 'Lindenstraße', '30': 'Mozartstraße', '90': 'Feldstraße', '150': 'Ostring' },
};

const PLASTER = ['#d8cdb4', '#c9b48e', '#d6c3a4', '#b9b3a6', '#cfa58a', '#a9b4a0', '#d9d2c4', '#c2a27c', '#b8a690', '#d4b8a8', '#9fa6ad', '#e0d6bf'];

// Special (enterable or landmark) buildings. side: which edge of the block,
// a/b: span along that edge in metres from the block's west/north corner.
const SPECIALS = [
  { block: [1, 2], side: 'e', a: 0, b: 21, type: 'supermarket', name: 'Frischmarkt', sign: 'FRISCHMARKT' },
  { block: [3, 2], side: 'w', a: 0, b: 10.5, type: 'pharmacy', name: 'Löwen-Apotheke', sign: 'APOTHEKE' },
  { block: [3, 2], side: 'w', a: 10.5, b: 21, type: 'apartment', name: 'Wohnhaus Mozartstraße 12', id: 'apt_b' },
  { block: [2, 3], side: 'n', a: 16, b: 32, type: 'electronics', name: 'Elektro Brandt', sign: 'ELEKTRO BRANDT' },
  { block: [3, 3], side: 'n', a: 0, b: 9, type: 'kiosk', name: 'Kiosk am Eck', sign: 'KIOSK' },
  { block: [2, 1], side: 's', a: 14, b: 27, type: 'bakery', name: 'Bäckerei Hofmann', sign: 'BÄCKEREI' },
  { block: [0, 2], side: 'e', a: 0, b: 21, type: 'hardware', name: 'Baumarkt Kessler', sign: 'BAUMARKT' },
  { block: [1, 1], side: 'e', a: 0, b: 21, type: 'police', name: 'Polizeirevier Mitte', sign: 'POLIZEI' },
  { block: [1, 0], side: 's', a: 12, b: 25, type: 'apartment', name: 'Wohnhaus Parkstraße 3', id: 'apt_a' },
  { block: [0, 3], side: 'n', a: 14, b: 27, type: 'apartment', name: 'Wohnhaus Schillerstraße 40', id: 'apt_c' },
  { block: [3, 1], side: 's', a: 20, b: 36, type: 'apartment', name: 'Wohnhaus Marktstraße 7', id: 'apt_d' },
  { block: [3, 4], side: 'n', a: 12, b: 29, type: 'hotel', name: 'Hotel Kreuzhof', sign: 'HOTEL KREUZHOF' },
];

// Blocks that are not ordinary perimeter blocks.
const SPECIAL_BLOCKS = {
  '2,2': 'plaza', '2,0': 'park', '3,1': 'church', '4,1': 'parking', '1,3': 'gym', '0,4': 'firestation', '2,4': 'station',
};

// Streets cut by rubble after the strike: [axis, line, along-street centre, half-length].
// axis 'x' = a north-south street at x=line; 'z' = an east-west street at z=line.
export const BLOCKED_STREETS = [
  ['x', -30, -42, 4], ['z', 90, -60, 5], ['x', -90, 60, 5], ['x', 90, -60, 5],
  ['z', -90, 60, 5], ['z', -30, -120, 5], ['x', 150, 60, 5], ['z', 150, 60, 5],
];

export function blockBounds(col, row) {
  return { x0: LINES[col] + STREET_HALF, x1: LINES[col + 1] - STREET_HALF, z0: LINES[row] + STREET_HALF, z1: LINES[row + 1] - STREET_HALF };
}

export function generateLayout(seed = 'kreuzhafen') {
  const rng = makeRng(seed);
  const L = {
    seed, edge: EDGE, lines: LINES, buildings: [], interiors: [], blocks: [], props: {
      cars: [], lamps: [], trees: [], benches: [], bins: [], busStops: [], signs: [], hydrants: [], fountains: [], stalls: [],
    },
    containers: [], structures: [], solids: [], poi: [], ramps: [], climbs: [], waterSources: [], chargeSpots: [], debrisSites: [],
    coverPoints: [], patrolRoutes: {}, passages: [],
  };
  let bid = 0;
  const addBuilding = (b) => {
    const out = {
      floors: 4, roof: 'pitched', style: 0, color: PLASTER[0], enterable: false,
      damage: 0, collapse: false, shopFront: false, ...b, id: b.id || `b${bid++}`,
    };
    out.h = out.h || GROUND_H + (out.floors - 1) * FLOOR_H;
    L.buildings.push(out);
    return out;
  };

  // --- Blocks ---------------------------------------------------------------
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const bb = blockBounds(col, row);
      const kind = SPECIAL_BLOCKS[`${col},${row}`] || 'residential';
      L.blocks.push({ col, row, ...bb, kind });
      if (kind === 'residential' || kind === 'church') buildPerimeter(L, rng, col, row, bb, kind, addBuilding);
    }
  }
  buildSpecialBlocks(L, rng, addBuilding);
  buildEdgeRing(L, rng, addBuilding);
  markDamage(L, rng);
  buildInteriors(L, rng);
  buildStreetProps(L, rng);
  buildPoi(L);
  buildRoutes(L);
  return L;
}

// Splits a length into building widths of roughly 10-17 m.
function splitWidths(rng, total) {
  const out = [];
  let left = total;
  while (left > 0) {
    if (left < 20) { out.push(left); break; }
    const w = rng.range(10, 17);
    out.push(w);
    left -= w;
  }
  return out;
}

function sideRect(bb, side, a, b) {
  switch (side) {
    case 'n': return { x0: bb.x0 + a, x1: bb.x0 + b, z0: bb.z0, z1: bb.z0 + DEPTH };
    case 's': return { x0: bb.x0 + a, x1: bb.x0 + b, z0: bb.z1 - DEPTH, z1: bb.z1 };
    case 'w': return { x0: bb.x0, x1: bb.x0 + DEPTH, z0: bb.z0 + DEPTH + a, z1: bb.z0 + DEPTH + b };
    default: return { x0: bb.x1 - DEPTH, x1: bb.x1, z0: bb.z0 + DEPTH + a, z1: bb.z0 + DEPTH + b };
  }
}

function buildPerimeter(L, rng, col, row, bb, kind, addBuilding) {
  const width = bb.x1 - bb.x0;
  const sideLen = { n: width, s: width, w: bb.z1 - bb.z0 - 2 * DEPTH, e: bb.z1 - bb.z0 - 2 * DEPTH };
  const sides = kind === 'church' ? ['n', 'e', 's'] : ['n', 's', 'w', 'e'];
  // Courtyard passages (archways) on two opposite sides of some blocks give
  // alternative routes once streets are blocked.
  const passageSides = rng.chance(0.6) ? (rng.chance(0.5) ? ['n', 's'] : ['w', 'e']) : [];
  for (const side of sides) {
    const specials = SPECIALS.filter((s) => s.block[0] === col && s.block[1] === row && s.side === side);
    // Fill the side with ordinary houses, leaving gaps for specials.
    const spans = [];
    let cursor = 0;
    const sorted = [...specials].sort((p, q) => p.a - q.a);
    for (const s of sorted) {
      if (s.a > cursor) spans.push([cursor, s.a]);
      cursor = s.b;
    }
    if (cursor < sideLen[side]) spans.push([cursor, sideLen[side]]);
    if (kind === 'church' && side === 's') spans.splice(0, spans.length, [0, 10]); // churchyard opens to Marktstraße
    for (const s of sorted) {
      const r = sideRect(bb, side, s.a, s.b);
      addBuilding({
        id: s.id || s.type, ...r, block: [col, row], side, floors: s.type === 'kiosk' ? 2 : rng.int(3, 5), style: rng.int(0, 5),
        color: rng.pick(PLASTER), roof: rng.pick(['pitched', 'mansard', 'flat']), enterable: true, type: s.type,
        name: s.name, sign: s.sign, shopFront: !!s.sign,
      });
    }
    let passageDone = !passageSides.includes(side);
    for (const [a, b] of spans) {
      let pos = a;
      for (const w of splitWidths(rng, b - a)) {
        const r = sideRect(bb, side, pos, pos + w);
        const floors = rng.int(3, 6);
        const bld = addBuilding({
          ...r, block: [col, row], side, floors, style: rng.int(0, 5), color: rng.pick(PLASTER),
          roof: rng.pick(['pitched', 'pitched', 'mansard', 'flat']), shopFront: rng.chance(0.35),
        });
        if (!passageDone && w >= 11) {
          passageDone = true;
          bld.passage = { width: 3.4, height: 3.6 };
          L.passages.push({ building: bld.id, side });
        }
        pos += w;
      }
    }
  }
}

function buildSpecialBlocks(L, rng, addBuilding) {
  // Marktplatz with the Rathaus on its north side.
  const plaza = blockBounds(2, 2);
  addBuilding({
    id: 'rathaus', x0: -16, x1: 16, z0: plaza.z0, z1: -9, floors: 4, h: 17, style: 6, color: '#cdb79a', roof: 'mansard',
    enterable: true, type: 'townhall', name: 'Rathaus', sign: 'RATHAUS', tower: { x: 0, z: -15.5, w: 6, h: 32 }, door: { side: 's', at: 0, width: 3 },
  });
  L.props.fountains.push({ x: 0, z: 8, r: 3.2 });
  L.waterSources.push({ id: 'fountain', x: 0, z: 8, r: 4.2, name: 'Marktbrunnen (fountain)' });
  for (const [x, z] of [[-14, 0], [14, 0], [-14, 16], [14, 16], [-6, 18], [6, 18]]) L.props.trees.push({ x, z, s: 1.1 });
  for (const [x, z, yaw] of [[-8, 4, 0], [8, 4, 0], [-8, 12, Math.PI], [8, 12, Math.PI], [0, -2, Math.PI / 2]]) L.props.benches.push({ x, z, yaw });
  for (const [x, z] of [[-10, -3], [-4, -4], [4, -4], [10, -3]]) L.props.stalls.push({ x, z });

  // Stadtpark: open lawn, trees, paths. The rescue helicopter lands here.
  const park = blockBounds(2, 0);
  for (let i = 0; i < 34; i++) {
    const x = rng.range(park.x0 + 2, park.x1 - 2);
    const z = rng.range(park.z0 + 2, park.z1 - 2);
    if (Math.hypot(x - 0, z + 120) < 15) continue;
    L.props.trees.push({ x, z, s: rng.range(1.0, 1.6) });
  }
  for (const [x, z, yaw] of [[-12, -106, 0], [12, -106, 0], [-12, -134, Math.PI], [12, -134, Math.PI]]) L.props.benches.push({ x, z, yaw });
  L.lz = { x: 0, z: -120, r: 11 };

  // St. Marien: nave plus a bell tower that can be climbed for signal.
  addBuilding({
    id: 'church', x0: 46, x1: 70, z0: -68, z1: -54, floors: 3, h: 15, style: 7, color: '#b0a08a', roof: 'pitched',
    enterable: true, type: 'church', name: 'St. Marien', door: { side: 's', at: 4, width: 2.6 }, ridge: 'x',
  });
  addBuilding({ id: 'church_tower', x0: 39, x1: 46, z0: -64.5, z1: -57.5, floors: 7, h: 24, style: 7, color: '#aa9a84', roof: 'belfry', type: 'tower' });
  L.climbs.push({ id: 'tower', name: 'bell tower', x: 47.2, z: -61, top: { x: 42.5, y: 24, z: -61 }, bottom: { x: 47.4, y: 0, z: -61 } });
  // Railing around the top of the tower.
  for (const r of [[39, 46, -64.5, -64.2], [39, 46, -57.8, -57.5], [39, 39.3, -64.5, -57.5], [45.7, 46, -64.5, -57.5]]) {
    L.solids.push({ x0: r[0], x1: r[1], z0: r[2], z1: r[3], y0: 24, y1: 25.1, mat: 'stone' });
  }

  // Parkhaus: three-level garage with ramps; the roof gets phone signal.
  const pk = { x0: 100, x1: 140, z0: -80, z1: -40 };
  L.parking = pk;
  L.structures.push({ type: 'parking', ...pk });
  addParkingSolids(L, pk);
  L.ramps.push({ x0: 134, x1: 140, z0: -74, z1: -46, axis: 'z', hAtZ0: 4, hAtZ1: 0 });
  L.ramps.push({ x0: 100, x1: 106, z0: -74, z1: -46, axis: 'z', hAtZ0: 4, hAtZ1: 8 });
  L.interiors.push({ id: 'parking_office', building: null, x0: 100.2, x1: 111, z0: -49.5, z1: -40.2, type: 'parking_office', name: 'Parkhaus office', y: 0 });
  for (let i = 0; i < 9; i++) {
    const level = i % 3;
    L.props.cars.push({ x: 112 + (i % 4) * 5.5, z: -60 + (i % 2 ? 9 : -9), y: level * 4, yaw: Math.PI / 2, color: rng.int(0, 7), parked: true, garage: true });
  }
  L.chargeSpots.push({ id: 'garage_car', x: 109.4, z: -69, y: 0, name: 'car with a working battery' });

  // Turnhalle (school gym): candidate shelter.
  addBuilding({
    id: 'gym', x0: -76, x1: -46, z0: 45, z1: 71, floors: 2, h: 9, style: 8, color: '#c7c2b4', roof: 'flat', enterable: true,
    type: 'gym', name: 'Turnhalle Schiller-Schule', sign: 'SCHILLER-SCHULE', door: { side: 'n', at: 0, width: 2.6 },
  });
  addBuilding({ id: 'school', x0: -82.5, x1: -37.5, z0: 75, z1: 82.5, floors: 3, style: 8, color: '#d2c9b0', roof: 'flat' });

  // Feuerwache (fire station).
  addBuilding({
    id: 'firestation', x0: -140, x1: -112, z0: 106, z1: 126, floors: 2, h: 9, style: 9, color: '#b5452e', roof: 'flat', enterable: true,
    type: 'firestation', name: 'Feuerwache 2', sign: 'FEUERWEHR', door: { side: 'n', at: 6, width: 4.2 }, tower: { x: -136, z: 122, w: 4, h: 20 },
  });
  addBuilding({ x0: -142.5, x1: -97.5, z0: 130.5, z1: 142.5, floors: 4, style: 2, color: '#c9b48e', roof: 'pitched', block: [0, 4], side: 's' });

  // Hauptbahnhof.
  addBuilding({
    id: 'station', x0: -20, x1: 20, z0: 100, z1: 126, floors: 3, h: 15, style: 10, color: '#b9a98e', roof: 'barrel', enterable: true,
    type: 'station', name: 'Hauptbahnhof', sign: 'HAUPTBAHNHOF', door: { side: 'n', at: 0, width: 4 }, ridge: 'x',
  });
  addBuilding({ x0: -22.5, x1: -12, z0: 128, z1: 142.5, floors: 3, style: 3, color: '#b8a690', block: [2, 4], side: 's' });
  addBuilding({ x0: 12, x1: 22.5, z0: 128, z1: 142.5, floors: 4, style: 1, color: '#c2a27c', block: [2, 4], side: 's' });
}

function buildEdgeRing(L, rng, addBuilding) {
  // Tall buildings close off the district on every side.
  const inner = LINES[5] + STREET_HALF;
  const outer = EDGE;
  const mk = (x0, x1, z0, z1) => addBuilding({
    x0, x1, z0, z1, floors: rng.int(4, 6), style: rng.int(0, 5), color: rng.pick(PLASTER), roof: rng.pick(['pitched', 'mansard']), edge: true,
  });
  for (const sgn of [-1, 1]) {
    let p = -outer;
    for (const w of splitWidths(rng, outer * 2)) {
      if (sgn < 0) mk(p, p + w, -outer, -inner); else mk(p, p + w, inner, outer);
      p += w;
    }
    p = -inner;
    for (const w of splitWidths(rng, inner * 2)) {
      if (sgn < 0) mk(-outer, -inner, p, p + w); else mk(inner, outer, p, p + w);
      p += w;
    }
  }
}

// Which buildings are wrecked once the strike hits. The four buildings around
// the player at the moment of the blast are picked at runtime; these are the
// rest of the city.
function markDamage(L, rng) {
  for (const b of L.buildings) {
    if (b.enterable || b.type === 'tower' || b.id === 'school') { b.damage = rng.int(1, 2); continue; }
    const r = rng();
    if (r < 0.13 && !b.edge) { b.collapse = true; b.damage = 3; } else b.damage = r < 0.55 ? 1 : 2;
  }
  L.buildings.find((b) => b.id === 'apt_d').damage = 3; // Dimas is trapped in its broken ground floor
}

// Ground-floor rooms of enterable buildings, with furniture and containers.
// Furniture is placed in a door-relative frame: u runs along the door wall,
// v runs inward from it. A corridor in front of the door is always kept clear.
function buildInteriors(L, rng) {
  let cid = 0;
  for (const b of L.buildings) {
    if (!b.enterable) continue;
    if (!b.door) b.door = { side: b.side, at: 0, width: 2.2 };
    const inset = 0.35;
    const it = {
      id: b.id, building: b.id, type: b.type, name: b.name, x0: b.x0 + inset, x1: b.x1 - inset, z0: b.z0 + inset, z1: b.z1 - inset,
      height: Math.min(b.h - 0.6, b.type === 'station' || b.type === 'church' || b.type === 'gym' ? 9 : 3.8), furniture: [],
    };
    L.interiors.push(it);
    const side = b.door.side;
    const alongX = side === 'n' || side === 's';
    const U = alongX ? it.x1 - it.x0 : it.z1 - it.z0;
    const V = alongX ? it.z1 - it.z0 : it.x1 - it.x0;
    const uDoor = U / 2 + b.door.at;
    const toWorld = (u, v) => {
      switch (side) {
        case 'n': return [it.x0 + u, it.z0 + v];
        case 's': return [it.x0 + u, it.z1 - v];
        case 'w': return [it.x0 + v, it.z0 + u];
        default: return [it.x1 - v, it.z0 + u];
      }
    };
    it.local = { side, U, V, uDoor };
    const F = (kind, u, v, su, sv, h) => {
      // Keep the entrance clear.
      if (Math.abs(u - uDoor) < su / 2 + 1.5 && v - sv / 2 < 3.2) return;
      const [x, z] = toWorld(u, v);
      it.furniture.push({ kind, x, z, sx: alongX ? su : sv, sz: alongX ? sv : su, h, yaw: alongX ? 0 : Math.PI / 2 });
    };
    const C = (kind, u, v, table, extra = {}) => {
      const [x, z] = toWorld(u, v);
      L.containers.push({ id: `c${cid++}_${it.id}`, interior: it.id, kind, x, z, y: 0, table, fixed: extra.fixed || null, name: extra.name });
    };
    // Shelving aisles perpendicular to the door wall, skipping the door aisle.
    const aisles = (n, table, h = 2.0, kind = 'shelf') => {
      for (let i = 0; i < n; i++) {
        const u = U * (0.14 + (0.72 * i) / Math.max(1, n - 1));
        if (Math.abs(u - uDoor) < 2.2) continue;
        F(kind, u, V * 0.58, 0.7, V * 0.5, h);
        C(kind, u + 0.75, V * (0.4 + rng() * 0.3), table);
      }
    };
    switch (b.type) {
      case 'supermarket':
        aisles(5, 'supermarket_food');
        F('fridge', U / 2, V - 0.5, U * 0.75, 0.9, 2.1);
        C('fridge', U * 0.3, V - 1.3, 'supermarket_drinks', { name: 'drinks fridge' });
        C('fridge', U * 0.7, V - 1.3, 'supermarket_drinks', { name: 'drinks fridge' });
        C('crate', U - 1.2, V - 1.4, 'supermarket_storage', { name: 'stockroom pallet' });
        break;
      case 'pharmacy':
        F('counter', U * 0.5, V * 0.55, U * 0.55, 0.9, 1.1);
        F('shelf', U * 0.5, V - 0.4, U * 0.8, 0.6, 2.2);
        C('medcab', U * 0.3, V - 1.1, 'pharmacy', { name: 'medicine cabinet' });
        C('medcab', U * 0.7, V - 1.1, 'pharmacy', { name: 'medicine cabinet' });
        C('counter', U * 0.5, V * 0.55 - 0.9, 'pharmacy_counter', { name: 'pharmacy counter' });
        break;
      case 'electronics':
        F('display', U * 0.22, V * 0.45, 2.4, 1.2, 0.9);
        F('display', U * 0.78, V * 0.45, 2.4, 1.2, 0.9);
        C('display', U * 0.22, V * 0.45 + 1, 'electronics');
        C('display', U * 0.78, V * 0.45 + 1, 'electronics');
        F('shelf', U * 0.5, V - 0.4, U * 0.8, 0.6, 2.2);
        C('cabinet', U * 0.2, V - 1.1, 'electronics_storage', { name: 'storage cabinet', fixed: [['usb_cable', 1], ['earphones', 1], ['speaker_module', 1]] });
        C('crate', U * 0.8, V - 1.1, 'electronics_storage', { name: 'returns shelf', fixed: [['drone', 1]] });
        break;
      case 'kiosk':
        F('counter', U * 0.5, V * 0.5, U * 0.55, 0.8, 1.1);
        C('counter', U * 0.5, V * 0.5 - 0.8, 'kiosk', { name: 'kiosk counter', fixed: [['sim_tool', 2], ['earphones', 1]] });
        C('fridge', U * 0.8, V - 0.9, 'supermarket_drinks', { name: 'drinks fridge' });
        break;
      case 'bakery':
        F('counter', U * 0.5, V * 0.5, U * 0.6, 1, 1.1);
        C('counter', U * 0.5, V * 0.5 - 0.9, 'bakery', { name: 'bakery counter' });
        C('cabinet', U * 0.2, V - 1, 'kitchen', { name: 'back room shelf' });
        break;
      case 'hardware':
        aisles(4, 'hardware', 2.3);
        C('crate', U - 1.2, V - 1.2, 'hardware', { name: 'tool rack', fixed: [['crowbar', 1], ['antenna_wire', 1], ['solar_charger', 1]] });
        break;
      case 'police':
        F('desk', U * 0.3, V * 0.4, 1.6, 0.8, 0.78);
        F('desk', U * 0.7, V * 0.4, 1.6, 0.8, 0.78);
        F('locker', U * 0.5, V - 0.35, U * 0.5, 0.6, 2);
        C('locker', U * 0.4, V - 1.0, 'police', { name: 'equipment locker', fixed: [['field_radio', 1], ['freq_card', 1]] });
        C('locker', U * 0.6, V - 1.0, 'police', { name: 'armour locker', fixed: [['g_vest_police', 1], ['first_aid_kit', 1]] });
        C('desk', U * 0.3, V * 0.4 - 0.8, 'office', { name: 'desk' });
        break;
      case 'apartment': {
        F('table', U * 0.5, V * 0.6, 1.4, 0.9, 0.75);
        F('wardrobe', U * 0.12, V - 0.4, 1.8, 0.6, 2.1);
        F('kitchen', U * 0.85, V - 0.35, 2.4, 0.6, 0.9);
        const fixed = b.id === 'apt_a' ? [['crank_charger', 1]] : b.id === 'apt_b' ? [['spare_phone', 1], ['usb_cable', 1]] : b.id === 'apt_c' ? [['phone_battery', 1]] : [['painkillers', 2]];
        C('cabinet', U * 0.85, V - 1.1, 'kitchen', { name: 'kitchen cupboard' });
        C('wardrobe', U * 0.12, V - 1.1, 'apartment', { name: 'wardrobe', fixed });
        C('desk', U * 0.5, V * 0.6 - 0.9, 'apartment', { name: 'table drawer' });
        break;
      }
      case 'hotel':
        F('counter', U * 0.78, V * 0.4, U * 0.3, 0.8, 1.1);
        C('cabinet', U * 0.78, V * 0.4 + 0.9, 'office', { name: 'reception desk', fixed: [['car_charger', 1]] });
        C('luggage', U * 0.25, V * 0.6, 'luggage', { name: 'abandoned suitcase' });
        C('luggage', U * 0.4, V * 0.8, 'luggage', { name: 'abandoned suitcase' });
        break;
      case 'townhall':
        F('desk', U * 0.25, V * 0.5, 2, 1, 0.8);
        F('desk', U * 0.75, V * 0.5, 2, 1, 0.8);
        C('crate', U * 0.75, V * 0.5 + 1.1, 'security', { name: 'security detail case', fixed: [['sat_phone', 1]] });
        C('desk', U * 0.25, V * 0.5 + 1.1, 'office', { name: 'office desk' });
        break;
      case 'church':
        for (let i = 0; i < 5; i++) {
          F('pew', 5 + i * 3.3, V / 2 - 2.6, 0.6, 3.6, 0.9);
          F('pew', 5 + i * 3.3, V / 2 + 2.6, 0.6, 3.6, 0.9);
        }
        F('altar', U - 1.5, V / 2, 1.2, 2.5, 1.1);
        C('cabinet', U - 1.4, V - 1.4, 'church', { name: 'sacristy cupboard' });
        break;
      case 'gym':
        F('mats', U * 0.3, V * 0.6, 6, 3, 0.35);
        C('crate', U - 1.5, V - 1.5, 'gym', { name: 'storage room' });
        C('cabinet', 1.2, V - 1.2, 'shelter_supplies', { name: 'emergency supply cabinet' });
        break;
      case 'firestation':
        F('truck', U * 0.25, V * 0.5, 3, 8, 3.2);
        F('shelf', U * 0.6, V - 0.4, U * 0.3, 0.7, 2.2);
        C('locker', U * 0.52, V - 1.2, 'firestation', { name: 'equipment shelf', fixed: [['car_jack', 1], ['g_helmet_fire', 1]] });
        C('medcab', U * 0.68, V - 1.2, 'pharmacy', { name: 'paramedic cabinet', fixed: [['first_aid_kit', 1]] });
        break;
      case 'station':
        for (let i = 0; i < 4; i++) F('bench', U * (0.2 + i * 0.2), V * 0.6, 3, 0.6, 0.5);
        C('vending', 1.2, V * 0.3, 'vending', { name: 'vending machine' });
        C('vending', U - 1.2, V * 0.3, 'vending', { name: 'vending machine' });
        C('locker', U * 0.5, V - 1, 'luggage', { name: 'luggage lockers' });
        C('luggage', U * 0.3, V * 0.8, 'luggage', { name: 'abandoned suitcase' });
        break;
      default: break;
    }
  }
  const office = L.interiors.find((i) => i.id === 'parking_office');
  office.furniture = [{ kind: 'desk', x: 104, z: -42, sx: 1.6, sz: 0.8, h: 0.78, yaw: 0 }];
  L.containers.push({ id: 'c_parking_office', interior: office.id, kind: 'desk', x: 104, z: -43, y: 0, table: 'office', name: 'attendant desk' });
}

// Converts door-relative interior coordinates to world coordinates.
export function interiorPoint(it, u, v) {
  const { side } = it.local;
  switch (side) {
    case 'n': return { x: it.x0 + u, z: it.z0 + v };
    case 's': return { x: it.x0 + u, z: it.z1 - v };
    case 'w': return { x: it.x0 + v, z: it.z0 + u };
    default: return { x: it.x1 - v, z: it.z0 + u };
  }
}

function buildStreetProps(L, rng) {
  const P = L.props;
  const inRect = (x, z, r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i];
    for (const axis of ['x', 'z']) {
      // Walk along the street between the outer lines.
      for (let s = LINES[0] + 10; s < LINES[5] - 10; s += 1) {
        const nearCross = LINES.some((c) => Math.abs(s - c) < STREET_HALF + 3);
        if (nearCross) continue;
        const pos = (off) => (axis === 'x' ? [line + off, s] : [s, line + off]);
        if (Math.round(s) % 24 === 0) {
          for (const side of [-1, 1]) P.lamps.push({ ...xz(pos(side * 6.9)), yaw: axis === 'x' ? (side < 0 ? -Math.PI / 2 : Math.PI / 2) : side < 0 ? Math.PI : 0 });
        }
        if (Math.round(s) % 16 === 8 && (i === 2 || i === 3 || i === 4) && axis === 'z') {
          for (const side of [-1, 1]) P.trees.push({ ...xz(pos(side * 6.4)), s: rng.range(0.85, 1.15), street: true });
        }
        if (Math.round(s) % 11 === 0 && rng.chance(0.55)) {
          const side = rng.chance(0.5) ? -1 : 1;
          const [x, z] = pos(side * 3.7);
          const yaw = axis === 'x' ? (side < 0 ? Math.PI : 0) : side < 0 ? Math.PI / 2 : -Math.PI / 2;
          P.cars.push({ x, z, yaw: yaw + rng.range(-0.04, 0.04), color: rng.int(0, 7), parked: true, type: rng.pick(['sedan', 'sedan', 'hatch', 'van']) });
        }
        if (Math.round(s) % 37 === 5) P.bins.push({ ...xz(pos((rng.chance(0.5) ? -1 : 1) * 6.4)) });
      }
    }
  }
  // Keep cars out of buildings and out of the street segments rubble will bury.
  const buried = blockedRects().map((r) => ({ x0: r.x0 - 3, x1: r.x1 + 3, z0: r.z0 - 3, z1: r.z1 + 3 }));
  P.cars = P.cars.filter((c) => c.garage || (!L.buildings.some((b) => inRect(c.x, c.z, b)) && !buried.some((r) => inRect(c.x, c.z, r))));
  // Bus stop and the squad's bus on Bahnhofstraße.
  P.busStops.push({ x: 46, z: 83.2, yaw: Math.PI });
  L.bus = { x: 46, z: 87.3, yaw: -Math.PI / 2 };
  P.cars = P.cars.filter((c) => !(Math.abs(c.z - 87) < 4 && c.x > 34 && c.x < 62));
  // The squad vehicle, parked at the plaza where they arrived.
  L.squadVan = { x: -26.3, z: -12, yaw: 0 };
  P.cars = P.cars.filter((c) => Math.hypot(c.x - L.squadVan.x, c.z - L.squadVan.z) > 7);
  L.containers.push({ id: 'c_squadvan', kind: 'trunk', x: -26.3, z: -9.2, y: 0, table: 'squadvan', name: 'squad vehicle (wreck)', fixed: [['mre', 3], ['emergency_card', 1], ['drone_battery', 1]] });
  // Some parked cars have something in the boot.
  let trunks = 0;
  for (const c of P.cars) {
    if (c.garage || rng() > 0.18) continue;
    const bx = c.x - Math.sin(c.yaw) * -2.4;
    const bz = c.z - Math.cos(c.yaw) * -2.4;
    L.containers.push({ id: `c_trunk${trunks++}`, kind: 'trunk', x: bx, z: bz, y: 0, table: 'car', name: 'car boot', car: c });
  }
  for (const c of P.cars.filter((k) => k.garage)) {
    L.containers.push({ id: `c_gtrunk${trunks++}`, kind: 'trunk', x: c.x - 2.4, z: c.z, y: c.y, table: 'car', name: 'car boot', car: c });
  }
  // Broken water main: unsafe water.
  L.waterSources.push({ id: 'pipe', x: -60, z: 30, r: 3, name: 'broken water main', dirty: true });
  P.cars = P.cars.filter((c) => c.garage || Math.hypot(c.x - 64, c.z + 26.3) > 8);
  P.cars.push({ x: 64, z: -26.3, yaw: -Math.PI / 2, color: 7, parked: true, type: 'van' });
  L.chargeSpots.push({ id: 'street_car', x: 66.6, z: -26.3, y: 0, name: 'delivery van with a working battery' });
  // Debris sites block a doorway until cleared (hold E; a crowbar is faster).
  L.debrisSites.push({ id: 'fire_door', x: -120, z: 105.3, w: 4.4, d: 1.4, name: 'debris in the garage door', time: 8 });
  // Cover points: next to building corners along every street.
  for (const b of L.buildings) {
    if (b.edge) continue;
    for (const [x, z] of [[b.x0 - 0.8, b.z0 - 0.8], [b.x1 + 0.8, b.z0 - 0.8], [b.x0 - 0.8, b.z1 + 0.8], [b.x1 + 0.8, b.z1 + 0.8]]) {
      if (!L.buildings.some((o) => inRect(x, z, o))) L.coverPoints.push({ x, z });
    }
  }
  for (const c of P.cars) if (!c.garage) L.coverPoints.push({ x: c.x + Math.cos(c.yaw) * 1.6, z: c.z - Math.sin(c.yaw) * 1.6 });
}

function xz([x, z]) { return { x, z }; }

function buildPoi(L) {
  const center = (id) => {
    const b = L.buildings.find((k) => k.id === id);
    return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  };
  const byType = (t) => L.buildings.find((b) => b.type === t);
  const mid = (b) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
  L.poi = [
    { id: 'rathaus', name: 'Rathaus', ...center('rathaus'), landmark: true },
    { id: 'marktplatz', name: 'Marktplatz', x: 0, z: 8, landmark: true },
    { id: 'church', name: 'St. Marien', ...center('church'), landmark: true },
    { id: 'park', name: 'Stadtpark', x: 0, z: -120, landmark: true },
    { id: 'station', name: 'Hauptbahnhof', ...center('station'), landmark: true },
    { id: 'firestation', name: 'Feuerwache', ...center('firestation'), landmark: true },
    { id: 'police', name: 'Polizei', ...mid(byType('police')) },
    { id: 'parking', name: 'Parkhaus', x: 120, z: -60, landmark: true },
    { id: 'gym', name: 'Turnhalle', ...center('gym') },
    { id: 'pharmacy', name: 'Apotheke', ...mid(byType('pharmacy')) },
    { id: 'supermarket', name: 'Frischmarkt', ...mid(byType('supermarket')) },
    { id: 'electronics', name: 'Elektro Brandt', ...mid(byType('electronics')) },
    { id: 'hardware', name: 'Baumarkt', ...mid(byType('hardware')) },
    { id: 'kiosk', name: 'Kiosk', ...mid(byType('kiosk')) },
    { id: 'bakery', name: 'Bäckerei', ...mid(byType('bakery')) },
    { id: 'hotel', name: 'Hotel Kreuzhof', ...mid(byType('hotel')) },
  ];
  // Where teammates end up after the blast (true positions; the player only
  // learns approximate areas from clues).
  const pharm = L.interiors.find((i) => i.type === 'pharmacy');
  const aptD = L.interiors.find((i) => i.id === 'apt_d');
  L.teammateSpots = {
    rizky: { x: 27.6, z: 73, pose: 'trapped', label: 'Mozartstraße' },
    sari: { ...interiorPoint(pharm, pharm.local.U * 0.2, pharm.local.V * 0.3), pose: 'sitting', label: 'Apotheke' },
    dimas: { ...interiorPoint(aptD, aptD.local.U * 0.3, aptD.local.V * 0.35), pose: 'unconscious', label: 'near St. Marien' },
    bima: { x: -118, z: 101.5, pose: 'trapped', label: 'Feuerwache forecourt' },
  };
  L.shelters = [
    { id: 'gym', name: 'Turnhalle (school gym)', x: -61, z: 58, setup: { x: -61, z: 48 }, interior: 'gym', desc: 'Big, central, close to shops. Easy to find - for everyone.' },
    { id: 'parking', name: 'Parkhaus (garage office)', x: 105.5, z: -45, setup: { x: 106, z: -45 }, interior: 'parking_office', desc: 'Small and hidden, far from supplies. Roof has phone signal.' },
  ];
  L.playerAfterBlast = { x: 30.5, z: 58, yaw: Math.PI };
  L.playerArrival = { x: -21, z: -13, yaw: -Math.PI / 2 };
}

function buildRoutes(L) {
  const loop = (pts) => pts.map(([x, z]) => ({ x, z }));
  L.patrolRoutes = {
    plaza: loop([[-30, -30], [30, -30], [30, 30], [-30, 30]]),
    bahnhof: loop([[-30, 90], [90, 90], [90, 30], [30, 30], [30, 90]]),
    north: loop([[-30, -90], [90, -90], [90, -30], [30, -30], [30, -90]]),
    west: loop([[-150, -30], [-90, -30], [-90, 30], [-150, 30]]),
    southwest: loop([[-150, 30], [-150, 90], [-90, 90], [-90, 30]]),
    east: loop([[90, -30], [150, -30], [150, 90], [90, 90]]),
    park: loop([[-30, -150], [30, -150], [30, -90], [-30, -90]]),
    gym: loop([[-90, 30], [-30, 30], [-30, 90], [-90, 90]]),
    parking: loop([[90, -90], [150, -90], [150, -30], [90, -30]]),
  };
  L.enemySpawns = [{ x: -150, z: -150 }, { x: 150, z: -150 }, { x: 150, z: 150 }, { x: -150, z: 150 }, { x: 150, z: 0 }, { x: -150, z: 0 }];
}

// Columns, decks, parapets and walls of the multi-storey car park. Shared by
// collision and rendering so they always match.
function addParkingSolids(L, pk) {
  const S = (x0, x1, y0, y1, z0, z1, mat = 'concrete') => L.solids.push({ x0, x1, y0, y1, z0, z1, mat });
  const inRamp = (x, z) => L.ramps.some((r) => x > r.x0 - 0.5 && x < r.x1 + 0.5 && z > r.z0 && z < r.z1);
  for (const x of [100.3, 110, 120, 130, 139.7]) {
    for (const z of [-79.7, -70, -60, -50, -40.3]) {
      if (!inRamp(x, z)) S(x - 0.3, x + 0.3, 0, 8, z - 0.3, z + 0.3);
    }
  }
  // Deck 1 (top at y=4) with the opening for ramp 1, roof (y=8) with the opening for ramp 2.
  S(100, 134, 3.7, 4, -80, -40);
  S(134, 140, 3.7, 4, -80, -74);
  S(134, 140, 3.7, 4, -46, -40);
  S(106, 140, 7.7, 8, -80, -40);
  S(100, 106, 7.7, 8, -80, -74);
  S(100, 106, 7.7, 8, -46, -40);
  for (const y of [4, 8]) {
    S(100, 140, y, y + 1.1, -80, -79.7);
    S(100, 140, y, y + 1.1, -40.3, -40);
    S(100, 100.3, y, y + 1.1, -80, -40);
    S(139.7, 140, y, y + 1.1, -80, -40);
  }
  // Ground floor: low walls, entrance on the south side.
  S(100, 140, 0, 1, -80, -79.7);
  S(100, 100.3, 0, 3.7, -80, -40);
  S(139.7, 140, 0, 1, -80, -40);
  S(100, 112, 0, 3.7, -40.3, -40);
  S(128, 140, 0, 1, -40.3, -40);
  // Attendant's office in the south-west corner (door to the garage on its north side).
  S(100, 103.5, 0, 3.7, -49.8, -49.5);
  S(105.7, 111.3, 0, 3.7, -49.8, -49.5);
  S(111, 111.3, 0, 3.7, -49.8, -40);
}

// Blocked street segments as rectangles (post-strike).
export function blockedRects() {
  return BLOCKED_STREETS.map(([axis, line, at, half]) => (axis === 'x'
    ? { x0: line - STREET_HALF, x1: line + STREET_HALF, z0: at - half, z1: at + half, axis, line, at }
    : { x0: at - half, x1: at + half, z0: line - STREET_HALF, z1: line + STREET_HALF, axis, line, at }));
}

export function streetNameAt(x, z) {
  for (const line of LINES) {
    if (Math.abs(x - line) <= STREET_HALF) return STREET_NAMES.x[String(line)];
    if (Math.abs(z - line) <= STREET_HALF) return STREET_NAMES.z[String(line)];
  }
  return null;
}

const PROTECTED = new Set(['rathaus', 'church', 'church_tower', 'gym', 'school', 'station', 'firestation']);

// The four buildings hit around the player when the strike lands: front,
// right, rear and left relative to where they are looking. A direction with
// no building in reach gets a street blast point instead.
export function pickBlastTargets(L, x, z, yaw) {
  const out = [];
  const used = new Set();
  const dirs = [['front', 0], ['right', -Math.PI / 2], ['rear', Math.PI], ['left', Math.PI / 2]];
  for (const [name, off] of dirs) {
    const a = yaw + off;
    const dx = -Math.sin(a);
    const dz = -Math.cos(a);
    let best = null;
    let bestD = Infinity;
    for (const b of L.buildings) {
      if (b.enterable || b.edge || PROTECTED.has(b.id) || used.has(b.id)) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1));
      const cz = Math.max(b.z0, Math.min(z, b.z1));
      const d = Math.hypot(cx - x, cz - z);
      if (d > 38 || d < 1) continue;
      const mx = (b.x0 + b.x1) / 2 - x;
      const mz = (b.z0 + b.z1) / 2 - z;
      const cos = (mx * dx + mz * dz) / (Math.hypot(mx, mz) || 1);
      if (cos < Math.cos((50 * Math.PI) / 180)) continue;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      used.add(best.id);
      out.push({ dir: name, building: best.id, x: (best.x0 + best.x1) / 2, z: (best.z0 + best.z1) / 2 });
    } else {
      out.push({ dir: name, building: null, x: x + dx * 26, z: z + dz * 26 });
    }
  }
  return out;
}
