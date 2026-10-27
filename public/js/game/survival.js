// Vital signs, needs and injuries. Pure data + functions so the same model
// drives the player and the teammates, and can be unit tested.
//
// Needs grow from 0 (fine) to 100 (critical). Time is in in-game minutes.

import { clamp } from '../core/util.js';

export const INJURY_TYPES = {
  bleeding_minor: { label: 'Bleeding', severity: 'minor', hpPerMin: -0.1, treatedBy: ['bandage', 'first_aid_kit'] },
  bleeding_severe: { label: 'Severe bleeding', severity: 'severe', hpPerMin: -0.75, treatedBy: ['tourniquet'] },
  laceration: { label: 'Deep cut', severity: 'minor', hpPerMin: 0, treatedBy: ['bandage', 'antiseptic', 'first_aid_kit'], infects: 720 },
  fracture: { label: 'Broken bone', severity: 'severe', hpPerMin: 0, treatedBy: ['splint', 'improvised_splint'], impairs: true },
  concussion: { label: 'Concussion', severity: 'moderate', hpPerMin: 0, treatedBy: ['first_aid_kit', 'painkillers'], heals: 240, disorients: true },
  burn: { label: 'Burn', severity: 'moderate', hpPerMin: -0.03, treatedBy: ['burn_gel'] },
  infection: { label: 'Infection', severity: 'moderate', hpPerMin: -0.04, treatedBy: ['antibiotics'], disorients: true },
  sickness: { label: 'Water sickness', severity: 'moderate', hpPerMin: -0.02, treatedBy: ['antibiotics'], heals: 600, thirstMult: 2 },
  unconscious: { label: 'Unconscious', severity: 'severe', hpPerMin: 0, treatedBy: ['first_aid_kit'] },
};

export const SEVERITY_ORDER = { minor: 1, moderate: 2, severe: 3 };

export function createVitals(over = {}) {
  return {
    health: 100, stamina: 100, hunger: 12, thirst: 15, fatigue: 10,
    injuries: [], painkiller: 0, disorient: 0, ...over,
  };
}

export function addInjury(v, type, part = 'torso') {
  if (!INJURY_TYPES[type]) throw new Error(`Unknown injury ${type}`);
  // Don't stack identical untreated injuries on the same body part.
  const same = v.injuries.find((i) => i.type === type && i.part === part && !i.treated);
  if (same) return same;
  const inj = { type, part, age: 0, treated: false, splinted: false };
  v.injuries.push(inj);
  return inj;
}

export function activeInjuries(v) {
  return v.injuries.filter((i) => !i.treated);
}

export function hasInjury(v, type) {
  return v.injuries.some((i) => i.type === type && !i.treated);
}

// Worst untreated condition, used for the HUD and teammate roster.
export function condition(v) {
  if (v.health <= 0) return { label: 'Dead', level: 4 };
  if (hasInjury(v, 'unconscious')) return { label: 'Unconscious', level: 4 };
  const act = activeInjuries(v);
  const worst = act.reduce((m, i) => Math.max(m, SEVERITY_ORDER[INJURY_TYPES[i.type].severity]), 0);
  if (worst === 3 || v.health < 30) return { label: 'Severe', level: 3 };
  if (worst === 2 || v.health < 60) return { label: 'Moderate', level: 2 };
  if (worst === 1 || v.health < 85) return { label: 'Minor injuries', level: 1 };
  return { label: 'Healthy', level: 0 };
}

// Movement multiplier from injuries and needs.
export function movementFactor(v) {
  let f = 1;
  for (const i of activeInjuries(v)) {
    if (i.type === 'fracture' && i.part === 'leg') f *= 0.5;
  }
  if (v.injuries.some((i) => i.type === 'fracture' && i.treated && i.part === 'leg' && i.age < 4320)) f *= 0.82;
  if (v.fatigue > 85) f *= 0.85;
  if (v.hunger > 90) f *= 0.9;
  return f;
}

export function canSprint(v) {
  return !activeInjuries(v).some((i) => i.type === 'fracture' && i.part === 'leg') && !hasInjury(v, 'unconscious');
}

export function maxStamina(v) {
  let m = 100;
  if (v.hunger > 70) m -= (v.hunger - 70) * 1.2;
  if (v.thirst > 70) m -= (v.thirst - 70) * 1.2;
  if (v.fatigue > 70) m -= (v.fatigue - 70);
  return clamp(m, 25, 100);
}

