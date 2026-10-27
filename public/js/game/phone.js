// The damaged phone and every other way to reach Central Command.
// Pure logic: the UI shows it, the game feeds in position and inventory.

import { clamp } from '../core/util.js';

export const COMMAND_NUMBER = '+62 21 555 0173';
const TOWER = { x: 260, z: -260 };

export function createPhone() {
  return {
    device: 'own',
    battery: 3,
    batteryMax: 45,
    batteryOk: false,
    screen: 'cracked',
    touch: 'damaged',
    speaker: 'broken',
    camera: 'broken',
    antenna: 'intermittent',
    contactKnown: false,
    inspected: false,
    manpackFixed: false,
    callAttempts: 0,
    messages: [
      { from: 'Rizky', text: 'BAKERY HAS PRETZELS. repeat. PRETZELS', day: 0, time: '09:12' },
      { from: 'Mama', text: 'Jaga diri baik-baik ya nak. Take care of yourself. Call when you can.', day: 0, time: '07:40' },
      { from: 'Bima', text: 'Bus 10:00 Bahnhofstraße. Do not be late.', day: 0, time: '08:55' },
    ],
    log: [],
  };
}

// --- Signal ----------------------------------------------------------------

// Cell signal in bars (0-4) at a position. Height matters most: the only
// tower still standing is north-east of the district.
export function signalBars(pos, { indoors = false, open = false, antenna = false, bonus = 0, t = 0 } = {}) {
  const d = Math.hypot(pos.x - TOWER.x, pos.z - TOWER.z);
  let s = 4 - d / 120;
  s += Math.max(0, pos.y || 0) / 6;
  if (open) s += 0.6;
  if (indoors) s -= 1.5;
  if (antenna) s += 1;
  s += bonus;
  // The network is overloaded and damaged: the signal comes and goes.
  s += Math.sin(t * 0.37 + pos.x * 0.05) * 0.45 + Math.sin(t * 1.3 + pos.z * 0.08) * 0.25;
  return clamp(Math.floor(s), 0, 4);
}

export function connectChance(bars) {
  return [0, 0, 0.55, 0.9, 1][bars] || 0;
}

export function dropChance(bars) {
  return [1, 1, 0.3, 0.06, 0][bars] ?? 1;
}

// --- Components ----------------------------------------------------------------

export function components(p) {
  return [
    { key: 'battery', label: 'Battery', ok: p.batteryOk, status: p.batteryOk ? `OK (${Math.round(p.battery)}%)` : `Damaged - holds ${p.batteryMax}% max, drains fast` },
    { key: 'screen', label: 'Display', ok: p.screen === 'ok', status: p.screen === 'ok' ? 'OK' : 'Cracked, partly dark' },
    { key: 'touch', label: 'Touch input', ok: p.touch === 'ok', status: p.touch === 'ok' ? 'OK' : 'Bottom-right area unresponsive' },
    { key: 'speaker', label: 'Earpiece speaker', ok: p.speaker === 'ok', status: p.speaker === 'ok' ? 'OK' : 'Broken - no call audio' },
    { key: 'camera', label: 'Camera', ok: p.camera === 'ok', status: p.camera === 'ok' ? 'OK' : 'Lens shattered' },
    { key: 'antenna', label: 'Antenna', ok: p.antenna !== 'intermittent', status: p.antenna === 'boosted' ? 'Boosted with copper wire' : 'Intermittent' },
    { key: 'contacts', label: 'Contacts', ok: p.contactKnown, status: p.contactKnown ? 'Central Command reachable' : 'Contact list corrupted' },
  ];
}

export function audioOk(p, inv) {
  return p.speaker === 'ok' || inv.has('earphones');
}

export function chargePhone(p, amount) {
  const before = p.battery;
  p.battery = clamp(p.battery + amount, 0, p.batteryMax);
  return p.battery - before;
}

// Battery drain per in-game minute while the phone is off / on screen.
export function drainPhone(p, minutes, screenOn = false) {
  const rate = (screenOn ? 0.12 : 0.006) * (p.batteryOk ? 1 : 2);
  p.battery = Math.max(0, p.battery - rate * minutes);
}

