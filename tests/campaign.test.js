import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaign, advanceTime, updateObjectives, confirmRescue, computeEnding, extractionOpen, DISASTER_TIME, OBJECTIVES,
} from '../public/js/game/campaign.js';
import {
  createPhone, signalBars, devices, repairOptions, applyRepair, connectChance, audioOk,
} from '../public/js/game/phone.js';
import { Inventory } from '../public/js/game/inventory.js';
import { createEnemyBrain, thinkEnemy, playerVisibility } from '../public/js/game/enemy-brain.js';
import { makeRng } from '../public/js/core/util.js';

function facts(over = {}) {
  const tm = { bima: { status: 'missing' }, rizky: { status: 'missing' }, sari: { status: 'missing' }, dimas: { status: 'missing' } };
  return {
    day: 1, tm, located: 0, rescued: 0, shelter: null, playerBleeding: false, flags: {}, rescueConfirmed: false, rescueDay: null,
    stash: { food: 0, water: 0 }, supplies: { food: 0, water: 0 }, comms: { inspected: false, powered: false, audio: false, contact: false, anyUsable: false },
    inv: () => 0, ...over,
  };
}

test('the campaign starts on day 1 right after the strike', () => {
  const c = createCampaign();
  assert.equal(c.day, 1);
  assert.equal(c.minutes, DISASTER_TIME);
});

test('time rolls over into new days and fires scheduled events once', () => {
  const c = createCampaign();
  const f = facts();
  const ev = advanceTime(c, 60 * 20, f);
  assert.ok(ev.some((e) => e.type === 'newDay' && e.day === 2));
  assert.ok(ev.some((e) => e.type === 'event' && e.id === 'enemy_arrival'));
  const again = advanceTime(c, 1, f);
  assert.ok(!again.some((e) => e.id === 'enemy_arrival'));
});

test('conditional events are skipped when no longer relevant', () => {
  const c = createCampaign();
  const f = facts();
  f.tm.sari.status = 'rescued';
  const ev = advanceTime(c, 120, f);
  assert.ok(!ev.some((e) => e.id === 'sari_radio'));
});

test('objectives appear and complete from facts', () => {
  const c = createCampaign();
  let f = facts();
  let r = updateObjectives(c, f);
  assert.ok(r.added.includes('d1_wake'));
  assert.ok(!r.added.includes('d1_rizky'), 'hidden until Rizky is heard');
  f = facts({ located: 1 });
  f.tm.rizky.status = 'located';
  r = updateObjectives(c, f);
  assert.ok(r.completed.includes('d1_wake'));
  assert.ok(r.added.includes('d1_rizky'));
});

test('every objective text renders for a plain facts object', () => {
  const f = facts({ day: 12 });
  for (const o of OBJECTIVES) {
    const t = typeof o.text === 'function' ? o.text(f) : o.text;
    assert.equal(typeof t, 'string');
    assert.doesNotThrow(() => o.check(f));
  }
});

test('rescue is scheduled for day 12, or two days after a late call', () => {
  const c = createCampaign();
  c.day = 4;
  assert.equal(confirmRescue(c), 12);
  const late = createCampaign();
  late.day = 11;
  assert.equal(confirmRescue(late), 13);
});

test('the extraction window is only open on the rescue day 06:00-18:00', () => {
  const c = createCampaign();
  confirmRescue(c);
  c.day = 12; c.minutes = 5 * 60;
  assert.equal(extractionOpen(c), false);
  c.minutes = 9 * 60;
  assert.equal(extractionOpen(c), true);
  c.minutes = 18 * 60;
  assert.equal(extractionOpen(c), false);
});

test('missing the window or never calling ends the campaign', () => {
  const c = createCampaign();
  confirmRescue(c);
  c.day = 12; c.minutes = 17 * 60 + 59;
  assert.ok(advanceTime(c, 2, facts()).some((e) => e.type === 'missedExtraction'));
  const n = createCampaign();
  n.day = 12; n.minutes = 23 * 60 + 59;
  assert.ok(advanceTime(n, 2, facts()).some((e) => e.type === 'noRescue'));
});

test('endings depend on who made it', () => {
  const base = { playerAlive: true, extracted: true, rescueConfirmed: true, dead: [], aboard: [] };
  assert.equal(computeEnding({ ...base, aboard: ['bima', 'rizky', 'sari', 'dimas'] }).id, 'all_home');
  assert.equal(computeEnding({ ...base, aboard: ['rizky', 'sari'] }).id, 'broken');
  assert.equal(computeEnding({ ...base, aboard: ['rizky'] }).id, 'last_one');
  assert.equal(computeEnding({ ...base, extracted: false }).id, 'missed');
  assert.equal(computeEnding({ ...base, rescueConfirmed: false, extracted: false }).id, 'left_behind');
  assert.equal(computeEnding({ ...base, playerAlive: false }).id, 'kia');
  assert.equal(computeEnding({ ...base, aboard: ['rizky'], dead: ['bima'] }).epilogue.length, 4);
});

test('signal is weak in the streets and strong on high ground', () => {
  const street = signalBars({ x: 0, y: 1.6, z: 30 }, { t: 0 });
  const roof = signalBars({ x: 120, y: 9.6, z: -60 }, { t: 0, open: true });
  const tower = signalBars({ x: 42.5, y: 25.6, z: -61 }, { t: 0, open: true });
  assert.ok(street <= 1, `street ${street}`);
  assert.ok(roof >= 2, `roof ${roof}`);
  assert.equal(tower, 4);
  assert.equal(connectChance(1), 0);
});

