// End-to-end smoke test: plays through BROKEN FRONT in a real browser using
// the game's own systems, checking state along the way and failing on any
// page error. Screenshots go to docs/screenshots when SHOTS=1.
//
//   npm run smoke            (needs Playwright: npm i -D playwright)
//   SHOTS=1 npm run smoke

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/server.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS === '1';
const shotDir = path.join(root, 'docs', 'screenshots');
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

const server = createServer();
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.addInitScript((q) => {
  localStorage.clear();
  localStorage.setItem('brokenfront.settings', JSON.stringify({ quality: q, tts: false, hints: true }));
}, SHOTS ? 'high' : 'low');

let failed = 0;
const step = async (name, fn) => {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`  ok  ${name}${r ? ` — ${r}` : ''} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  if (!SHOTS) return;
  await ev(() => window.__BF.frame());
  await page.screenshot({ path: path.join(shotDir, `${name}.jpg`), quality: 82, type: 'jpeg' });
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };

await page.goto(url);
await page.waitForSelector('.menu-box', { timeout: 60000 });

await step('main menu', async () => {
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, 'menu.jpg'), quality: 82, type: 'jpeg' });
  assert(await page.isVisible('text=New game'), 'no New game button');
});

await step('character creator', async () => {
  await page.click('text=New game');
  await page.waitForSelector('.creator');
  await page.fill('.cc-form input[type=text]', 'Galih Permana');
  await page.click('.cc-tabs >> text=Uniform');
  await page.selectOption('.cc-form select >> nth=1', 'woodland');
  await page.click('.cc-tabs >> text=Gear');
  await page.selectOption('.cc-form select >> nth=2', 'heavy');
  await page.click('.cc-tabs >> text=Loadout');
  await page.click('.weapon >> text=M-308 Marksman Rifle');
  await page.waitForTimeout(1500);
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, 'creator.jpg'), quality: 82, type: 'jpeg' });
  const summary = await page.textContent('.cc-summary');
  assert(summary.includes('50%'), 'heavy vest should show 50% armour in the summary');
  await page.click('text=Deploy');
  await page.click('text=Play the opening');
  await page.waitForFunction(() => window.__BF.game.mode === 'play', null, { timeout: 120000 });
  const c = await ev(() => window.__BF.game.config);
  assert(c.name === 'Galih Permana' && c.vest === 'heavy' && c.loadout.primary === 'dmr' && c.uniform.camo === 'woodland', 'config not applied');
  return `${c.name}, ${c.vest} vest, ${c.loadout.primary}`;
});

await step('arrival and gear check', async () => {
  await ev(() => { const g = window.__BF.game; g.stop(); g.simulate(4); });
  await shot('01-arrival');
  await ev(() => { window.__BF.ui.openTactical('inventory'); });
  await shot('02-inventory');
  // Look at the Rathaus and the fountain, as the objective asks.
  await ev(() => {
    const g = window.__BF.game;
    window.__BF.ui.close('tactical');
    const look = (x, z) => { const P = g.player.pos; g.player.yaw = Math.atan2(-(x - P.x), -(z - P.z)); g.player.pitch = 0; g.simulate(0.5); };
    look(0, -16);
    look(0, 8);
    g.simulate(12);
  });
  const ph = await ev(() => window.__BF.game.prologue.phase);
  assert(['gear', 'shopping'].includes(ph), `phase ${ph}`);
  await ev(() => window.__BF.game.simulate(1));
  return ph;
});

await step('shopping', async () => {
  const bought = await ev(async () => {
    const g = window.__BF.game;
    const buyAt = (type, ids) => {
      const it = g.L.interiors.find((i) => i.type === type);
      g.player.place((it.x0 + it.x1) / 2, 0, (it.z0 + it.z1) / 2, 0);
      g.simulate(0.1);
      const shop = g.worldInteractables().find((x) => x.id.startsWith('shop:'));
      if (!shop) throw new Error(`no shop in ${type}`);
      shop.action();
      for (const id of ids) {
        const row = [...document.querySelectorAll('.loot-row')].find((r) => r.querySelector('.nm').textContent.startsWith(itemName(id)));
        row.querySelector('button').click();
      }
    };
    const itemName = (id) => ({ water_small: 'Water bottle 0.5 L', bandage: 'Bandage', first_aid_kit: 'First aid kit', drone: 'Recon drone', power_bank: 'Power bank', canned_soup: 'Canned soup' }[id]);
    buyAt('supermarket', ['water_small', 'water_small', 'canned_soup']);
    window.__BF.ui.close('shop');
    buyAt('pharmacy', ['bandage', 'first_aid_kit']);
    window.__BF.ui.close('shop');
    buyAt('electronics', ['drone']);
    return { money: g.money, drone: g.inv.has('drone'), purchases: g.prologue.purchases.length };
  });
  await shot('03-shop');
  await ev(() => window.__BF.ui.close('shop'));
  assert(bought.drone && bought.purchases === 6, JSON.stringify(bought));
  return `€${bought.money.toFixed(2)} left`;
});

await step('walk to the bus with the squad', async () => {
  await ev(() => {
    const g = window.__BF.game;
    g.player.place(22, 0, 26, Math.PI);
    for (let i = 0; i < 600 && g.prologue.phase !== 'stop'; i++) {
      const b = g.squad.get('bima');
      g.player.place(b.pos.x - 1, 0, b.pos.z - 2, Math.PI);
      g.simulate(0.25);
    }
  });
  const ph = await ev(() => window.__BF.game.prologue.phase);
  assert(ph === 'stop', `phase ${ph}`);
  await ev(() => window.__BF.game.simulate(1));
  await shot('04-walk-lookup');
});

await step('invasion: look up at the aircraft', async () => {
  await ev(() => {
    const g = window.__BF.game;
    g.simulate(6);
    const jet = g.prologue.aircraft.find((a) => a.kind === 'jet');
    const d = jet.mesh.position.clone().sub(g.camera.position);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    g.simulate(0.3);
  });
  const ph = await ev(() => window.__BF.game.prologue.phase);
  assert(ph === 'run', `reveal did not trigger (phase ${ph})`);
  await ev(() => { const g = window.__BF.game; g.simulate(3); const h = g.prologue.aircraft.find((a) => a.kind === 'heli'); const d = h.mesh.position.clone().sub(g.camera.position); g.player.yaw = Math.atan2(-d.x, -d.z); g.player.pitch = Math.min(0.9, Math.atan2(d.y, Math.hypot(d.x, d.z))); g.simulate(0.05); });
  await shot('05-invasion');
});

await step('the great destruction', async () => {
  await ev(() => { const g = window.__BF.game; for (let i = 0; i < 80 && g.prologue.phase !== 'blast'; i++) g.simulate(0.1); g.player.yaw = Math.PI; g.player.pitch = 0.1; g.simulate(0.35); });
  await page.waitForTimeout(600); // let the staggered detonations (setTimeout) fire
  await ev(() => window.__BF.game.simulate(0.3));
  await shot('06-blast');
  const st = await ev(() => { const g = window.__BF.game; return { blast: g.world.blast.length, knock: g.player.knockdown, phase: g.prologue.phase }; });
  assert(st.blast === 4, `expected 4 blast targets, got ${st.blast}`);
  await ev(() => window.__BF.game.simulate(1.6));
  await shot('07-dust');
  return `${st.blast} targets`;
});

await step('blackout and waking up in the ruins', async () => {
  await ev(() => { const g = window.__BF.game; for (let i = 0; i < 400 && g.prologue.phase !== 'done'; i++) g.simulate(0.1); g.simulate(1); });
  const st = await ev(() => {
    const g = window.__BF.game;
    return { started: g.campaignStarted, ruined: g.world.ruined, day: g.campaign.day, inj: g.vitals.injuries.length, statuses: g.squad.members.map((m) => m.status), card: g.inv.has('emergency_card') };
  });
  assert(st.started && st.ruined && st.day === 1, JSON.stringify(st));
  assert(st.statuses.every((s) => s === 'missing'), `squad ${st.statuses}`);
  assert(!st.card, 'emergency card should be lost in the blast');
  await ev(() => { const g = window.__BF.game; g.player.yaw = Math.PI * 0.9; g.player.pitch = 0; g.simulate(0.05); });
  await shot('08-aftermath');
  return `${st.inj} injuries`;
});

await step('treat your own wounds', async () => {
  const r = await ev(() => { const g = window.__BF.game; g.inv.add('bandage', 2); const ok = g.useItem('bandage'); return { ok, bleeding: g.facts().playerBleeding }; });
  assert(r.ok && !r.bleeding, JSON.stringify(r));
});

await step('find and rescue Rizky', async () => {
  const st = await ev(() => {
    const g = window.__BF.game;
    const m = g.squad.get('rizky');
    g.player.place(m.pos.x + 3, 0, m.pos.z - 1, Math.atan2(3, -1));
    g.player.yaw = Math.atan2(-(m.pos.x - g.player.pos.x), -(m.pos.z - g.player.pos.z));
    g.simulate(0.5);
    const free = g.gatherInteractables().find((i) => i.id === 'free:rizky');
    if (!free) throw new Error('no free interaction');
    free.action();
    g.squad.applyTreatment(m, 'bandage');
    g.simulate(1);
    return { status: m.status, exact: m.exact };
  });
  assert(st.status === 'rescued' && st.exact, JSON.stringify(st));
  await shot('09-rizky');
});

await step('loot the pharmacy (and find Sari)', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    const it = g.L.interiors.find((i) => i.type === 'pharmacy');
    g.player.place(it.x0 + 2, 0, (it.z0 + it.z1) / 2, -Math.PI / 2);
    g.simulate(0.5);
    const c = g.L.containers.find((k) => k.interior === it.id && k.kind === 'medcab');
    g.ui.openLoot(c);
    return { items: g.containers.contents(c).length, sari: g.squad.get('sari').status };
  });
  await shot('10-loot');
  await page.click('.dialog >> text=Take all');
  await ev(() => window.__BF.ui.close('loot'));
  const sari = await ev(() => {
    const g = window.__BF.game;
    const m = g.squad.get('sari');
    g.inv.add('splint');
    g.squad.locate(m);
    g.squad.applyTreatment(m, 'splint');
    return m.status;
  });
  assert(sari === 'rescued', `sari ${sari}`);
  return `${r.items} item stacks`;
});

await step('set up the shelter and send teammates there', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    const sh = g.L.shelters.find((s) => s.id === 'parking');
    g.player.place(sh.setup.x, 0, sh.setup.z + 1, 0);
    g.setShelter(sh);
    for (const id of ['rizky', 'sari']) g.squad.setOrder(g.squad.get(id), 'shelter');
    g.stash.add('water_large', 4); g.stash.add('canned_beans', 4);
    for (const id of ['rizky', 'sari']) { const m = g.squad.get(id); const s = g.shelterSpot(m.index); m.pos.set(s.x, 0, s.z); }
    g.simulate(2);
    return { shelter: g.shelter?.id, sheltered: ['rizky', 'sari'].map((id) => g.squad.get(id).sheltered) };
  });
  assert(r.shelter === 'parking' && r.sheltered.every(Boolean), JSON.stringify(r));
});

await step('repair the phone', async () => {
  await ev(() => {
    const g = window.__BF.game;
    for (const id of ['power_bank', 'usb_cable', 'earphones', 'emergency_card']) g.inv.add(id);
    g.ui.openPhone();
  });
  await shot('11-phone-dead');
  await page.click('.repair:has-text("Charge from power bank") button');
  await page.waitForTimeout(2600);
  await page.click('.repair:has-text("emergency card") button');
  await page.waitForTimeout(800);
  const p = await ev(() => { const g = window.__BF.game; return { battery: g.phone.battery, contact: g.phone.contactKnown, inspected: g.phone.inspected }; });
  assert(p.battery > 20 && p.contact && p.inspected, JSON.stringify(p));
  await ev(() => window.__BF.ui.close('phone'));
  return `battery ${Math.round(p.battery)}%`;
});

await step('climb the bell tower and call Central Command', async () => {
  await ev(() => {
    const g = window.__BF.game;
    const c = g.L.climbs[0];
    g.player.place(c.top.x, c.top.y, c.top.z, 0);
    g.simulate(0.3);
    g.ui.openPhone();
  });
  const bars = await ev(() => window.__BF.game.signalHere());
  assert(bars >= 3, `only ${bars} bars on the tower`);
  await page.click('.device:has-text("Your phone") button');
  await page.waitForSelector('.ph-wide', { timeout: 15000 });
  await page.click('.ph-wide >> nth=0');
  await page.click('text=Report the squad');
  await page.click('text=Send GPS coordinates');
  await page.waitForFunction(() => window.__BF.game.campaign.rescue.confirmed, null, { timeout: 15000 });
  await shot('12-call');
  await ev(() => window.__BF.ui.close('phone'));
  const day = await ev(() => window.__BF.game.campaign.rescue.day);
  assert(day === 12, `rescue day ${day}`);
  return `rescue on day ${day}`;
});

await step('map, journal and squad screens', async () => {
  await ev(() => { const g = window.__BF.game; g.player.place(30, 0, 40, Math.PI); g.mapState.reveal(0, 0, 120); g.ui.openTactical('map'); });
  await page.waitForTimeout(300);
  await shot('13-map');
  await ev(() => window.__BF.ui.openTactical('journal'));
  await shot('14-journal');
  await ev(() => window.__BF.ui.openTactical('squad'));
  await shot('15-squad');
  await ev(() => window.__BF.ui.close('tactical'));
});

await step('fly the drone', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    if (!g.inv.has('drone')) { g.inv.remove('drone_broken'); g.inv.add('drone'); }
    g.drone.battery = 100;
    g.player.place(30, 0, 40, Math.PI);
    const ok = g.drone.deploy();
    g.drone.pos.set(30, 28, 55);
    g.drone.yaw = Math.PI;
    g.drone.pitch = -0.6;
    g.simulate(1);
    return { ok, mode: g.mode, battery: g.drone.battery };
  });
  assert(r.ok && r.mode === 'drone' && r.battery < 100, JSON.stringify(r));
  await shot('16-drone');
  await ev(() => window.__BF.game.drone.land());
});

await step('enemy patrols arrive and fight', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    g.campaign.minutes = 14 * 60 + 59;
    g.updateCampaign(2);
    const n = g.enemies.alive.length;
    // Put a soldier in the open in front of the player.
    g.player.place(30, 0, 40, Math.PI);
    const e = g.enemies.alive[0];
    e.pos.set(30, 0, 58);
    e.yaw = 0;
    // Count incoming hits instead of taking them, so the test can't die here.
    let hits = 0;
    const real = g.damagePlayer;
    g.damagePlayer = () => { hits++; };
    g.simulate(6);
    g.damagePlayer = real;
    const state = e.brain.state;
    e.damage(500, 'torso', g.player.pos);
    return { n, state, hits, dead: e.dead, body: g.containers.dynamic.some((c) => c.kind === 'body') };
  });
  await shot('17-combat');
  assert(r.n >= 4 && r.dead && r.body, JSON.stringify(r));
  assert(['combat', 'cover', 'investigate', 'search'].includes(r.state), `enemy did not react: ${r.state}`);
  return `${r.n} soldiers, reaction: ${r.state}, ${r.hits} hits on you in 6 s`;
});

await step('save and load', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    const res = g.save('1', 'smoke test');
    return res.ok;
  });
  assert(r, 'save failed');
  const loads = await ev(() => window.__BF.game.loadCount || 0);
  await ev(() => window.__BF.app.loadSlot('1'));
  await page.waitForFunction((n) => (window.__BF.game.loadCount || 0) > n && window.__BF.game.mode === 'play', loads, { timeout: 120000 });
  const st = await ev(() => { const g = window.__BF.game; g.stop(); return { day: g.campaign.day, confirmed: g.campaign.rescue.confirmed, rizky: g.squad.get('rizky').status, shelter: g.shelter?.id, drone: g.inv.has('drone') }; });
  assert(st.confirmed && st.rizky === 'rescued' && st.shelter === 'parking', JSON.stringify(st));
});

await step('twelve days of campaign events', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    const fired = new Set();
    const orig = g.onCampaignEvent.bind(g);
    g.onCampaignEvent = (e) => { fired.add(e.id || e.type); orig(e); };
    g.player.place(105.5, 0, -45, 0);
    const keepAlive = () => {
      Object.assign(g.vitals, { health: 100, hunger: 10, thirst: 10, fatigue: 10 });
      for (const m of g.squad.members) if (m.status !== 'dead') { m.vitals.health = 100; m.vitals.hunger = 10; m.vitals.thirst = 10; }
    };
    g.godMode = true;
    let guard = 0;
    while ((g.campaign.day < 12 || g.campaign.minutes < 7 * 60) && guard++ < 2000) {
      keepAlive();
      g.updateCampaign(20);
      g.simulate(0.1);
      if (g.mode !== 'play') break;
    }
    keepAlive();
    return { day: g.campaign.day, min: g.campaign.minutes, fired: [...fired], enemies: g.enemies.alive.length, collapsed: g.world.extraCollapsed.length, mode: g.mode };
  });
  for (const id of ['newDay', 'threat2', 'midpoint', 'aftershock', 'threat3', 'civilians', 'depot', 'roadblock', 'raid', 'extraction_window']) assert(r.fired.includes(id), `event ${id} did not fire (${r.fired})`);
  assert(r.day === 12 && r.mode === 'play', JSON.stringify(r));
  return `${r.fired.length} event types, ${r.enemies} enemies active`;
});

await step('extraction from the Stadtpark', async () => {
  const r = await ev(() => {
    const g = window.__BF.game;
    g.inv.add('flare');
    for (const id of ['rizky', 'sari']) { const m = g.squad.get(id); m.order = 'follow'; m.pos.set(g.L.lz.x + 2, 0, g.L.lz.z + 3); }
    g.player.place(g.L.lz.x, 0, g.L.lz.z + 2, Math.PI);
    g.simulate(0.3);
    g.godMode = true;
    const mark = g.gatherInteractables().find((i) => i.id === 'mark_lz');
    if (!mark) throw new Error(`no mark_lz interaction ${JSON.stringify({ mode: g.mode, day: g.campaign.day, min: g.campaign.minutes, rescue: g.campaign.rescue, marked: g.campaign.flags.lzMarked, pos: g.player.pos, phase: g.prologue.phase, alive: g.playerAlive })}`);
    mark.action();
    for (let i = 0; i < 1000 && !g.rescueHeli?.landed; i++) {
      Object.assign(g.vitals, { health: 100 });
      for (const m of g.squad.members) if (m.status === 'rescued') m.vitals.health = 100;
      g.simulate(0.2);
    }
    return { landed: g.rescueHeli?.landed, marked: g.campaign.flags.lzMarked, mode: g.mode, t: g.rescueHeli?.t, y: g.rescueHeli?.mesh.position.y };
  });
  assert(r.landed && r.marked, JSON.stringify(r));
  await ev(() => { const g = window.__BF.game; const h = g.rescueHeli.mesh.position; g.player.place(h.x + 6, 0, h.z + 6, Math.atan2(6, 6)); g.player.yaw = Math.atan2(-(h.x - g.player.pos.x), -(h.z - g.player.pos.z)); g.player.pitch = 0.05; g.simulate(0.1); });
  await shot('18-extraction');
  const end = await ev(() => {
    const g = window.__BF.game;
    const b = g.gatherInteractables().find((i) => i.id === 'board');
    if (!b) throw new Error('no board interaction');
    b.action();
    return { mode: g.mode, ending: g.ending?.id, aboard: document.querySelector('.endscreen h1')?.textContent };
  });
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, '19-ending.jpg'), quality: 82, type: 'jpeg' });
  assert(end.mode === 'ending' && end.ending, JSON.stringify(end));
  return `${end.ending}: ${end.aboard}`;
});

await step('death screen', async () => {
  const loads = await ev(() => window.__BF.game.loadCount || 0);
  await ev(() => window.__BF.app.loadSlot('1'));
  await page.waitForFunction((n) => (window.__BF.game.loadCount || 0) > n && window.__BF.game.mode === 'play', loads, { timeout: 120000 });
  await ev(() => { const g = window.__BF.game; g.stop(); g.godMode = false; g.damagePlayer(500, { kind: 'bullet', part: 'head' }); });
  await page.waitForSelector('.endscreen.dead', { timeout: 5000 });
  if (SHOTS) await page.screenshot({ path: path.join(shotDir, '20-death.jpg'), quality: 82, type: 'jpeg' });
  await page.click('.endscreen >> text=Main menu');
  await page.waitForSelector('.menu-box', { timeout: 10000 });
});

await step('no page errors', async () => {
  assert(errors.length === 0, `${errors.length} errors:\n${errors.slice(0, 8).join('\n')}`);
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nAll smoke steps passed');
process.exit(failed ? 1 : 0);