// How disoriented (0..1): wobble, blur and aim sway.
export function disorientation(v) {
  let d = v.disorient;
  for (const i of activeInjuries(v)) if (INJURY_TYPES[i.type].disorients) d = Math.max(d, 0.55);
  if (v.thirst > 85) d = Math.max(d, (v.thirst - 85) / 30);
  if (v.health < 25) d = Math.max(d, (25 - v.health) / 40);
  if (v.painkiller > 0) d *= 0.4;
  return clamp(d, 0, 1);
}

// Pain (0..1) shakes the aim.
export function pain(v) {
  let p = 0;
  for (const i of activeInjuries(v)) p += SEVERITY_ORDER[INJURY_TYPES[i.type].severity] * 0.15;
  if (v.painkiller > 0) p *= 0.3;
  return clamp(p, 0, 1);
}

// Advances needs and injuries by `minutes` of game time.
// ctx: { activity: 'idle'|'walk'|'sprint'|'sleep', sheltered, rng }
// Returns a list of event strings.
export function tickVitals(v, minutes, ctx = {}) {
  const events = [];
  if (v.health <= 0) return events;
  const act = ctx.activity || 'idle';
  const sleeping = act === 'sleep';
  const exertion = act === 'sprint' ? 2.2 : act === 'walk' ? 1.2 : 1;
  const sick = hasInjury(v, 'sickness');
  const prevH = v.hunger;
  const prevT = v.thirst;
  v.hunger = clamp(v.hunger + minutes * (sleeping ? 0.035 : 0.075) * exertion, 0, 100);
  v.thirst = clamp(v.thirst + minutes * (sleeping ? 0.04 : 0.1) * exertion * (sick ? 2 : 1), 0, 100);
  v.fatigue = clamp(v.fatigue + minutes * (sleeping ? -(ctx.sheltered ? 0.2 : 0.13) : 0.07 * (act === 'sprint' ? 1.5 : 1)), 0, 100);
  if (prevH < 70 && v.hunger >= 70) events.push('hungry');
  if (prevT < 70 && v.thirst >= 70) events.push('thirsty');

  let hp = 0;
  for (const inj of v.injuries) {
    inj.age += minutes;
    if (inj.treated) continue;
    const def = INJURY_TYPES[inj.type];
    hp += def.hpPerMin * minutes;
    if (def.heals && inj.age >= def.heals) {
      inj.treated = true;
      events.push(`healed:${inj.type}`);
    }
    if (def.infects && inj.age >= def.infects && !inj.cleaned) {
      inj.treated = true;
      if (!hasInjury(v, 'infection')) { addInjury(v, 'infection', inj.part); events.push('infection'); }
    }
  }
  if (v.hunger >= 100) hp -= 0.1 * minutes;
  if (v.thirst >= 100) hp -= 0.17 * minutes;
  // Natural recovery when needs are met and nothing is bleeding.
  const bleeding = hasInjury(v, 'bleeding_minor') || hasInjury(v, 'bleeding_severe');
  if (!bleeding && v.hunger < 60 && v.thirst < 60) hp += minutes * (sleeping ? (ctx.sheltered ? 0.12 : 0.07) : 0.015) * (ctx.healMult || 1);
  v.health = clamp(v.health + hp, 0, 100);
  v.painkiller = Math.max(0, v.painkiller - minutes);
  v.disorient = Math.max(0, v.disorient - minutes / 60);
  if (v.health <= 0) events.push('death');
  return events;
}

// Real-time stamina update (seconds).
export function tickStamina(v, dt, { sprinting, jumping, load = 0, drainMult = 1 }) {
  const max = maxStamina(v);
  if (sprinting) v.stamina -= dt * 13 * drainMult * (1 + Math.max(0, load - 0.6));
  else {
    let regen = 16 * (v.thirst > 70 ? 0.5 : 1) * (v.fatigue > 80 ? 0.6 : 1);
    regen *= 1 - Math.max(0, load - 0.8);
    v.stamina += dt * regen;
  }
  if (jumping) v.stamina -= 9;
  v.stamina = clamp(v.stamina, 0, max);
}

