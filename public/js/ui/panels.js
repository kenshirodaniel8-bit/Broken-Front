// The tactical menu: Inventory, Map, Journal and Squad tabs.

import { h, clear, bar } from './dom.js';
import { ITEMS, CATEGORIES, WEAPONS } from '../data/items.js';
import {
  HELMETS, VESTS, BACKPACKS, GLOVES, BOOTS, EYEWEAR, RADIOS, KNEEPADS, ROLES,
} from '../data/customization.js';
import { OBJECTIVES, objectiveText, DAYS } from '../game/campaign.js';
import { condition, activeInjuries, INJURY_TYPES } from '../game/survival.js';
import { formatClock } from '../core/util.js';

const TABS = [['inventory', 'Inventory'], ['map', 'Map'], ['journal', 'Journal'], ['squad', 'Squad']];

export function installPanels(ui) {
  ui.openTactical = (tab = 'inventory') => {
    const g = ui.game;
    ui.tacticalTab = tab;
    const body = h('div', { class: 'tac-body' });
    const tabs = h('div', { class: 'tac-tabs' }, ...TABS.map(([id, label]) => h('button', {
      class: id === tab ? 'active' : '', onclick: () => ui.openTactical(id),
    }, label)), h('button', { class: 'close', onclick: () => ui.close('tactical') }, 'Close ✕'));
    const panel = h('div', { class: 'panel tactical' }, tabs, body);
    const entry = ui.open('tactical', panel);
    const render = { inventory: renderInventory, map: renderMap, journal: renderJournal, squad: renderSquad }[tab];
    render(ui, g, body, entry);
    entry.rerender = () => { clear(body); render(ui, g, body, entry); };
    if (tab === 'inventory') ui.flags.inventoryOpened = true;
  };
}

function renderInventory(ui, g, body, entry) {
  const inv = g.inv;
  const left = h('div', { class: 'inv-list' });
  const right = h('div', { class: 'inv-side' });
  body.append(left, right);
  const rerender = () => entry.rerender();
  const grouped = inv.grouped();
  const order = ['weapon', 'ammo', 'medical', 'food', 'water', 'power', 'comms', 'tool', 'document', 'gear'];
  for (const cat of order) {
    const stacks = grouped[cat];
    if (!stacks?.length) continue;
    left.append(h('h3', {}, CATEGORIES[cat]));
    for (const [idx, s] of stacks.entries()) {
      const def = ITEMS[s.id];
      const actions = [];
      const usable = def.use || ['drone', 'drone_battery', 'drone_broken', 'flare', 'smoke_grenade', 'batteries', 'flashlight'].includes(s.id) || def.cat === 'gear' || def.cat === 'document';
      if (def.weapon) {
        const eq = inv.primary === def.weapon || inv.sidearm === def.weapon;
        actions.push(h('button', { disabled: eq, onclick: () => { inv.equip(def.weapon); g.combat.rebuild(); rerender(); } }, eq ? 'Equipped' : 'Equip'));
      } else if (usable) {
        const label = def.cat === 'gear' ? 'Wear' : def.cat === 'document' ? 'Read' : s.id === 'dirty_water' && inv.has('purify_tabs') ? 'Purify' : s.id === 'drone' ? 'Deploy' : s.id === 'drone_broken' ? 'Repair' : 'Use';
        actions.push(h('button', { onclick: () => { if (s.id === 'drone') ui.close('tactical'); g.useItem(s.id); if (ui.isOpen('tactical')) rerender(); } }, label));
      }
      if (['medical', 'food', 'water', 'tool', 'power'].includes(def.cat) && inv.quick.length) {
        const sel = h('select', { title: 'Assign to a pouch slot', onchange: (e) => { inv.assignQuick(Number(e.target.value), s.id); rerender(); } },
          h('option', { value: '' }, 'Slot…'), ...inv.quick.map((q, i) => h('option', { value: String(i), selected: q === s.id }, `Key ${i + 3}`)));
        actions.push(sel);
      }
      if (def.cat !== 'document') actions.push(h('button', { class: 'ghost', onclick: () => { drop(g, s.id, def.stack > 1 ? s.n : 1); rerender(); } }, 'Drop'));
      const charge = s.data?.charge != null ? ` · ${Math.round(s.data.charge)}%` : '';
      left.append(h('div', { class: 'inv-row', title: def.desc || '' },
        h('div', { class: 'nm' }, def.name, h('small', {}, def.desc ? ` — ${def.desc}` : '')),
        h('div', { class: 'ct' }, `×${s.n}${charge}`),
        h('div', { class: 'wt' }, `${(def.weight * s.n).toFixed(2)} kg`),
        h('div', { class: 'act' }, ...actions)));
      void idx;
    }
  }
  if (!inv.stacks.length) left.append(h('p', { class: 'muted' }, 'You are carrying nothing.'));
  // Equipment and stats.
  const c = g.config;
  const st = g.stats;
  const w = inv.weight();
  right.append(
    h('h3', {}, 'Load'),
    h('div', { class: 'loadbar' }, bar(w, st.capacity + 8, w > st.capacity ? 'warn' : ''), h('span', {}, `${w.toFixed(1)} / ${st.capacity} kg${w > st.capacity ? ' — overloaded, slower' : ''}`)),
    h('h3', {}, 'Worn equipment'),
    h('div', { class: 'eq' },
      eqRow('Role', ROLES[c.role].label), eqRow('Helmet', HELMETS[c.helmet].label), eqRow('Vest', `${VESTS[c.vest].label} (${VESTS[c.vest].slots} pouches)`), eqRow('Backpack', BACKPACKS[c.backpack].label),
      eqRow('Radio', RADIOS[c.radio].label), eqRow('Eyewear', EYEWEAR[c.eyewear]), eqRow('Gloves', GLOVES[c.gloves]), eqRow('Knee pads', KNEEPADS[c.kneepads]), eqRow('Boots', BOOTS[c.boots])),
    h('h3', {}, 'Weapons'),
    h('div', { class: 'eq' }, eqRow('Primary', inv.primary ? `${WEAPONS[inv.primary].name} — ${inv.mags[inv.primary] || 0} + ${inv.reserve(inv.primary)}` : '—'), eqRow('Sidearm', inv.sidearm ? `${WEAPONS[inv.sidearm].name} — ${inv.mags[inv.sidearm] || 0} + ${inv.reserve(inv.sidearm)}` : '—')),
    h('h3', {}, 'Protection'),
    h('div', { class: 'eq' }, eqRow('Body armour', `${Math.round(st.armor * 100)}%`), eqRow('Head', `${Math.round(st.headArmor * 100)}%`), eqRow('Dust / eyes', `${Math.round(st.dustProtection * 100)}%`)),
    h('h3', {}, 'Pouch slots (keys 3–8)'),
    h('div', { class: 'quick-list' }, ...inv.quick.map((q, i) => h('div', { class: 'q' }, h('b', {}, String(i + 3)), q ? `${ITEMS[q].name} ×${inv.count(q)}` : 'empty', q ? h('button', { class: 'ghost tiny', onclick: () => { inv.quick[i] = null; rerender(); } }, '✕') : ''))),
    h('h3', {}, 'Actions'),
    h('div', { class: 'actions' },
      h('button', { onclick: () => { ui.close('tactical'); g.sleep(0.5); } }, 'Rest 30 minutes'),
      g.prologue.phase === 'done' ? h('button', { onclick: () => { ui.close('tactical'); ui.openPhone(); } }, 'Phone (P)') : ''),
  );
}