// --- Repairs -------------------------------------------------------------------
// ctx: { inv, atChargeSpot, outdoors, daylight, dimasKnowsNumber }
export const REPAIRS = [
  {
    id: 'powerbank', label: 'Charge from power bank', time: 4,
    needs: (p, c) => [['power_bank', c.inv.has('power_bank') && (c.inv.stackOf('power_bank').data?.charge ?? 0) > 0], ['usb_cable', c.inv.has('usb_cable')]],
    visible: (p) => p.battery < p.batteryMax,
    apply(p, c) {
      const s = c.inv.stackOf('power_bank');
      const give = Math.min(s.data.charge, 40, p.batteryMax - p.battery);
      chargePhone(p, give);
      s.data.charge -= give;
      return `Charged to ${Math.round(p.battery)}%. Power bank at ${Math.round(s.data.charge)}%.`;
    },
  },
  {
    id: 'car', label: 'Charge from a car battery', time: 10,
    needs: (p, c) => [['car_charger', c.inv.has('car_charger')], ['usb_cable', c.inv.has('usb_cable')], ['at a car with a working battery', !!c.atChargeSpot]],
    visible: (p) => p.battery < p.batteryMax,
    apply(p) { chargePhone(p, 100); return `Fully charged (${Math.round(p.battery)}%).`; },
  },
  {
    id: 'crank', label: 'Hand-crank charge (noisy)', time: 8, noise: 14,
    needs: (p, c) => [['crank_charger', c.inv.has('crank_charger')]],
    visible: (p) => p.battery < p.batteryMax,
    apply(p) { chargePhone(p, 12); return `Cranked to ${Math.round(p.battery)}%.`; },
  },
  {
    id: 'solar', label: 'Solar charge (outdoors, daylight)', time: 12,
    needs: (p, c) => [['solar_charger', c.inv.has('solar_charger')], ['usb_cable', c.inv.has('usb_cable')], ['outdoors in daylight', c.outdoors && c.daylight]],
    visible: (p) => p.battery < p.batteryMax,
    apply(p) { chargePhone(p, 25); return `Charged to ${Math.round(p.battery)}%.`; },
  },
  {
    id: 'battery', label: 'Replace the battery', time: 10,
    needs: (p, c) => [['phone_battery', c.inv.has('phone_battery')], ['screwdriver or multitool', c.inv.has('screwdriver') || c.inv.has('multitool')]],
    visible: (p) => !p.batteryOk,
    apply(p, c) { c.inv.remove('phone_battery'); p.batteryOk = true; p.batteryMax = 100; p.battery = Math.max(p.battery, 35); return 'New battery fitted. 35% charge, full capacity.'; },
  },
  {
    id: 'speaker', label: 'Replace the earpiece speaker', time: 12,
    needs: (p, c) => [['speaker_module', c.inv.has('speaker_module')], ['screwdriver or multitool', c.inv.has('screwdriver') || c.inv.has('multitool')]],
    visible: (p) => p.speaker !== 'ok',
    apply(p, c) { c.inv.remove('speaker_module'); p.speaker = 'ok'; return 'Speaker replaced. You can hear calls again.'; },
  },
  {
    id: 'screen', label: 'Replace the display', time: 15,
    needs: (p, c) => [['screen_kit', c.inv.has('screen_kit')], ['screwdriver or multitool', c.inv.has('screwdriver') || c.inv.has('multitool')]],
    visible: (p) => p.screen !== 'ok' || p.touch !== 'ok',
    apply(p, c) { c.inv.remove('screen_kit'); p.screen = 'ok'; p.touch = 'ok'; return 'New display fitted. Touch works everywhere.'; },
  },
  {
    id: 'antenna', label: 'Boost the antenna with copper wire', time: 6,
    needs: (p, c) => [['antenna_wire', c.inv.has('antenna_wire')]],
    visible: (p) => p.antenna !== 'boosted',
    apply(p, c) { c.inv.remove('antenna_wire'); p.antenna = 'boosted'; return 'Improvised antenna attached: +1 signal bar.'; },
  },
  {
    id: 'sim', label: 'Move the SIM card into the abandoned phone', time: 6,
    needs: (p, c) => [['spare_phone', c.inv.has('spare_phone')], ['paperclip', c.inv.has('sim_tool')]],
    visible: (p) => p.device === 'own',
    apply(p, c) {
      c.inv.remove('spare_phone');
      Object.assign(p, {
        device: 'spare', screen: 'ok', touch: 'ok', speaker: 'ok', camera: 'ok', batteryOk: true, batteryMax: 100, battery: Math.max(12, p.battery), contactKnown: true,
      });
      return 'SIM moved into the intact phone. Its contacts on the SIM include Central Command.';
    },
  },
  {
    id: 'card', label: 'Dial the number from the emergency card', time: 1,
    needs: (p, c) => [['emergency_card', c.inv.has('emergency_card')]],
    visible: (p) => !p.contactKnown,
    apply(p) { p.contactKnown = true; return `Central Command saved: ${COMMAND_NUMBER}.`; },
  },
  {
    id: 'dimas', label: 'Ask Dimas for the command number', time: 1,
    needs: (p, c) => [['Dimas rescued', !!c.dimasKnowsNumber]],
    visible: (p) => !p.contactKnown,
    apply(p) { p.contactKnown = true; return `Dimas recites it from memory: ${COMMAND_NUMBER}.`; },
  },
  {
    id: 'manpack', label: 'Splice a new antenna onto your manpack radio', time: 10,
    needs: (p, c) => [['manpack radio', !!c.hasManpack], ['antenna_wire', c.inv.has('antenna_wire')]],
    visible: (p, c) => !!c.hasManpack && !p.manpackFixed,
    apply(p, c) { c.inv.remove('antenna_wire'); p.manpackFixed = true; return 'Manpack radio antenna repaired. It is preset to the command net.'; },
  },
];

