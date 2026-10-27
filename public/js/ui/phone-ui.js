// The damaged phone: an interactive device with a repair bench beside it.

import { h, clear } from './dom.js';
import {
  components, repairOptions, applyRepair, devices, connectChance, dropChance, callStepCost, CALL_SCRIPT, rescueMessage, COMMAND_NUMBER, audioOk,
} from '../game/phone.js';
import { confirmRescue, logEntry } from '../game/campaign.js';
import { formatClock } from '../core/util.js';
import { ITEMS } from '../data/items.js';

const HQ_VOICE = { pitch: 0.82, rate: 0.98, lang: 'en-US' };

export function installPhone(ui) {
  ui.openPhone = () => {
    const g = ui.game;
    if (g.prologue.phase !== 'done') return;
    const p = g.phone;
    if (!p.inspected) {
      p.inspected = true;
      logEntry(g.campaign, 'You inspected your phone: cracked screen, dead battery, broken speaker, corrupted contacts.', 'note');
    }
    const state = { app: 'home', call: null, busy: null };
    const screen = h('div', { class: 'ph-screen' });
    const device = h('div', { class: `ph-device ${p.device}` }, screen, h('div', { class: 'ph-crack' }), h('div', { class: 'ph-btn home', onclick: () => { if (!state.call) { state.app = 'home'; render(); } } }));
    const side = h('div', { class: 'ph-side' });
    const wrap = h('div', { class: 'panel phone-wrap' }, device, side, h('button', { class: 'close ph-close', onclick: () => ui.close('phone') }, 'Put away (P)'));
    const entry = ui.open('phone', wrap, { blocks: false, captures: true });
    g.audio.play('click', { bus: 'ui' });

    // Taps in the cracked corner sometimes don't register.
    const tap = (fn) => (e) => {
      if (p.touch !== 'ok') {
        const r = screen.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        if (x > 0.55 && y > 0.6 && Math.random() < 0.55) {
          screen.classList.add('glitch');
          setTimeout(() => screen.classList.remove('glitch'), 200);
          return;
        }
      }
      fn(e);
    };
    const appBtn = (id, label, icon) => h('button', { class: 'app', onclick: tap(() => { state.app = id; render(); }) }, h('i', {}, icon), label);

    const render = () => {
      clear(screen);
      device.classList.toggle('cracked', p.screen !== 'ok');
      const bars = g.signalHere();
      if (bars >= 3) g.setFlag('signalFound', `Signal: ${bars} bars here. Good enough for a call.`);
      if (p.battery <= 0) {
        screen.append(h('div', { class: 'ph-off' }, h('div', {}, '⏻'), h('p', {}, 'No power'), h('small', {}, 'Charge it: power bank + cable, car battery, crank or solar charger.')));
      } else {
        screen.append(h('div', { class: 'ph-status' }, h('span', {}, formatClock(g.campaign.minutes)), h('span', {}, `${'▮'.repeat(bars)}${'▯'.repeat(4 - bars)} ${bars ? 'D-NET' : 'No service'}`), h('span', {}, `${Math.round(p.battery)}%`)));
        const app = h('div', { class: 'ph-app' });
        screen.append(app);
        if (state.call) renderCall(app);
        else if (state.app === 'home') {
          app.append(h('div', { class: 'ph-home' },
            appBtn('phone', 'Phone', '✆'), appBtn('messages', 'Messages', '✉'), appBtn('map', 'Map', '⌖'), appBtn('camera', 'Camera', '◉'), appBtn('settings', 'Diagnostics', '⚙'), appBtn('torch', 'Torch', '☀')));
        } else if (state.app === 'phone') renderDialer(app);
        else if (state.app === 'messages') {
          app.append(h('h4', {}, 'Messages'), ...p.messages.map((m) => h('div', { class: 'msg' }, h('b', {}, m.from), h('small', {}, m.day ? ` Day ${m.day} ${m.time}` : ` ${m.time}`), h('p', {}, m.text))));
        } else if (state.app === 'map') {
          const c = h('canvas', { class: 'ph-map', width: 240, height: 300 });
          app.append(h('h4', {}, 'Map (GPS)'), c);
          ui.map.updateFog(1);
          ui.map.draw(c.getContext('2d'), 240, 300, { cx: g.player.pos.x, cz: g.player.pos.z, scale: 1.4, labels: true });
        } else if (state.app === 'camera') {
          app.append(h('h4', {}, 'Camera'), p.camera === 'ok' ? h('p', {}, 'The camera works. (Nothing here needs a photo.)') : h('div', { class: 'ph-noise' }, 'LENS ERROR'));
        } else if (state.app === 'settings') {
          app.append(h('h4', {}, 'Diagnostics'), ...components(p).map((c) => h('div', { class: `diag ${c.ok ? 'ok' : 'bad'}` }, h('b', {}, c.label), h('span', {}, c.status))));
        } else if (state.app === 'torch') {
          g.phoneTorch = !g.phoneTorch;
          state.app = 'home';
          g.toast(g.phoneTorch ? 'Phone torch on (drains the battery).' : 'Phone torch off.', 'info');
          render();
          return;
        }
      }
      renderSide();
    };

    const renderDialer = (app) => {
      app.append(h('h4', {}, 'Contacts'));
      if (!p.contactKnown) {
        app.append(h('p', { class: 'warn' }, 'Contact storage error (0x7F). Contacts unavailable.'));
        if (g.inv.has('emergency_card')) app.append(h('button', { class: 'ph-wide', onclick: tap(() => { applyRepair(p, 'card', g.commsContext()); g.toast(`Dialled from the card: ${COMMAND_NUMBER}`, 'info'); render(); }) }, `Dial ${COMMAND_NUMBER} from the card`));
        else if (g.squad.get('dimas').status === 'rescued') app.append(h('button', { class: 'ph-wide', onclick: tap(() => { applyRepair(p, 'dimas', g.commsContext()); render(); }) }, 'Ask Dimas for the number'));
        else app.append(h('p', { class: 'muted' }, 'You do not remember the Central Command number. The unit card was in the squad vehicle... or Bima has one.'));
        return;
      }
      app.append(
        h('button', { class: 'ph-contact', onclick: tap(() => startCall('phone')) }, h('b', {}, 'Central Command'), h('small', {}, COMMAND_NUMBER)),
        ...['Mama', 'Bima', 'Rizky', 'Sari', 'Dimas'].map((n) => h('button', { class: 'ph-contact', onclick: tap(() => { g.audio.play('busy', { bus: 'ui' }); g.toast(`${n}: the number cannot be reached.`, 'warn'); }) }, h('b', {}, n), h('small', {}, 'mobile'))),
      );
    };

    const renderSide = () => {
      clear(side);
      const ctx = g.commsContext();
      side.append(h('h3', {}, 'Repair bench'), h('p', { class: 'muted' }, 'Several ways to get through. Combine what you find.'));
      const comp = h('div', { class: 'comps' }, ...components(p).map((c) => h('div', { class: `diag ${c.ok ? 'ok' : 'bad'}` }, h('b', {}, c.label), h('span', {}, c.status))));
      side.append(comp);
      const opts = repairOptions(p, ctx);
      if (opts.length) side.append(h('h4', {}, 'Repairs & power'));
      for (const o of opts) {
        side.append(h('div', { class: `repair ${o.possible ? '' : 'locked'}` },
          h('div', {}, h('b', {}, o.label), h('div', { class: 'needs' }, ...o.needs.map((n) => h('span', { class: n.ok ? 'ok' : 'no' }, `${n.ok ? '✔' : '✖'} ${n.label}`)))),
          h('button', { disabled: !o.possible || !!state.busy, onclick: () => doRepair(o) }, state.busy === o.id ? 'Working…' : 'Do it')));
      }
      // Satellite phone charging.
      const sat = g.inv.stackOf('sat_phone');
      if (sat) {
        const pb = g.inv.stackOf('power_bank');
        const charge = sat.data?.charge ?? 4;
        side.append(h('div', { class: 'repair' }, h('div', {}, h('b', {}, `Satellite phone battery: ${Math.round(charge)}%`)),
          h('button', { disabled: !(pb && (pb.data?.charge ?? 0) > 0) && !ctx.atChargeSpot && !g.inv.has('crank_charger'), onclick: () => {
            if (pb && (pb.data?.charge ?? 0) > 0) { const give = Math.min(pb.data.charge, 40); pb.data.charge -= give; sat.data = { charge: Math.min(100, charge + give) }; } else if (ctx.atChargeSpot) sat.data = { charge: 100 }; else { sat.data = { charge: Math.min(100, charge + 10) }; g.noise(g.player.pos.x, g.player.pos.z, 14, 0.3, 'crank'); }
            g.audio.play('beep', { bus: 'ui', freq: 900 });
            render();
          } }, 'Charge it')));
      }
      side.append(h('h4', {}, 'Reach Central Command'));
      for (const d of devices(p, ctx)) {
        side.append(h('div', { class: `device ${d.usable ? 'ok' : ''}` }, h('b', {}, d.label), ...(d.issues.length ? d.issues.map((i) => h('div', { class: 'no' }, `✖ ${i}`)) : [h('div', { class: 'ok' }, '✔ Ready')]),
          h('button', { disabled: !d.usable || !!state.call, onclick: () => startCall(d.id) }, d.id === 'phone' ? 'Call' : 'Transmit')));
      }
      if (g.campaign.rescue.confirmed) side.append(h('p', { class: 'good' }, `Rescue confirmed for Day ${g.campaign.rescue.day}.`));
    };

    const doRepair = (o) => {
      const time = (o.time / g.stats.repairSpeed) * 0.5;
      state.busy = o.id;
      renderSide();
      if (o.noise) g.noise(g.player.pos.x, g.player.pos.z, o.noise, 0.4, 'crank');
      g.audio.play('rustle', { bus: 'ui' });
      setTimeout(() => {
        state.busy = null;
        const msg = applyRepair(p, o.id, g.commsContext());
        if (msg) { g.toast(msg, 'good'); logEntry(g.campaign, `Phone: ${msg}`, 'note'); g.combat.rebuild(); }
        if (ui.isOpen('phone')) render();
      }, time * 1000);
    };

    // --- Calling ----------------------------------------------------------------------
    const startCall = (deviceId) => {
      const ctx = g.commsContext();
      const d = devices(p, ctx).find((k) => k.id === deviceId);
      if (!d?.usable) { g.toast(d ? d.issues[0] : 'Not possible.', 'warn'); return; }
      p.callAttempts += 1;
      state.call = { device: deviceId, step: -1, transcript: [], status: 'connecting' };
      g.playerSay('call');
      render();
      const isPhone = deviceId === 'phone';
      if (isPhone) { g.audio.play('ringback', { bus: 'ui' }); g.audio.play('ringback', { bus: 'ui', delay: 3 }); } else g.audio.play('radio_static', { bus: 'ui' });
      if (isPhone && p.speaker !== 'ok') g.audio.play('phone_buzz', { bus: 'ui' });
      setTimeout(() => {
        if (!state.call) return;
        const bars = g.signalHere();
        const chance = deviceId === 'sat' ? 0.92 : deviceId === 'phone' ? connectChance(bars) : 0.85;
        if (Math.random() > chance) return failCall(isPhone ? (bars < 3 ? 'The call could not connect - the network is overloaded. A stronger signal (higher ground) would help.' : 'Network busy. Try again.') : 'No answer on the command net. Try again from higher ground.');
        state.call.status = 'live';
        state.call.step = 0;
        hqSays(CALL_SCRIPT[0].hq);
        render();
      }, isPhone ? 5200 : 2500);
    };

    const failCall = (why) => {
      g.audio.play('busy', { bus: 'ui' });
      state.call = { ...state.call, status: 'failed', why };
      logEntry(g.campaign, `Call attempt failed: ${why}`, 'warn');
      render();
    };

    const hqSays = (text) => {
      state.call.transcript.push({ who: 'Command', text });
      if (state.call.device !== 'phone' || audioOk(p, g.inv)) g.audio.say('Central Command', text, null, HQ_VOICE, { radio: state.call.device !== 'phone' });
    };

    const choose = (opt, extra) => {
      const call = state.call;
      const deviceId = call.device;
      // Battery and signal can fail at every step.
      if (deviceId === 'phone') {
        p.battery = Math.max(0, p.battery - callStepCost(p, 'phone'));
        if (p.battery <= 0) return failCall('The phone died mid-call. Find more power.');
        if (Math.random() < dropChance(g.signalHere()) * 0.6) return failCall('Call dropped - the signal faded. Find higher ground.');
      } else if (deviceId === 'sat') {
        const s = g.inv.stackOf('sat_phone');
        s.data = { charge: Math.max(0, (s.data?.charge ?? 4) - callStepCost(p, 'sat')) };
        if (s.data.charge <= 0) return failCall('The satellite phone battery died.');
      }
      call.transcript.push({ who: 'You', text: extra || opt.text });
      const step = call.step;
      if (step === 0) { call.step = 1; hqSays(CALL_SCRIPT[1].hq); } else if (step === 1) { call.step = 2; hqSays(CALL_SCRIPT[2].hq); } else if (step === 2) {
        call.step = 3;
        hqSays(opt.id === 'gps' ? 'Coordinates received. You are three hundred metres from the Stadtpark - that will be our landing zone.' : `Copy, ${extra.replace(/^.*: /, '')}. We know it. The Stadtpark north of you will be our landing zone.`);
        setTimeout(() => {
          if (!state.call) return;
          const day = confirmRescue(g.campaign);
          hqSays(rescueMessage().replace('DAY 12', `DAY ${day}`));
          g.phone.messages.unshift({ from: 'Central Command', text: `Rescue confirmed: Day ${day}, 06:00-18:00, Stadtpark LZ. Mark it with a flare or smoke.`, day: g.campaign.day, time: formatClock(g.campaign.minutes) });
          g.mapState.addMarker({ id: 'lz', x: g.L.lz.x, z: g.L.lz.z, kind: 'lz', label: 'Stadtpark LZ' });
          g.toast(`RESCUE CONFIRMED: Day ${day}, Stadtpark landing zone.`, 'objective');
          render();
        }, 2500);
      } else if (step === 3) {
        state.call = null;
        state.app = 'home';
        g.audio.play('beep', { bus: 'ui', freq: 520, len: 0.3 });
      }
      render();
    };

    const renderCall = (app) => {
      const call = state.call;
      app.append(h('h4', {}, call.device === 'phone' ? 'Central Command' : call.device === 'sat' ? 'Satellite link' : 'Command net'));
      if (call.status === 'connecting') { app.append(h('p', { class: 'calling' }, 'Calling…')); return; }
      if (call.status === 'failed') {
        app.append(h('p', { class: 'warn' }, call.why), h('button', { class: 'ph-wide', onclick: () => { state.call = null; render(); } }, 'End'));
        return;
      }
      const t = h('div', { class: 'transcript' }, ...call.transcript.map((l) => h('p', { class: l.who === 'You' ? 'you' : 'hq' }, h('b', {}, `${l.who}: `), l.text)));
      app.append(t);
      if (call.device === 'phone' && !audioOk(p, g.inv)) app.append(h('p', { class: 'warn' }, '(You can barely hear them.)'));
      const step = CALL_SCRIPT[call.step];
      if (call.step === 1) {
        const sq = g.squad.members;
        const resc = sq.filter((m) => m.status === 'rescued').length;
        const dead = sq.filter((m) => m.status === 'dead').length;
        const missing = sq.length - resc - dead;
        const report = `Five of us came to Kreuzhafen. With me: ${resc}. Missing: ${missing}. Killed: ${dead}. We have wounded and limited supplies.`;
        app.append(h('button', { class: 'ph-wide', onclick: () => choose(step.options[0], report) }, 'Report the squad\'s status'));
      } else if (call.step === 2) {
        const gpsOk = call.device === 'sat' || (call.device === 'phone' && g.signalHere() >= 1);
        if (gpsOk) app.append(h('button', { class: 'ph-wide', onclick: () => choose(step.options[0]) }, 'Send GPS coordinates'));
        const seen = g.L.poi.filter((k) => k.landmark && g.mapState.isSeen(k.x, k.z));
        app.append(h('p', { class: 'muted' }, 'Or describe a landmark you have seen:'), ...seen.slice(0, 6).map((l) => h('button', { class: 'ph-wide', onclick: () => choose(step.options[1], `We are near a landmark: ${l.name}`) }, l.name)));
      } else if (step) {
        app.append(...step.options.map((o) => h('button', { class: 'ph-wide', onclick: () => choose(o) }, o.text)));
      }
      app.scrollTop = app.scrollHeight;
    };

    render();
    // Refresh only when signal or battery visibly change, so clicks aren't lost.
    let shown = '';
    entry.update = (dt) => {
      entry.t = (entry.t || 0) + dt;
      if (entry.t < 0.5) return;
      entry.t = 0;
      const now = `${g.signalHere()}:${Math.round(p.battery)}:${g.inv.stacks.length}`;
      if (now !== shown && !state.busy && !state.call) { shown = now; render(); }
    };
  };
}

export { ITEMS };