const eqRow = (k, v) => h('div', { class: 'eq-row' }, h('span', {}, k), h('b', {}, v));

function drop(g, id, n) {
  const P = g.player.pos;
  const st = g.inv.stackOf(id);
  const data = st?.data || null;
  const moved = g.inv.remove(id, n);
  if (!moved) return;
  const cid = `drop_${Math.round(P.x)}_${Math.round(P.z)}`;
  let c = g.containers.find(cid);
  if (!c) c = g.containers.addLoose(cid, P.x, P.z, 'dropped items', [], 'bag');
  const items = g.containers.contents(c);
  items.push({ id, n: moved, data });
  g.toast(`Dropped ${ITEMS[id].name}${moved > 1 ? ` ×${moved}` : ''}.`, 'info');
}

function renderMap(ui, g, body, entry) {
  const canvas = h('canvas', { class: 'bigmap' });
  const side = h('div', { class: 'map-side' });
  body.append(h('div', { class: 'map-wrap' }, canvas), side);
  const view = { cx: g.player.pos.x, cz: g.player.pos.z, scale: 2.2 };
  let drag = null;
  const draw = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(200, r.width);
    canvas.height = Math.max(200, r.height);
    ui.map.updateFog(1);
    ui.map.draw(canvas.getContext('2d'), canvas.width, canvas.height, { ...view, labels: true });
  };
  canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false }; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    view.cx = drag.cx - dx / view.scale;
    view.cz = drag.cz - dy / view.scale;
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && e.button === 0) {
      const r = canvas.getBoundingClientRect();
      g.mapState.waypoint = ui.map.screenToWorld(e.clientX - r.left, e.clientY - r.top, canvas.width, canvas.height, view);
      g.toast('Waypoint set (shown on your compass).', 'info');
      draw();
    }
    drag = null;
  });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); g.mapState.waypoint = null; draw(); });
  canvas.addEventListener('wheel', (e) => { view.scale = Math.max(0.8, Math.min(6, view.scale * (e.deltaY > 0 ? 0.85 : 1.18))); draw(); }, { passive: true });
  const legend = [['#ffffff', 'You'], ['#4fc36a', 'Rescued teammate'], ['#f2c14e', 'Teammate found / clue area'], ['#4fa3e0', 'Shelter'], ['#7be07b', 'Landing zone'], ['#e05a4f', 'Enemy sighting / danger'], ['#c0392b', 'Blocked street (X)'], ['#6fd3ff', 'Drone']];
  side.append(
    h('h3', {}, 'Kreuzhafen-Mitte'),
    h('p', { class: 'muted' }, g.mapState.fullMap ? 'Tourist map: all streets known.' : 'Only areas you (or your drone) have seen are shown.'),
    h('div', { class: 'legend' }, ...legend.map(([c, t]) => h('div', {}, h('i', { style: { background: c } }), t))),
    h('p', { class: 'muted' }, 'Drag to pan · wheel to zoom · click to set a waypoint · right-click to clear it.'),
    h('button', { onclick: () => { view.cx = g.player.pos.x; view.cz = g.player.pos.z; draw(); } }, 'Centre on me'),
  );
  requestAnimationFrame(draw);
  entry.update = () => {};
}