export function repairOptions(p, ctx) {
  return REPAIRS.filter((r) => r.visible(p, ctx)).map((r) => {
    const needs = r.needs(p, ctx).map(([label, ok]) => ({ label, ok }));
    return { id: r.id, label: r.label, time: r.time, noise: r.noise || 0, needs, possible: needs.every((n) => n.ok) };
  });
}

export function applyRepair(p, id, ctx) {
  const r = REPAIRS.find((k) => k.id === id);
  if (!r || !r.needs(p, ctx).every(([, ok]) => ok)) return null;
  return r.apply(p, ctx);
}

// --- Devices that can reach Central Command ---------------------------------------
// ctx: { inv, bars, outdoors, elevation, dimasRescued, hasManpack }
export function devices(p, ctx) {
  const out = [];
  const phoneIssues = [];
  if (p.battery < 8) phoneIssues.push(p.battery <= 0 ? 'Battery dead' : 'Battery too low for a call');
  if (!audioOk(p, ctx.inv)) phoneIssues.push('No audio: speaker broken (earphones would work)');
  if (!p.contactKnown) phoneIssues.push('Command number unknown');
  if (ctx.bars < 2) phoneIssues.push(`Signal too weak (${ctx.bars} bar${ctx.bars === 1 ? '' : 's'}) - find high ground`);
  out.push({ id: 'phone', label: p.device === 'own' ? 'Your phone' : 'Abandoned phone (your SIM)', issues: phoneIssues, usable: phoneIssues.length === 0 });

  if (ctx.inv.has('sat_phone')) {
    const charge = ctx.inv.stackOf('sat_phone').data?.charge ?? 4;
    const issues = [];
    if (charge < 10) issues.push(`Battery ${Math.round(charge)}% - charge it (power bank, car, crank)`);
    if (!ctx.outdoors) issues.push('Needs open sky');
    out.push({ id: 'sat', label: 'Satellite phone', issues, usable: issues.length === 0 });
  }
  const radioIssues = (needCard) => {
    const issues = [];
    if (ctx.inv.count('batteries') < 2) issues.push('Needs 2 packs of AA batteries');
    if (needCard && !ctx.inv.has('freq_card') && !ctx.dimasRescued) issues.push('Command net frequency unknown (frequency card or Dimas)');
    if ((ctx.elevation || 0) < 6 && ctx.bars < 2) issues.push('Too low - get above the rooftops');
    return issues;
  };
  if (ctx.inv.has('field_radio')) {
    const issues = radioIssues(true);
    out.push({ id: 'radio', label: 'Field radio', issues, usable: issues.length === 0 });
  }
  if (ctx.hasManpack) {
    const issues = radioIssues(false);
    if (!p.manpackFixed) issues.unshift('Antenna snapped in the blast - needs copper wire');
    out.push({ id: 'manpack', label: 'Your manpack radio', issues, usable: issues.length === 0 });
  }
  return out;
}

// --- The call ----------------------------------------------------------------------
// A short scripted conversation. The UI shows `hq` and the options; every
// step costs battery and may drop if the signal is weak.

export function createCall(device) {
  return { device, step: 0, done: false, failed: null, transcript: [], reported: {} };
}

export const CALL_SCRIPT = [
  {
    hq: 'Central Command, duty officer. Identify.',
    options: [{ id: 'identify', text: 'This is Elang-2, Satgas Elang-7. Kreuzhafen has been hit. Massive strike.' }],
  },
  {
    hq: 'Elang-2, we have been trying to reach you for hours. Status of your squad?',
    options: [{ id: 'status', text: '(Report the squad\'s condition truthfully)' }],
  },
  {
    hq: 'Understood. We need your position for extraction.',
    options: [{ id: 'gps', text: 'Sending GPS coordinates now.', needsGps: true }, { id: 'landmark', text: 'Describe a landmark...' }],
  },
  {
    hq: '',
    options: [{ id: 'confirm', text: 'Copy. Twelve days. We will be there.' }],
  },
];

export function rescueMessage() {
  return 'Elang-2, rescue is confirmed. A helicopter extraction team will reach the Stadtpark landing zone on DAY 12, between 06:00 and 18:00. That is twelve days from the strike. Mark the LZ with a flare or smoke. Keep your people alive. Command out.';
}

// Battery percent each step of the call costs.
export function callStepCost(p, device) {
  if (device === 'phone') return p.batteryOk ? 3 : 6;
  if (device === 'sat') return 4;
  return 0;
}
