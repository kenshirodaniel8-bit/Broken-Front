// The twelve-day campaign: time, objectives, scheduled events, rescue
// schedule and endings. Pure logic: the game passes in a `facts` snapshot
// and acts on the events this module returns.

import { formatClock } from '../core/util.js';

export const DISASTER_TIME = 11 * 60 + 47;
export const EXTRACTION_OPEN = 6 * 60;
export const EXTRACTION_CLOSE = 18 * 60;
export const FINAL_DAY = 12;

export const DAYS = {
  1: { title: 'The Disaster', brief: 'Kreuzhafen is in ruins. Survive, assess the situation and find the members of Elang-7 who are still alive.' },
  2: { title: 'Regrouping', brief: 'Find the rest of the squad and set up a temporary shelter where the wounded can rest.' },
  3: { title: 'Communication', brief: 'Nobody knows you are alive. Your phone is broken. Find parts, power and the command number.' },
  4: { title: 'Rescue Confirmation', brief: 'Find a usable signal, call Central Command and get the rescue confirmed.' },
  5: { title: 'Increasing Threats', brief: 'Enemy patrols are multiplying. Safe routes are getting harder to find.' },
  6: { title: 'Resource Crisis', brief: 'Others have stripped most shops. Food, water, medicine and batteries are running short.' },
  7: { title: 'The Midpoint', brief: 'Halfway. The truth about the attack is out there - and the city is still falling apart.' },
  8: { title: 'New Danger', brief: 'The enemy is searching buildings. Places that were safe are not safe any more.' },
  9: { title: 'Difficult Decisions', brief: 'Others need help too. Every rescue costs supplies, time and risk.' },
  10: { title: 'Preparation', brief: 'Two days left. Secure supplies, treat the wounded and prepare to mark the landing zone.' },
  11: { title: 'Critical Survival', brief: 'The enemy is closing in on the shelter and the route north is cut.' },
  12: { title: 'Extraction', brief: 'The rescue team is coming. Reach the Stadtpark landing zone and get everyone aboard.' },
};

const tmName = { bima: 'Bima', rizky: 'Rizky', sari: 'Sari', dimas: 'Dimas' };