function renderJournal(ui, g, body) {
  const c = g.campaign;
  const facts = g.facts();
  const active = OBJECTIVES.filter((o) => c.objectives[o.id]?.state === 'active');
  const done = OBJECTIVES.filter((o) => c.objectives[o.id]?.state === 'done');
  const failed = OBJECTIVES.filter((o) => c.objectives[o.id]?.state === 'failed');
  const day = DAYS[Math.min(c.day, 12)];
  const docs = g.inv.stacks.filter((s) => ITEMS[s.id].cat === 'document');
  body.append(
    h('div', { class: 'journal-col' },
      h('h3', {}, `Day ${c.day} — ${day?.title || 'Overtime'}`),
      h('p', { class: 'brief' }, day?.brief || ''),
      c.rescue.confirmed ? h('p', { class: 'good' }, `Rescue confirmed: Day ${c.rescue.day}, 06:00–18:00, Stadtpark LZ.`) : h('p', { class: 'warn' }, 'No rescue confirmed yet. Nobody knows you are alive.'),
      h('h3', {}, 'Objectives'),
      ...active.map((o) => h('div', { class: `jobj${o.optional ? ' optional' : ''}` }, (o.optional ? 'Optional: ' : '') + objectiveText(o.id, facts))),
      done.length ? h('h4', {}, 'Completed') : '',
      ...done.slice(-8).map((o) => h('div', { class: 'jobj done' }, objectiveText(o.id, facts))),
      ...failed.map((o) => h('div', { class: 'jobj failed' }, objectiveText(o.id, facts))),
      h('h3', {}, 'Documents'),
      ...(docs.length ? docs.map((d) => h('button', { class: 'doc', onclick: () => ui.readDocument(d.id) }, ITEMS[d.id].name)) : [h('p', { class: 'muted' }, 'No documents.')]),
    ),
    h('div', { class: 'journal-col log' },
      h('h3', {}, 'Log'),
      ...c.log.slice().reverse().slice(0, 120).map((e) => h('div', { class: `log ${e.kind}` }, h('span', { class: 'when' }, `D${e.day} ${e.time}`), e.text)),
    ),
  );
}

function renderSquad(ui, g, body, entry) {
  const hasRadio = g.stats.radioRange > 0;
  const cards = g.squad.members.map((m) => {
    const v = m.vitals;
    const known = m.status === 'rescued' || m.status === 'dead' || m.exact;
    const status = m.status === 'dead' ? 'Killed in action' : m.status === 'rescued' ? `Rescued — ${({ follow: 'following you', wait: 'holding position', shelter: m.sheltered ? 'at the shelter' : 'moving to the shelter' })[m.order]}` : m.exact ? 'Found — needs your help' : m.knownArea ? 'Heard — approximate area on map' : m.status === 'prologue' ? 'With you' : 'Missing';
    const near = Math.hypot(m.pos.x - g.player.pos.x, m.pos.z - g.player.pos.z) < 6;
    const canOrder = m.status === 'rescued' && (near || hasRadio);
    return h('div', { class: `squad-card ${m.status}` },
      h('div', { class: 'hdr' }, h('b', {}, `${m.def.rank} ${m.def.name}`), h('span', {}, `${m.def.callsign} · ${m.def.role}`)),
      h('p', { class: 'muted' }, m.def.bio),
      h('div', { class: 'st' }, status),
      known && m.status !== 'dead' ? h('div', { class: 'needs' },
        h('div', {}, 'Health', bar(v.health, 100, 'hp')), h('div', {}, 'Food', bar(100 - v.hunger, 100, 'food')), h('div', {}, 'Water', bar(100 - v.thirst, 100, 'water')),
        h('div', { class: 'inj' }, condition(v).label, ...activeInjuries(v).map((i) => h('span', {}, ` · ${INJURY_TYPES[i.type].label} (${i.part})`)))) : '',
      canOrder ? h('div', { class: 'orders' },
        h('span', { class: 'muted' }, near ? 'Orders:' : 'Radio orders:'),
        ...[['follow', 'Follow me'], ['wait', 'Hold position'], ['shelter', 'Go to shelter']].map(([o, l]) => h('button', {
          disabled: m.order === o || (o === 'shelter' && !g.shelter) || (o === 'follow' && !near), onclick: () => { g.squad.setOrder(m, o); entry.rerender(); },
        }, l))) : '',
    );
  });
  body.append(h('div', { class: 'squad-grid' }, ...cards), h('p', { class: 'muted' }, hasRadio ? 'Your radio lets you give orders from a distance.' : 'Without a radio you can only give orders face to face.'));
}

export { formatClock };