// Applies an item's `use` block. Returns a short description of what
// happened, or null if the item had no effect.
export function consume(v, itemDef, rng = Math.random) {
  const u = itemDef.use;
  if (!u) return null;
  const notes = [];
  if (u.hunger) { v.hunger = clamp(v.hunger + u.hunger, 0, 100); notes.push('less hungry'); }
  if (u.thirst) { v.thirst = clamp(v.thirst + u.thirst, 0, 100); notes.push('less thirsty'); }
  if (u.stamina) v.stamina = clamp(v.stamina + u.stamina, 0, maxStamina(v));
  if (u.painkiller) { v.painkiller = Math.max(v.painkiller, u.painkiller); notes.push('pain dulled'); }
  if (u.sickChance && rng() < u.sickChance) { addInjury(v, 'sickness', 'torso'); notes.push('feeling sick'); }
  return notes.join(', ') || 'used';
}

// Treats the most serious injury the item can treat. `healMult` comes from
// the medic role. Returns the treated injury type or null.
export function treat(v, itemId, healMult = 1) {
  // Most severe first; among equals, whatever drains health fastest (bleeding before a cut).
  const candidates = activeInjuries(v)
    .filter((i) => INJURY_TYPES[i.type].treatedBy.includes(itemId))
    .sort((a, b) => (SEVERITY_ORDER[INJURY_TYPES[b.type].severity] - SEVERITY_ORDER[INJURY_TYPES[a.type].severity])
      || (INJURY_TYPES[a.type].hpPerMin - INJURY_TYPES[b.type].hpPerMin));
  let treated = null;
  if (candidates.length) {
    const inj = candidates[0];
    inj.treated = true;
    if (itemId === 'splint' || itemId === 'improvised_splint') inj.splinted = true;
    inj.age = 0;
    treated = inj.type;
  }
  // Antiseptic also cleans every cut so it can't get infected.
  if (itemId === 'antiseptic') for (const i of v.injuries) if (i.type === 'laceration') i.cleaned = true;
  if (itemId === 'first_aid_kit') v.health = clamp(v.health + 35 * healMult, 0, 100);
  if (itemId === 'bandage' && treated) v.health = clamp(v.health + 4 * healMult, 0, 100);
  if (itemId === 'painkillers') v.painkiller = Math.max(v.painkiller, 120);
  return treated;
}

// Which of these items would help right now (for the "treat" menus).
export function usefulTreatments(v, available) {
  const useful = new Set();
  for (const i of activeInjuries(v)) for (const t of INJURY_TYPES[i.type].treatedBy) if (available.includes(t)) useful.add(t);
  if (v.health < 70 && available.includes('first_aid_kit')) useful.add('first_aid_kit');
  return [...useful];
}

// Damage from a hit. opts: { kind: 'bullet'|'blast'|'fall'|'fire', part, armor, headArmor, concussionResist, rng }
export function applyDamage(v, amount, opts = {}) {
  const rng = opts.rng || Math.random;
  const part = opts.part || 'torso';
  let dmg = amount;
  if (part === 'torso') dmg *= 1 - (opts.armor || 0);
  if (part === 'head') dmg *= 1 - (opts.headArmor || 0);
  v.health = clamp(v.health - dmg, 0, 100);
  const added = [];
  const kind = opts.kind || 'bullet';
  if (kind === 'bullet') {
    if (dmg > 8) added.push(addInjury(v, rng() < (part === 'torso' ? 0.25 : 0.35) ? 'bleeding_severe' : 'bleeding_minor', part));
    if (part === 'leg' && rng() < 0.2) added.push(addInjury(v, 'fracture', 'leg'));
  } else if (kind === 'blast') {
    if (rng() > (opts.concussionResist || 0)) added.push(addInjury(v, 'concussion', 'head'));
    if (rng() < 0.6) added.push(addInjury(v, 'laceration', rng() < 0.5 ? 'arm' : 'leg'));
    if (dmg > 25) added.push(addInjury(v, 'bleeding_minor', 'arm'));
  } else if (kind === 'fall') {
    if (dmg > 18) added.push(addInjury(v, 'fracture', 'leg'));
  } else if (kind === 'fire') {
    if (dmg > 3) added.push(addInjury(v, 'burn', part));
  } else if (kind === 'cut') {
    added.push(addInjury(v, 'laceration', part));
  }
  return { dealt: dmg, injuries: added };
}
