import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout, pickBlastTargets, blockedRects } from '../public/js/world/layout.js';
import { buildCollision, insideInterior } from '../public/js/world/collision.js';
import { NavGrid } from '../public/js/world/navgrid.js';
import { LOOT_TABLES } from '../public/js/game/loot.js';

const L = generateLayout();

function ruinedWorld(cleared = ['fire_door']) {
  const p = L.playerAfterBlast;
  const blast = pickBlastTargets(L, p.x, p.z, p.yaw).map((t) => t.building).filter(Boolean);
  const collapsed = new Set([...L.buildings.filter((b) => b.collapse).map((b) => b.id), ...blast]);
  const cw = buildCollision(L, { ruined: true, collapsed, clearedDebris: new Set(cleared) });
  return { cw, nav: new NavGrid(cw) };
}

test('layout is deterministic', () => {
  const a = generateLayout();
  assert.deepEqual(a.buildings.map((b) => [b.id, b.x0, b.z0, b.h]), L.buildings.map((b) => [b.id, b.x0, b.z0, b.h]));
});

test('buildings never overlap', () => {
  const B = L.buildings;
  for (let i = 0; i < B.length; i++) {
    for (let j = i + 1; j < B.length; j++) {
      const a = B[i];
      const b = B[j];
      const overlap = a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.z0 < b.z1 - 0.01 && a.z1 > b.z0 + 0.01;
      assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('every container uses a known loot table and sits inside the world', () => {
  for (const c of L.containers) {
    assert.ok(LOOT_TABLES[c.table], `${c.id} table ${c.table}`);
    assert.ok(Math.abs(c.x) < L.edge && Math.abs(c.z) < L.edge);
  }
});

test('the four blast targets are distinct and in four directions', () => {
  const p = L.playerAfterBlast;
  const t = pickBlastTargets(L, p.x, p.z, p.yaw);
  assert.deepEqual(t.map((k) => k.dir), ['front', 'right', 'rear', 'left']);
  const ids = t.map((k) => k.building).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test('ruined city: teammates, shelters, LZ, loot and climb points are reachable on foot', () => {
  const { nav } = ruinedWorld();
  const s = L.playerAfterBlast;
  const mark = nav.reachable(s.x, s.z);
  const ok = (x, z) => {
    const i = nav.nearestWalkable(x, z, 2);
    return i >= 0 && mark[i] === 1;
  };
  for (const [id, p] of Object.entries(L.teammateSpots)) assert.ok(ok(p.x, p.z), `teammate ${id}`);
  for (const sh of L.shelters) assert.ok(ok(sh.setup.x, sh.setup.z), `shelter ${sh.id}`);
  assert.ok(ok(L.lz.x, L.lz.z), 'landing zone');
  for (const c of L.containers) if (!c.y) assert.ok(ok(c.x, c.z), `container ${c.id}`);
  for (const c of L.chargeSpots) if (!c.y) assert.ok(ok(c.x, c.z), `charge spot ${c.id}`);
  assert.ok(ok(L.climbs[0].bottom.x, L.climbs[0].bottom.z), 'bell tower');
});

test('fire station equipment is behind debris until it is cleared', () => {
  const { nav } = ruinedWorld([]);
  const s = L.playerAfterBlast;
  const mark = nav.reachable(s.x, s.z);
  const jack = L.containers.find((c) => c.fixed?.some(([id]) => id === 'car_jack'));
  const i = nav.nearestWalkable(jack.x, jack.z, 2);
  assert.equal(mark[i], 0, 'jack should be unreachable before clearing');
});

test('blocked streets are impassable but have detours', () => {
  const { cw, nav } = ruinedWorld();
  for (const r of blockedRects()) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    assert.ok(cw.blocked(cx, cz, 0, 0.35, 1.7));
  }
  const path = nav.findPath(L.playerAfterBlast.x, L.playerAfterBlast.z, L.teammateSpots.bima.x, L.teammateSpots.bima.z);
  assert.ok(path && path.length > 0);
});

test('collision: walls stop movement, steps and ramps lift you', () => {
  const cw = buildCollision(L, {});
  const b = L.buildings.find((k) => !k.enterable && !k.passage && !k.edge && k.side === 'n');
  const pos = { x: (b.x0 + b.x1) / 2, y: 0, z: b.z0 - 2 };
  cw.move(pos, 0, 3, 0.35, 1.75);
  assert.ok(pos.z <= b.z0 - 0.34, 'pushed out of the building');
  // Garage ramp: halfway up ramp 1 is 2 m high.
  const r = L.ramps[0];
  const h = cw.groundHeight((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 1.8);
  assert.ok(Math.abs(h - 2) < 0.05, `ramp height ${h}`);
  // Too high to step onto from the ground.
  assert.equal(cw.groundHeight((r.x0 + r.x1) / 2, r.z0 + 1, 0), 0);
});

test('collision: raycast hits buildings and line of sight is blocked', () => {
  const cw = buildCollision(L, {});
  const b = L.buildings.find((k) => k.id === 'rathaus');
  // x = 8 is beside the Rathaus door (which is at x = 0).
  const d = cw.raycast(8, 1.5, 5, 0, 0, -1, 100);
  assert.ok(Math.abs(d - (5 - b.z1)) < 0.01, `distance ${d}`);
  assert.equal(cw.lineOfSight(8, 1.5, 5, 8, 1.5, -30), false);
  assert.equal(cw.lineOfSight(8, 1.5, 5, 8, 1.5, 0), true);
  // Through the open door you can see inside.
  assert.equal(cw.lineOfSight(0, 1.5, 5, 0, 1.5, -15), true);
});

test('interiors are detected', () => {
  const it = L.interiors.find((i) => i.type === 'pharmacy');
  assert.equal(insideInterior(L, (it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2)?.id, it.id);
  assert.equal(insideInterior(L, 0, 30), null);
});
