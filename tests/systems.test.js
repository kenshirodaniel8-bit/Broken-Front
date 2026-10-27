import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../public/js/core/util.js';
import { ITEMS, WEAPONS } from '../public/js/data/items.js';
import { Inventory, Stash } from '../public/js/game/inventory.js';
import {
  createVitals, tickVitals, addInjury, treat, applyDamage, movementFactor, canSprint, condition, consume, hasInjury,
} from '../public/js/game/survival.js';
import { generateContents, scarcityFor } from '../public/js/game/loot.js';
import {
  defaultConfig, deriveStats, randomConfig, sanitizeConfig, startingItems, VESTS,
} from '../public/js/data/customization.js';

test('inventory respects weight limits and stacks', () => {
  const inv = new Inventory(5);
  assert.equal(inv.add('water_large', 10), 8, 'capacity 5 + margin 8 = 13 kg -> 8 bottles');
  assert.ok(inv.weight() <= 13);
  assert.equal(inv.count('water_large'), 8);
  assert.equal(inv.stacks.filter((s) => s.id === 'water_large').length, 3, 'stack size 3');
  assert.equal(inv.remove('water_large', 5), 5);
  assert.equal(inv.count('water_large'), 3);
});

test('weapons auto-equip and reload from reserve ammo', () => {
  const inv = new Inventory(30);
  inv.add('w_ar');
  inv.add('ammo_556', 40);
  assert.equal(inv.primary, 'ar');
  assert.equal(inv.reload('ar'), 30);
  assert.equal(inv.mags.ar, 30);
  assert.equal(inv.reserve('ar'), 10);
  inv.mags.ar = 25;
  assert.equal(inv.reload('ar'), 5);
  assert.equal(inv.reserve('ar'), 5);
});

test('power bank keeps its own charge data', () => {
  const inv = new Inventory(30);
  inv.add('power_bank');
  assert.equal(inv.stackOf('power_bank').data.charge, 100);
});

test('inventory survives a JSON round trip', () => {
  const inv = new Inventory(20);
  inv.add('w_pistol'); inv.add('bandage', 3); inv.setQuickSlots(4); inv.assignQuick(0, 'bandage');
  const back = Inventory.fromJSON(JSON.parse(JSON.stringify(inv)));
  assert.deepEqual(back.toJSON(), inv.toJSON());
});

test('stash counts and removes', () => {
  const s = new Stash();
  s.add('mre', 2); s.add('mre', 1);
  assert.equal(s.count('mre'), 3);
  assert.equal(s.remove('mre', 5), 3);
});

test('needs grow over time and faster when sprinting', () => {
  const a = createVitals();
  const b = createVitals();
  tickVitals(a, 120, { activity: 'idle' });
  tickVitals(b, 120, { activity: 'sprint' });
  assert.ok(a.hunger > 12 && a.thirst > 15);
  assert.ok(b.thirst > a.thirst);
});

test('starving and dehydration eventually kill', () => {
  const v = createVitals({ hunger: 100, thirst: 100 });
  let events = [];
  for (let i = 0; i < 100 && v.health > 0; i++) events = events.concat(tickVitals(v, 10, {}));
  assert.equal(v.health, 0);
  assert.ok(events.includes('death'));
});

test('severe bleeding needs a tourniquet, bandage does nothing for it', () => {
  const v = createVitals();
  addInjury(v, 'bleeding_severe', 'leg');
  assert.equal(treat(v, 'bandage'), null);
  const h0 = v.health;
  tickVitals(v, 10, {});
  assert.ok(v.health < h0 - 5);
  assert.equal(treat(v, 'tourniquet'), 'bleeding_severe');
  const h1 = v.health;
  tickVitals(v, 10, {});
  assert.ok(v.health >= h1 - 0.01);
});

test('a broken leg slows you down until splinted', () => {
  const v = createVitals();
  addInjury(v, 'fracture', 'leg');
  assert.equal(movementFactor(v), 0.5);
  assert.equal(canSprint(v), false);
  assert.equal(treat(v, 'splint'), 'fracture');
  assert.ok(movementFactor(v) > 0.8);
  assert.equal(canSprint(v), true);
});