test('the phone starts broken and has several repair paths', () => {
  const p = createPhone();
  const inv = new Inventory(30);
  const ctx = { inv, outdoors: true, daylight: true };
  let d = devices(p, { ...ctx, bars: 4 });
  assert.equal(d[0].usable, false);
  assert.ok(d[0].issues.length >= 3);
  // Power: power bank + cable.
  inv.add('power_bank'); inv.add('usb_cable');
  assert.ok(applyRepair(p, 'powerbank', ctx));
  assert.ok(p.battery > 20 && p.battery <= p.batteryMax);
  // Audio via earphones, contact via card.
  inv.add('earphones');
  assert.ok(audioOk(p, inv));
  assert.equal(applyRepair(p, 'card', ctx), null, 'needs the card');
  inv.add('emergency_card');
  assert.ok(applyRepair(p, 'card', ctx));
  d = devices(p, { ...ctx, bars: 3 });
  assert.equal(d[0].usable, true);
  assert.equal(devices(p, { ...ctx, bars: 1 })[0].usable, false, 'still needs signal');
});

test('moving the SIM into the spare phone fixes screen, audio and contacts at once', () => {
  const p = createPhone();
  const inv = new Inventory(30);
  inv.add('spare_phone'); inv.add('sim_tool');
  const opts = repairOptions(p, { inv });
  assert.ok(opts.find((o) => o.id === 'sim').possible);
  applyRepair(p, 'sim', { inv });
  assert.equal(p.device, 'spare');
  assert.ok(p.contactKnown && p.speaker === 'ok');
});

test('a satellite phone or radio are alternatives to the phone', () => {
  const p = createPhone();
  const inv = new Inventory(30);
  inv.add('sat_phone', 1, { charge: 50 });
  inv.add('field_radio'); inv.add('batteries', 2); inv.add('freq_card');
  const d = devices(p, { inv, bars: 0, outdoors: true, elevation: 9 });
  assert.equal(d.find((k) => k.id === 'sat').usable, true);
  assert.equal(d.find((k) => k.id === 'radio').usable, true);
  const indoors = devices(p, { inv, bars: 0, outdoors: false, elevation: 0 });
  assert.equal(indoors.find((k) => k.id === 'sat').usable, false);
});

function perception(over = {}) {
  return {
    pos: { x: 0, z: 0 }, seePlayer: false, visibility: 0, playerPos: { x: 20, z: 0 }, playerDist: 20, noise: null, allyAlert: null,
    hurt: false, healthFrac: 1, arrived: false, cover: { x: -5, z: 0 }, searchSpots: [{ x: 1, z: 1 }, { x: 2, z: 2 }],
    routePoint: (i) => ({ x: i * 10, z: 0 }), routeLen: 4, rng: makeRng(3), range: 60, ...over,
  };
}

test('enemy patrols, gets suspicious, then engages', () => {
  const b = createEnemyBrain();
  let out = thinkEnemy(b, perception(), 0.2);
  assert.equal(b.state, 'patrol');
  assert.ok(out.move);
  for (let i = 0; i < 30 && b.state === 'patrol'; i++) out = thinkEnemy(b, perception({ seePlayer: true, visibility: 0.4 }), 0.2);
  assert.equal(b.state, 'investigate', 'suspicious before fully alert');
  for (let i = 0; i < 20 && b.state !== 'combat'; i++) out = thinkEnemy(b, perception({ seePlayer: true, visibility: 1, playerDist: 10 }), 0.2);
  assert.equal(b.state, 'combat');
  let fired = false;
  for (let i = 0; i < 30; i++) fired = thinkEnemy(b, perception({ seePlayer: true, visibility: 1, playerDist: 10 }), 0.1).fire || fired;
  assert.ok(fired, 'should open fire');
});

test('enemy investigates gunfire and alerts allies, then searches and returns', () => {
  const b = createEnemyBrain();
  const out = thinkEnemy(b, perception({ noise: { x: 30, z: 30, loud: 1 } }), 0.2);
  assert.equal(b.state, 'investigate');
  assert.ok(out.alert);
  thinkEnemy(b, perception({ arrived: true }), 0.2);
  assert.equal(b.state, 'search');
  for (let i = 0; i < 200 && b.state === 'search'; i++) thinkEnemy(b, perception({ arrived: true }), 0.2);
  assert.equal(b.state, 'return');
  thinkEnemy(b, perception({ arrived: true }), 0.2);
  assert.equal(b.state, 'patrol');
});

test('a hurt enemy falls back to cover', () => {
  const b = createEnemyBrain();
  b.state = 'combat';
  thinkEnemy(b, perception({ seePlayer: true, visibility: 1, hurt: true, healthFrac: 0.4 }), 0.2);
  assert.equal(b.state, 'cover');
});

test('crouching in the dark makes you much harder to see', () => {
  const stand = playerVisibility({ dist: 20, crouched: false, moving: true, darkness: 0 });
  const sneak = playerVisibility({ dist: 20, crouched: true, moving: false, darkness: 0.8 });
  assert.ok(sneak < stand * 0.3);
  assert.equal(playerVisibility({ dist: 5, inSmoke: true }), 0);
});