// Objectives. `day` is when they appear; `show(f)` can hide them until a
// condition is met; `check(f)` completes them; `until` fails them after that day.
export const OBJECTIVES = [
  { id: 'd1_wake', day: 1, text: 'Get up. Find out who from Elang-7 is still alive.', check: (f) => f.located >= 1 },
  { id: 'd1_rizky', day: 1, show: (f) => f.tm.rizky.status !== 'missing', text: 'Free Rizky from the wreckage and stop his bleeding.', check: (f) => f.tm.rizky.status === 'rescued' || f.tm.rizky.status === 'dead' },
  { id: 'd1_wounds', day: 1, optional: true, show: (f) => f.playerBleeding, text: 'Stop your own bleeding (bandage: Tab or the pouch keys).', check: (f) => !f.playerBleeding },
  {
    id: 'd1_search', day: 1, text: (f) => `Find the rest of the squad (${f.located}/4 found). Follow shouts, radio calls and clues.`,
    check: (f) => Object.values(f.tm).every((t) => t.status !== 'missing'),
  },
  { id: 'd2_shelter', day: 2, text: 'Choose and set up a temporary shelter (Turnhalle or Parkhaus).', check: (f) => !!f.shelter },
  {
    id: 'd2_regroup', day: 2, show: (f) => !!f.shelter && f.rescued > 0, text: 'Bring rescued teammates to the shelter.',
    check: (f) => f.rescued > 0 && Object.values(f.tm).every((t) => t.status !== 'rescued' || t.sheltered || t.following),
  },
  { id: 'd2_stock', day: 2, optional: true, show: (f) => !!f.shelter, text: 'Stock the shelter stash: 4 food and 4 water.', check: (f) => f.stash.food >= 4 && f.stash.water >= 4 },
  { id: 'd3_inspect', day: 3, text: 'Inspect your damaged phone (P).', check: (f) => f.comms.inspected },
  { id: 'd3_power', day: 3, show: (f) => f.comms.inspected, text: 'Power a device: charge the phone or a satellite phone, or get radio batteries.', check: (f) => f.comms.powered },
  { id: 'd3_audio', day: 3, show: (f) => f.comms.inspected, text: 'Fix the call audio: replacement speaker or earphones - or use another device.', check: (f) => f.comms.audio },
  { id: 'd3_number', day: 3, show: (f) => f.comms.inspected, text: 'Recover the Central Command number (emergency card, Dimas, your SIM) or a radio frequency.', check: (f) => f.comms.contact },
  { id: 'd4_signal', day: 4, show: (f) => !f.rescueConfirmed, text: 'Find a usable signal. Go high: the church tower or the Parkhaus roof.', check: (f) => !!f.flags.signalFound || f.rescueConfirmed },
  { id: 'd4_call', day: 3, show: (f) => f.day >= 4 || f.comms.anyUsable, text: 'Contact Central Command and confirm the rescue.', check: (f) => f.rescueConfirmed },
  { id: 'd5_scout', day: 5, text: 'Scout the Stadtpark landing zone - walk there or fly the drone over it.', check: (f) => !!f.flags.lzScouted },
  { id: 'd5_patrols', day: 5, optional: true, text: 'Get through the day without being spotted by a patrol.', check: (f) => f.day > 5 && !f.flags.spottedDay5, until: 5 },
  { id: 'd6_supplies', day: 6, text: (f) => `Resource crisis: gather 6 food and 6 water (${f.supplies.food}/6, ${f.supplies.water}/6).`, check: (f) => f.supplies.food >= 6 && f.supplies.water >= 6 },
  { id: 'd7_intel', day: 7, optional: true, text: 'An enemy officer carries the ASHEN SKY operation orders. Recover them.', check: (f) => f.inv('intel_orders') > 0 || !!f.flags.intelDelivered },
  {
    id: 'd7_medicine', day: 7, show: (f) => !!f.flags.infected, text: (f) => `${tmName[f.flags.infected] || 'A teammate'} has a wound infection. Bring antibiotics.`,
    check: (f) => !!f.flags.infectionCured || f.tm[f.flags.infected]?.status === 'dead',
  },
  { id: 'd8_danger', day: 8, show: (f) => !!f.shelter, text: 'Patrols are searching buildings near the shelter. Fortify it (rope, planks or tape) or relocate.', check: (f) => !!f.flags.shelterSecured },
  { id: 'd9_civilians', day: 9, optional: true, text: 'Civilians are signalling from the Hotel Kreuzhof. Bring them 2 water and 1 medical item.', check: (f) => !!f.flags.civiliansHelped },
  { id: 'd9_depot', day: 9, optional: true, text: 'Raid the enemy supply depot at the Hauptbahnhof (heavily guarded).', check: (f) => !!f.flags.depotRaided },
  { id: 'd10_marker', day: 10, text: 'Get a flare or a smoke grenade to mark the landing zone.', check: (f) => f.inv('flare') + f.inv('smoke_grenade') > 0 || !!f.flags.lzMarked },
  { id: 'd10_ready', day: 10, text: 'Treat every rescued teammate: no bleeding, no untreated fractures.', check: (f) => Object.values(f.tm).every((t) => t.status !== 'rescued' || !t.seriouslyInjured) },
  { id: 'd11_route', day: 11, text: 'An enemy roadblock cuts Kirchstraße. Scout it and plan another route to the park.', check: (f) => !!f.flags.roadblockScouted },
  { id: 'd11_raid', day: 11, show: (f) => !!f.flags.raidStarted, text: 'Survive the raid on the shelter.', check: (f) => !!f.flags.raidOver },
  { id: 'd12_lz', day: 12, show: (f) => f.rescueConfirmed && f.day >= f.rescueDay, text: 'Reach the Stadtpark LZ between 06:00 and 18:00 with your squad.', check: (f) => !!f.flags.atLZ },
  { id: 'd12_mark', day: 12, show: (f) => f.rescueConfirmed && f.day >= f.rescueDay, text: 'Mark the landing zone with a flare or smoke (T).', check: (f) => !!f.flags.lzMarked },
  { id: 'd12_board', day: 12, show: (f) => f.rescueConfirmed && f.day >= f.rescueDay, text: 'Get everyone aboard the helicopter.', check: (f) => !!f.flags.extracted },
  { id: 'd12_nocall', day: 11, show: (f) => !f.rescueConfirmed, text: 'Nobody knows you are here. Call Central Command - it is not too late.', check: (f) => f.rescueConfirmed },
];