test('untreated cuts get infected; antibiotics cure it', () => {
  const v = createVitals();
  addInjury(v, 'laceration', 'arm');
  const ev = tickVitals(v, 800, {});
  assert.ok(ev.includes('infection'));
  assert.ok(hasInjury(v, 'infection'));
  assert.equal(treat(v, 'antibiotics'), 'infection');
});

test('first aid kit revives the unconscious and restores health', () => {
  const v = createVitals({ health: 30 });
  addInjury(v, 'unconscious', 'head');
  assert.equal(condition(v).label, 'Unconscious');
  treat(v, 'first_aid_kit');
  assert.ok(!hasInjury(v, 'unconscious'));
  assert.equal(v.health, 65);
});

test('armour reduces torso damage', () => {
  const a = createVitals();
  const b = createVitals();
  const rng = makeRng(1);
  applyDamage(a, 40, { part: 'torso', armor: 0, rng });
  applyDamage(b, 40, { part: 'torso', armor: 0.5, rng });
  assert.ok(b.health > a.health);
});

test('food and drink reduce needs', () => {
  const v = createVitals({ hunger: 80, thirst: 80 });
  consume(v, ITEMS.mre);
  consume(v, ITEMS.water_large);
  assert.ok(v.hunger < 30 && v.thirst < 15);
});

test('loot is persistent per container and fixed items always appear', () => {
  const c = { id: 'c_test', table: 'electronics_storage', fixed: [['drone', 1]] };
  const a = generateContents(c, 'seed', 1);
  const b = generateContents(c, 'seed', 1);
  assert.deepEqual(a, b);
  assert.ok(a.some((i) => i.id === 'drone'));
  const late = generateContents(c, 'seed', 10);
  assert.ok(late.some((i) => i.id === 'drone'), 'fixed items ignore scarcity');
  assert.ok(scarcityFor(10) < scarcityFor(2));
});

test('every loot table entry is a real item', async () => {
  const { LOOT_TABLES } = await import('../public/js/game/loot.js');
  for (const t of Object.values(LOOT_TABLES)) for (const [id] of t.entries) assert.ok(ITEMS[id], id);
});

test('gear choices change gameplay stats', () => {
  const c = defaultConfig();
  const base = deriveStats(c);
  const heavy = deriveStats({ ...c, vest: 'heavy', backpack: 'ruck' });
  assert.ok(heavy.armor > base.armor);
  assert.ok(heavy.capacity > base.capacity);
  assert.ok(heavy.speedMult < base.speedMult);
  assert.ok(deriveStats({ ...c, role: 'medic' }).treatSpeed > base.treatSpeed);
  assert.ok(deriveStats({ ...c, eyewear: 'goggles' }).dustProtection > base.dustProtection);
});

test('kit is limited by the vest slots and becomes starting items', () => {
  const c = sanitizeConfig({ ...defaultConfig(), vest: 'platelight', loadout: { primary: 'smg', kit: ['bandage', 'splint', 'tourniquet', 'painkillers', 'lighter'] } });
  assert.equal(c.loadout.kit.length, VESTS.platelight.slots);
  const items = Object.fromEntries(startingItems(c));
  assert.ok(items.w_smg && items.w_pistol);
  assert.ok(items.ammo_9mm >= 45 + 90, 'SMG and pistol share 9 mm');
  assert.equal(items.bandage, 1);
});

test('random and sanitised configs are always valid', () => {
  for (let i = 0; i < 30; i++) {
    const c = randomConfig(i);
    assert.deepEqual(sanitizeConfig(c), c);
    if (c.gender === 'female') assert.equal(c.facialHair, 'none');
  }
  const junk = sanitizeConfig({ name: '<script>', vest: 'nope', skin: 99, loadout: { primary: 'rocket' } });
  assert.equal(junk.vest, defaultConfig().vest);
  assert.ok(!junk.name.includes('<'));
  assert.ok(WEAPONS[junk.loadout.primary]);
});
