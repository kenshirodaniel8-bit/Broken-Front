// Modal dialogs: loot, stash, shop, treatment, teammate, sleep, shelter,
// documents, death and endings.

import { h, clear, bar } from './dom.js';
import { ITEMS } from '../data/items.js';
import { activeInjuries, condition, INJURY_TYPES, usefulTreatments, hasInjury, treat } from '../game/survival.js';
import { latestSave } from '../game/save.js';
import { formatClock } from '../core/util.js';

function dialog(title, ...content) {
  return h('div', { class: 'panel dialog' }, h('div', { class: 'dlg-hdr' }, h('h2', {}, title)), ...content);
}

export function installDialogs(ui, { onMainMenu, onLoadSlot }) {
  // --- Loot --------------------------------------------------------------------------
  ui.openLoot = (c) => {
    const g = ui.game;
    const list = h('div', { class: 'loot-list' });
    const foot = h('div', { class: 'dlg-foot' });
    const render = () => {
      const items = g.containers.contents(c);
      clear(list);
      if (!items.length) list.append(h('p', { class: 'muted' }, 'Nothing useful here.'));
      items.forEach((it, i) => {
        const def = ITEMS[it.id];
        const room = g.inv.roomFor(it.id);
        list.append(h('div', { class: 'loot-row' }, h('div', { class: 'nm' }, def.name, h('small', {}, def.desc ? ` — ${def.desc}` : '')), h('div', { class: 'ct' }, `×${it.n}`), h('div', { class: 'wt' }, `${(def.weight * it.n).toFixed(2)} kg`),
          h('button', { disabled: room < 1, onclick: () => { const n = g.containers.take(c, i); if (n) g.audio.play('pickup', { bus: 'ui' }); else g.toast('Too heavy to carry.', 'warn'); render(); } }, room < 1 ? 'Too heavy' : 'Take')));
      });
      clear(foot).append(h('div', { class: 'loadbar' }, bar(g.inv.weight(), g.stats.capacity + 8, g.inv.weight() > g.stats.capacity ? 'warn' : ''), h('span', {}, `${g.inv.weight().toFixed(1)} / ${g.stats.capacity} kg`)),
        h('button', { disabled: !items.length, onclick: () => { const n = g.containers.takeAll(c); if (n) g.audio.play('rustle', { bus: 'ui' }); render(); } }, 'Take all'), h('button', { class: 'ghost', onclick: () => ui.close('loot') }, 'Close'));
    };
    render();
    g.audio.play('rustle', { bus: 'ui', gain: 0.6 });
    ui.open('loot', dialog(cap(c.name || c.kind), list, foot));
  };

  // --- Shelter stash ------------------------------------------------------------------------
  ui.openStash = () => {
    const g = ui.game;
    const body = h('div', { class: 'two-col' });
    const render = () => {
      clear(body);
      const stashCol = h('div', {}, h('h3', {}, 'Stash'));
      const invCol = h('div', {}, h('h3', {}, `You (${g.inv.weight().toFixed(1)}/${g.stats.capacity} kg)`));
      if (!g.stash.stacks.length) stashCol.append(h('p', { class: 'muted' }, 'Empty. Teammates at the shelter eat and drink from here.'));
      for (const s of [...g.stash.stacks]) {
        stashCol.append(h('div', { class: 'loot-row' }, h('div', { class: 'nm' }, ITEMS[s.id].name), h('div', { class: 'ct' }, `×${s.n}`),
          h('button', { onclick: () => { const n = g.inv.add(s.id, 1, s.data); if (n) g.stash.remove(s.id, 1); else g.toast('Too heavy.', 'warn'); render(); } }, 'Take 1'),
          h('button', { class: 'ghost', onclick: () => { const n = g.inv.add(s.id, s.n, s.data); g.stash.remove(s.id, n); render(); } }, 'All')));
      }
      for (const s of g.inv.stacks.filter((k) => !ITEMS[k.id].weapon && ITEMS[k.id].cat !== 'document')) {
        invCol.append(h('div', { class: 'loot-row' }, h('div', { class: 'nm' }, ITEMS[s.id].name), h('div', { class: 'ct' }, `×${s.n}`),
          h('button', { onclick: () => { const data = s.data; if (g.inv.remove(s.id, 1)) g.stash.add(s.id, 1, data); render(); } }, 'Store 1'),
          h('button', { class: 'ghost', onclick: () => { const n = s.n; const data = s.data; if (g.inv.remove(s.id, n)) g.stash.add(s.id, n, data); render(); } }, 'All')));
      }
      // Charging the drone at the shelter.
      const pb = g.inv.stackOf('power_bank');
      if ((g.inv.has('drone') || g.drone.deployed === false) && pb && (pb.data?.charge ?? 0) > 0 && g.drone.battery < 100) {
        invCol.append(h('button', { onclick: () => { const give = Math.min(pb.data.charge, 40, 100 - g.drone.battery); pb.data.charge -= give; g.drone.battery += give * 1.5; g.drone.battery = Math.min(100, g.drone.battery); g.toast(`Drone charged to ${Math.round(g.drone.battery)}%.`, 'good'); render(); } }, 'Charge the drone from the power bank'));
      }
      body.append(stashCol, invCol);
    };
    render();
    ui.open('stash', dialog('Shelter stash', body, h('div', { class: 'dlg-foot' }, h('button', { onclick: () => ui.close('stash') }, 'Close'))));
  };

  // --- Shop (opening) ----------------------------------------------------------------------
  ui.openShop = (shop) => {
    const g = ui.game;
    const list = h('div', { class: 'loot-list' });
    const money = h('div', { class: 'money' });
    const render = () => {
      money.textContent = `Budget: €${g.money.toFixed(2)}`;
      clear(list);
      for (const id of shop.items) {
        const def = ITEMS[id];
        const can = g.money >= def.price - 1e-6;
        list.append(h('div', { class: 'loot-row' }, h('div', { class: 'nm' }, def.name, h('small', {}, def.desc ? ` — ${def.desc}` : '')), h('div', { class: 'ct' }, `€${def.price.toFixed(2)}`), h('div', { class: 'wt' }, `you have ${g.inv.count(id)}`),
          h('button', { disabled: !can, onclick: () => {
            if (g.inv.add(id, 1) < 1) { g.toast('You cannot carry more.', 'warn'); return; }
            g.money -= def.price;
            g.prologue.purchases.push(id);
            g.audio.play('beep', { bus: 'ui', freq: 1200, len: 0.06 });
            render();
          } }, can ? 'Buy' : 'Too expensive')));
      }
    };
    render();
    ui.open('shop', dialog(shop.name, h('p', { class: 'muted' }, '"Guten Tag! Was darf es sein?" — the shopkeeper smiles at the soldiers.'), money, list, h('div', { class: 'dlg-foot' }, h('button', { onclick: () => ui.close('shop') }, 'Leave'))));
  };

  // --- Treating a teammate --------------------------------------------------------------------
  ui.openTreat = (m) => {
    const g = ui.game;
    const body = h('div', {});
    const render = () => {
      clear(body);
      const v = m.vitals;
      const injuries = activeInjuries(v);
      const available = g.inv.stacks.map((s) => s.id);
      if (g.inv.has('plank') && (g.inv.has('duct_tape') || g.inv.has('bandage'))) available.push('improvised_splint');
      const useful = usefulTreatments(v, available);
      body.append(
        h('div', { class: 'patient' }, h('b', {}, `${m.def.rank} ${m.def.name}`), ` — ${condition(v).label}`, bar(v.health, 100, 'hp')),
        h('h3', {}, 'Injuries'),
        ...(injuries.length ? injuries.map((i) => h('div', { class: `inj-row ${INJURY_TYPES[i.type].severity}` }, `${INJURY_TYPES[i.type].label} (${i.part}) — treat with: ${INJURY_TYPES[i.type].treatedBy.map((t) => t === 'improvised_splint' ? 'plank + tape/bandage' : ITEMS[t]?.name || t).join(' or ')}`)) : [h('p', {}, 'No untreated injuries.')]),
        h('h3', {}, 'Your supplies that would help'),
        ...(useful.length ? useful.map((id) => h('button', { class: 'treat-btn', onclick: () => treatWith(id) }, id === 'improvised_splint' ? 'Improvised splint (plank + tape/bandage)' : `${ITEMS[id].name} (×${g.inv.count(id)})`)) : [h('p', { class: 'warn' }, 'You have nothing that helps. Search the Apotheke, the police station or the fire station.')]),
      );
      if (m.status === 'rescued') body.append(h('p', { class: 'good' }, `${m.name} can walk.`));
    };
    const treatWith = (id) => {
      g.playerSay('treat');
      const time = 2.2 / g.stats.treatSpeed;
      ui.close('treat');
      g.player.frozen = true;
      g.audio.play('bandage', { bus: 'ui' });
      ui.hint(`Treating ${m.name}...`, time);
      setTimeout(() => {
        g.player.frozen = false;
        const t = g.squad.applyTreatment(m, id);
        g.toast(t ? `${m.name}: ${INJURY_TYPES[t].label.toLowerCase()} treated.` : 'That did not help.', t ? 'good' : 'warn');
        if (m.status !== 'rescued' && activeInjuries(m.vitals).length) ui.openTreat(m);
      }, time * 1000);
    };
    render();
    ui.open('treat', dialog(`Treat ${m.name}`, body, h('div', { class: 'dlg-foot' }, h('button', { class: 'ghost', onclick: () => ui.close('treat') }, 'Close'))));
  };

  // --- Talking to a rescued teammate ----------------------------------------------------------
  ui.openTeammate = (m) => {
    const g = ui.game;
    const body = h('div', {});
    const render = () => {
      clear(body);
      const v = m.vitals;
      const foods = g.inv.stacks.filter((s) => ITEMS[s.id].cat === 'food');
      const drinks = g.inv.stacks.filter((s) => ITEMS[s.id].cat === 'water' && s.id !== 'dirty_water');
      const injured = activeInjuries(v).length > 0;
      const sari = m.def.medic && activeInjuries(g.vitals).length;
      body.append(
        h('div', { class: 'patient' }, h('b', {}, `${m.def.rank} ${m.def.name}`), ` — ${m.def.role} · ${condition(v).label}`),
        h('div', { class: 'needs' }, h('div', {}, 'Health', bar(v.health, 100, 'hp')), h('div', {}, 'Food', bar(100 - v.hunger, 100, 'food')), h('div', {}, 'Water', bar(100 - v.thirst, 100, 'water'))),
        h('div', { class: 'btn-grid' },
          h('button', { disabled: m.order === 'follow', onclick: () => { g.squad.setOrder(m, 'follow'); ui.close('mate'); } }, 'Follow me'),
          h('button', { disabled: m.order === 'wait', onclick: () => { g.squad.setOrder(m, 'wait'); ui.close('mate'); } }, 'Wait here'),
          h('button', { disabled: !g.shelter || m.order === 'shelter', title: g.shelter ? '' : 'Set up a shelter first', onclick: () => { g.squad.setOrder(m, 'shelter'); ui.close('mate'); } }, 'Go to the shelter'),
          injured ? h('button', { onclick: () => { ui.close('mate'); ui.openTreat(m); } }, 'Treat injuries') : '',
          sari ? h('button', { onclick: () => { ui.close('mate'); medicTreatsPlayer(g, m); } }, 'Ask Sari to treat you') : '',
          h('button', { class: 'ghost', onclick: () => { m.say(g.darkness > 0.6 ? 'night' : 'idle'); } }, 'Talk'),
        ),
        h('h3', {}, 'Give food'), foods.length ? h('div', { class: 'btn-grid' }, ...foods.map((s) => h('button', { onclick: () => { g.squad.give(m, s.id); render(); } }, `${ITEMS[s.id].name} (×${s.n})`))) : h('p', { class: 'muted' }, 'You have no food.'),
        h('h3', {}, 'Give water'), drinks.length ? h('div', { class: 'btn-grid' }, ...drinks.map((s) => h('button', { onclick: () => { g.squad.give(m, s.id); render(); } }, `${ITEMS[s.id].name} (×${s.n})`))) : h('p', { class: 'muted' }, 'You have nothing to drink.'),
      );
    };
    render();
    ui.open('mate', dialog(m.name, body, h('div', { class: 'dlg-foot' }, h('button', { class: 'ghost', onclick: () => ui.close('mate') }, 'Close'))));
  };

  // --- Sleep / rest -------------------------------------------------------------------------
  ui.openSleep = () => {
    const g = ui.game;
    const v = g.vitals;
    const warn = [];
    if (v.hunger > 60) warn.push('You are hungry - eat before sleeping.');
    if (v.thirst > 60) warn.push('You are thirsty - drink before sleeping.');
    if (activeInjuries(v).some((i) => i.type.startsWith('bleeding'))) warn.push('You are bleeding. Treat it first or you may not wake up.');
    const go = (hrs) => { ui.close('sleep'); g.sleep(hrs); };
    ui.open('sleep', dialog('Rest', h('p', {}, `It is ${formatClock(g.campaign.minutes)}. Fatigue ${Math.round(v.fatigue)}%. Sleeping at the shelter restores more health.`),
      ...warn.map((w) => h('p', { class: 'warn' }, w)),
      h('div', { class: 'btn-grid' }, h('button', { onclick: () => go('morning') }, 'Sleep until 06:00'), h('button', { onclick: () => go(2) }, '2 hours'), h('button', { onclick: () => go(4) }, '4 hours'), h('button', { onclick: () => go(8) }, '8 hours')),
      h('div', { class: 'dlg-foot' }, h('button', { class: 'ghost', onclick: () => ui.close('sleep') }, 'Cancel'))));
  };

  // --- Choosing a shelter ---------------------------------------------------------------------
  ui.confirmShelter = (sh) => {
    const g = ui.game;
    ui.open('shelter', dialog(sh.name, h('p', {}, sh.desc), g.shelter ? h('p', { class: 'warn' }, 'Your stash stays where it is - carry what you need. Teammates ordered to the shelter will move here.') : '',
      h('div', { class: 'dlg-foot' }, h('button', { onclick: () => { g.setShelter(sh); ui.close('shelter'); } }, g.shelter ? 'Move the shelter here' : 'Set up the shelter here'), h('button', { class: 'ghost', onclick: () => ui.close('shelter') }, 'Not here'))));
  };

  ui.readDocument = (id) => {
    const def = ITEMS[id];
    ui.open('doc', dialog(def.name, h('p', { class: 'doc-text' }, def.desc || ''), h('div', { class: 'dlg-foot' }, h('button', { onclick: () => ui.close('doc') }, 'Close'))));
  };

  // --- Death and endings ----------------------------------------------------------------------
  ui.showDeath = (reason) => {
    const g = ui.game;
    const last = latestSave();
    ui.open('death', h('div', { class: 'endscreen dead' },
      h('h1', {}, 'KILLED IN ACTION'), h('p', {}, reason), h('p', { class: 'muted' }, `Day ${g.campaign.day}, ${formatClock(g.campaign.minutes)}`),
      h('div', { class: 'btn-col' },
        last ? h('button', { onclick: () => { ui.close('death'); onLoadSlot(last.slot); } }, `Load latest save (${last.label || `slot ${last.slot}`})`) : '',
        h('button', { class: 'ghost', onclick: () => { ui.close('death'); onMainMenu(); } }, 'Main menu'))), { blocks: true });
  };

  ui.showEnding = (ending, stats) => {
    ui.open('ending', h('div', { class: `endscreen ${ending.tone}` },
      h('div', { class: 'small' }, 'BROKEN FRONT'), h('h1', {}, ending.title), h('p', { class: 'lead' }, ending.text),
      h('div', { class: 'epilogue' }, ...ending.epilogue.map((e) => h('p', {}, e))),
      h('div', { class: 'stats' }, `Days survived: ${stats.days} · Teammates rescued: ${stats.rescued} · Aboard the helicopter: ${stats.aboard} · Enemies down: ${stats.enemiesDown} · Shots fired: ${stats.shots}`),
      h('div', { class: 'btn-col' }, h('button', { onclick: () => { ui.close('ending'); onMainMenu(); } }, 'Main menu'))), { blocks: true });
  };
}

function medicTreatsPlayer(g, sari) {
  const available = g.inv.stacks.map((s) => s.id);
  const use = usefulTreatments(g.vitals, available);
  if (!use.length) { sari.say('pain'); g.toast('Sari: "I need supplies to treat you - bandages, splints, antibiotics."', 'warn'); return; }
  const id = use[0];
  g.inv.remove(id);
  const t = treat(g.vitals, id, 1.6);
  g.audio.play('bandage', { bus: 'ui' });
  sari.say('heal');
  g.toast(t ? `Sari treated your ${INJURY_TYPES[t].label.toLowerCase()}.` : 'Sari patched you up.', 'good');
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export { hasInjury };