// Scheduled events. `when` adds a condition; the game implements the effect.
export const EVENTS = [
  { id: 'sari_radio', day: 1, at: 12 * 60 + 30, when: (f) => f.tm.sari.status === 'missing' },
  { id: 'enemy_arrival', day: 1, at: 15 * 60 },
  { id: 'dimas_ping', day: 1, at: 17 * 60, when: (f) => f.tm.dimas.status === 'missing' },
  { id: 'bima_radio', day: 2, at: 9 * 60, when: (f) => f.tm.bima.status === 'missing' },
  { id: 'bima_flare', day: 2, at: 21 * 60 + 30, when: (f) => f.tm.bima.status === 'missing' },
  { id: 'broadcast', day: 3, at: 8 * 60 },
  { id: 'threat2', day: 5, at: 6 * 60 },
  { id: 'heli_patrol', day: 5, at: 21 * 60 },
  { id: 'scarcity', day: 6, at: 6 * 60 },
  { id: 'midpoint', day: 7, at: 7 * 60 },
  { id: 'aftershock', day: 7, at: 14 * 60 },
  { id: 'threat3', day: 8, at: 6 * 60 },
  { id: 'civilians', day: 9, at: 8 * 60 },
  { id: 'depot', day: 9, at: 8 * 60 },
  { id: 'prep', day: 10, at: 6 * 60 },
  { id: 'roadblock', day: 11, at: 7 * 60 },
  { id: 'raid', day: 11, at: 22 * 60 },
  { id: 'extraction_window', day: 12, at: EXTRACTION_OPEN, when: (f) => f.rescueConfirmed && f.rescueDay === 12 },
];

export function createCampaign() {
  return {
    day: 1,
    minutes: DISASTER_TIME,
    flags: {},
    objectives: {},
    log: [],
    fired: {},
    rescue: { confirmed: false, day: null, callDay: null },
    shelter: null,
    threat: 0,
    decisions: {},
    ending: null,
    totalMinutes: 0,
  };
}

export function logEntry(c, text, kind = 'note') {
  c.log.push({ day: c.day, time: formatClock(c.minutes), text, kind });
  if (c.log.length > 400) c.log.splice(0, c.log.length - 400);
}

export function confirmRescue(c) {
  if (c.rescue.confirmed) return c.rescue.day;
  c.rescue.confirmed = true;
  c.rescue.callDay = c.day;
  // Twelve days from the strike - unless the call came too late to make it.
  c.rescue.day = c.day <= 10 ? FINAL_DAY : c.day + 2;
  logEntry(c, `Rescue confirmed for Day ${c.rescue.day}, 06:00-18:00, Stadtpark landing zone.`, 'milestone');
  return c.rescue.day;
}

export function extractionOpen(c) {
  return c.rescue.confirmed && c.day === c.rescue.day && c.minutes >= EXTRACTION_OPEN && c.minutes < EXTRACTION_CLOSE;
}

// Moves the clock forward. Returns events: { type: 'newDay', day } and
// { type: 'event', id } in order.
export function advanceTime(c, minutes, facts) {
  const out = [];
  c.minutes += minutes;
  c.totalMinutes += minutes;
  while (c.minutes >= 1440) {
    c.minutes -= 1440;
    c.day += 1;
    out.push({ type: 'newDay', day: c.day });
    logEntry(c, `Day ${c.day}: ${DAYS[Math.min(c.day, 12)]?.title || 'Overtime'}.`, 'day');
  }
  for (const e of EVENTS) {
    if (c.fired[e.id]) continue;
    if (c.day > e.day || (c.day === e.day && c.minutes >= e.at)) {
      c.fired[e.id] = true;
      // Events that are overdue by more than a day are dropped silently.
      if (c.day > e.day + 1) continue;
      if (e.when && facts && !e.when(facts)) continue;
      out.push({ type: 'event', id: e.id });
    }
  }
  if (!c.ending) {
    if (c.rescue.confirmed && (c.day > c.rescue.day || (c.day === c.rescue.day && c.minutes >= EXTRACTION_CLOSE))) {
      out.push({ type: 'missedExtraction' });
    } else if (!c.rescue.confirmed && c.day > FINAL_DAY) {
      out.push({ type: 'noRescue' });
    }
  }
  return out;
}

// Re-evaluates objectives. Returns { added: [...], completed: [...], failed: [...] }.
export function updateObjectives(c, facts) {
  const res = { added: [], completed: [], failed: [] };
  for (const o of OBJECTIVES) {
    const st = c.objectives[o.id];
    if (st && st.state !== 'active') continue;
    if (c.day < o.day) continue;
    if (!st) {
      if (o.show && !o.show(facts)) continue;
      c.objectives[o.id] = { state: 'active', day: c.day };
      res.added.push(o.id);
    }
    if (o.check(facts)) {
      c.objectives[o.id].state = 'done';
      res.completed.push(o.id);
    } else if (o.until != null && c.day > o.until) {
      c.objectives[o.id].state = 'failed';
      res.failed.push(o.id);
    }
  }
  return res;
}

export function objectiveText(id, facts) {
  const o = OBJECTIVES.find((k) => k.id === id);
  if (!o) return id;
  return typeof o.text === 'function' ? o.text(facts) : o.text;
}

export function activeObjectives(c) {
  return OBJECTIVES.filter((o) => c.objectives[o.id]?.state === 'active');
}

// --- Endings ------------------------------------------------------------------

export const ENDINGS = {
  all_home: { title: 'EVERYONE COMES HOME', tone: 'good', text: 'All five members of Satgas Elang-7 lifted off from the Stadtpark. Kreuzhafen burned below you, but nobody was left behind.' },
  broken: { title: 'BROKEN, NOT BEATEN', tone: 'mixed', text: 'The helicopter climbed out of the smoke with what was left of Elang-7. You brought home everyone you could.' },
  last_one: { title: 'THE LAST ONE OUT', tone: 'bad', text: 'You boarded the helicopter alone - or almost alone. Twelve days, and the city kept most of your squad.' },
  missed: { title: 'THE EMPTY SKY', tone: 'bad', text: 'The rescue team waited at the Stadtpark as long as they could. Then the rotors faded north, and Kreuzhafen was silent again.' },
  left_behind: { title: 'LEFT BEHIND', tone: 'bad', text: 'Nobody knew Elang-7 had survived. On the thirteenth morning, you started walking west, alone with whoever was still beside you.' },
  kia: { title: 'KILLED IN ACTION', tone: 'dead', text: 'Your story ends in the ruins of Kreuzhafen.' },
};

// summary: { playerAlive, extracted, aboard: [ids], dead: [ids], left: [ids], civiliansHelped, intel, depotRaided, rescueConfirmed, missed }
export function computeEnding(s) {
  let id;
  if (!s.playerAlive) id = 'kia';
  else if (!s.rescueConfirmed) id = 'left_behind';
  else if (!s.extracted) id = 'missed';
  else if (s.aboard.length >= 4) id = 'all_home';
  else if (s.aboard.length >= 2) id = 'broken';
  else id = 'last_one';
  const epilogue = [];
  for (const tid of ['bima', 'rizky', 'sari', 'dimas']) {
    const n = tmName[tid];
    if (s.aboard.includes(tid)) epilogue.push(`${n} made it home.`);
    else if (s.dead.includes(tid)) epilogue.push(`${n} died in Kreuzhafen.`);
    else epilogue.push(`${n} was left behind in the ruins. Their fate is unknown.`);
  }
  if (s.civiliansHelped) epilogue.push('The civilians you helped at the Hotel Kreuzhof were evacuated by the Red Cross two weeks later.');
  if (s.intel) epilogue.push('The ASHEN SKY orders you carried out proved the strike was planned weeks in advance.');
  if (s.depotRaided) epilogue.push('The raid on the depot kept the squad fed through the worst days.');
  return { id, ...ENDINGS[id], epilogue };
}
