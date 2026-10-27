// Character creation options and how each choice changes the soldier in play.
// `deriveStats` is the single place where appearance/gear selections turn
// into gameplay numbers (carry weight, armour, noise, kit slots, ...).

import { makeRng } from '../core/util.js';

export const SKIN_TONES = [
  '#f3d2bd', '#e8bc9b', '#dba782', '#c98e64', '#b67a52', '#a06640', '#8a5434', '#734328', '#5c341f', '#432617',
];
export const HAIR_COLORS = {
  black: '#121010', darkbrown: '#2c1d14', brown: '#4d3220', auburn: '#6e3018', blonde: '#b08a52', grey: '#8d8a86', white: '#d8d5cf',
};
export const EYE_COLORS = {
  darkbrown: '#2a170c', brown: '#4a2a14', hazel: '#6b5228', green: '#3f6b3a', blue: '#3c6a9a', grey: '#6d7780',
};
export const HAIR_STYLES = {
  buzz: 'Buzz cut', crew: 'Crew cut', short: 'Short side part', curly: 'Short curly', bald: 'Shaved',
  ponytail: 'Ponytail', bun: 'Low bun', braid: 'Braid', bob: 'Short bob',
};
export const FACIAL_HAIR = { none: 'Clean shaven', stubble: 'Stubble', mustache: 'Mustache', goatee: 'Goatee', beard: 'Short beard' };
export const FACE_SHAPES = { oval: 'Oval', round: 'Round', square: 'Square', long: 'Long' };

export const VOICE_PRESETS = {
  deep: { label: 'Deep', pitch: 0.75, rate: 0.95 },
  medium: { label: 'Medium', pitch: 1.0, rate: 1.0 },
  bright: { label: 'Bright', pitch: 1.25, rate: 1.05 },
};
export const VOICE_STYLES = {
  calm: { label: 'Calm', rate: 0.92 },
  firm: { label: 'Firm', rate: 1.0 },
  urgent: { label: 'Urgent', rate: 1.12 },
  laconic: { label: 'Laconic', rate: 0.97 },
};

// Lines the player character speaks (orders to teammates, calls). Each voice
// style has its own wording.
export const PLAYER_LINES = {
  follow: { calm: 'Stay with me. We go together.', firm: 'On me. Move.', urgent: 'Come on, follow me, now!', laconic: 'With me.' },
  wait: { calm: 'Wait here. I will come back for you.', firm: 'Hold this position.', urgent: 'Stay here, stay down!', laconic: 'Hold.' },
  shelter: { calm: 'Head to the shelter. Rest there.', firm: 'Fall back to the shelter.', urgent: 'Get to the shelter, go!', laconic: 'Shelter. Go.' },
  found: { calm: 'I am here. You are safe now.', firm: 'I have you. Stay still.', urgent: 'I got you, I got you!', laconic: 'Found you.' },
  treat: { calm: 'Easy... this will hurt a little.', firm: 'Hold still. Treating you.', urgent: 'Hang on, hang on!', laconic: 'Hold still.' },
  call: { calm: 'Command, this is Elang. Do you read?', firm: 'Command, Elang. Come in.', urgent: 'Command! Elang! Do you copy?!', laconic: 'Command. Elang.' },
};

export const ROLES = {
  rifleman: { label: 'Rifleman', desc: 'Steadier aim and more ammunition.', primary: 'ar', kit: ['bandage', 'tourniquet', 'energy_bar', 'water_small'] },
  medic: { label: 'Combat Medic', desc: 'Treats injuries 40% faster and heals more.', primary: 'carbine', kit: ['bandage', 'bandage', 'tourniquet', 'splint', 'painkillers'] },
  engineer: { label: 'Engineer', desc: 'Clears debris and repairs devices 40% faster.', primary: 'shotgun', kit: ['bandage', 'multitool', 'duct_tape', 'water_small'] },
  marksman: { label: 'Recon Marksman', desc: 'Quieter movement and 30% more drone range.', primary: 'dmr', kit: ['bandage', 'tourniquet', 'energy_bar', 'water_small'] },
  comms: { label: 'Signaller', desc: 'Hears radio traffic further away and gets +1 signal bar.', primary: 'carbine', kit: ['bandage', 'tourniquet', 'water_small', 'energy_bar'] },
};

export const PRIMARY_WEAPONS = {
  ar: 'AR-7 Assault Rifle', carbine: 'CK-4 Carbine', smg: 'SM-9 SMG', dmr: 'M-308 Marksman Rifle', shotgun: 'PS-12 Shotgun',
};

export const UNIFORM_TYPES = {
  field: 'Field combat uniform', combatshirt: 'Combat shirt (two-tone)', rolled: 'Field uniform, sleeves rolled', urban: 'Urban fatigues',
};
export const UNIFORM_COLORS = {
  olive: '#4f5838', khaki: '#8b7d5a', coyote: '#7d6a4c', ranger: '#3d4a37', grey: '#5d6166', black: '#24262a', navy: '#273246',
};
export const CAMO_PATTERNS = {
  loreng: 'Loreng (tiger stripe)', woodland: 'Woodland', multi: 'Multi-terrain', desert: 'Desert', urban: 'Urban grey', solid: 'Solid colour',
};

export const HELMETS = {
  none: { label: 'None', head: 0 },
  cap: { label: 'Patrol cap', head: 0 },
  boonie: { label: 'Boonie hat', head: 0 },
  combat: { label: 'Combat helmet', head: 0.35, concussion: 0.35 },
  highcut: { label: 'High-cut helmet', head: 0.3, concussion: 0.3 },
  fire: { label: 'Firefighter helmet', head: 0.25, concussion: 0.25, found: true },
};
export const HELMET_COVERS = { camo: 'Camo cover', plain: 'Plain' };

export const VESTS = {
  chestrig: { label: 'Chest rig', armor: 0.05, slots: 6, weight: 1.2, speed: 1.0 },
  platelight: { label: 'Light plate carrier', armor: 0.22, slots: 3, weight: 3.2, speed: 1.0 },
  plate: { label: 'Plate carrier', armor: 0.35, slots: 4, weight: 5.5, speed: 0.97 },
  heavy: { label: 'Heavy armour vest', armor: 0.5, slots: 5, weight: 9.0, speed: 0.9 },
  police: { label: 'Police body armour', armor: 0.3, slots: 2, weight: 4.0, speed: 0.98, found: true },
};
export const BACKPACKS = {
  none: { label: 'None', capacity: 0, weight: 0 },
  assault: { label: 'Assault pack (25 L)', capacity: 10, weight: 1.0 },
  patrol: { label: 'Patrol pack (45 L)', capacity: 18, weight: 1.6 },
  ruck: { label: 'Rucksack (65 L)', capacity: 26, weight: 2.4, speed: 0.96 },
};
export const GLOVES = { none: 'None', tactical: 'Tactical gloves', fingerless: 'Fingerless gloves' };
export const BOOTS = { black: 'Black combat boots', tan: 'Tan desert boots', green: 'Jungle boots' };
export const KNEEPADS = { none: 'None', standard: 'Knee pads' };
export const EYEWEAR = { none: 'None', glasses: 'Ballistic glasses', goggles: 'Dust goggles' };
export const RADIOS = {
  none: { label: 'None', range: 0 },
  handheld: { label: 'Handheld squad radio', range: 260 },
  manpack: { label: 'Manpack radio', range: 420 },
};
export const PATCH_COLORS = { olive: '#3c4430', tan: '#a08f6a', black: '#1b1c1e' };
export const INSIGNIA = { none: 'None', flag: 'Red-white flag', eagle: 'Elang unit eagle', medic: 'Medic cross' };

export const KIT_OPTIONS = {
  bandage: 'Bandage', tourniquet: 'Tourniquet', splint: 'Splint', painkillers: 'Painkillers (x4)',
  antiseptic: 'Antiseptic spray', first_aid_kit: 'First aid kit', purify_tabs: 'Purification tablets (x10)',
  energy_bar: 'Energy bars (x3)', water_small: 'Water 0.5 L (x2)', multitool: 'Multitool', duct_tape: 'Duct tape',
  blanket: 'Emergency blanket', lighter: 'Lighter', smoke_grenade: 'Smoke grenade',
};
// How many of the item one kit slot gives.
export const KIT_COUNTS = { painkillers: 4, purify_tabs: 10, energy_bar: 3, water_small: 2 };

export function defaultConfig() {
  return {
    name: 'Adi Saputra',
    gender: 'male',
    face: { shape: 'oval', jaw: 0.5, cheek: 0.5, nose: 0.5, brow: 0.5, age: 0.3 },
    skin: 4,
    hair: { style: 'crew', color: 'black' },
    eyes: 'darkbrown',
    facialHair: 'stubble',
    voice: { preset: 'medium', pitch: 1.0, style: 'firm', voiceURI: '' },
    role: 'rifleman',
    uniform: { type: 'field', color: 'olive', camo: 'loreng' },
    helmet: 'combat',
    helmetCover: 'camo',
    vest: 'plate',
    gloves: 'tactical',
    boots: 'black',
    backpack: 'assault',
    kneepads: 'standard',
    eyewear: 'glasses',
    radio: 'handheld',
    patch: { show: true, color: 'olive' },
    insignia: 'flag',
    loadout: { primary: 'ar', kit: [...ROLES.rifleman.kit] },
  };
}

const pickKey = (rng, obj) => rng.pick(Object.keys(obj).filter((k) => !obj[k].found));

export function randomConfig(seed = Date.now()) {
  const rng = makeRng(seed);
  const c = defaultConfig();
  c.gender = rng.chance(0.5) ? 'male' : 'female';
  const first = c.gender === 'male'
    ? ['Adi', 'Bayu', 'Galih', 'Hendra', 'Joko', 'Raka', 'Teguh', 'Wahyu', 'Yusuf', 'Fajar']
    : ['Ayu', 'Dewi', 'Fitri', 'Indah', 'Lestari', 'Maya', 'Nadia', 'Putri', 'Rina', 'Wulan'];
  const last = ['Saputra', 'Wijaya', 'Kusuma', 'Santoso', 'Siregar', 'Nainggolan', 'Hakim', 'Permana', 'Setiawan', 'Lubis'];
  c.name = `${rng.pick(first)} ${rng.pick(last)}`;
  c.face = { shape: pickKey(rng, FACE_SHAPES), jaw: rng(), cheek: rng(), nose: rng(), brow: rng(), age: rng() * 0.7 };
  c.skin = rng.int(1, SKIN_TONES.length - 1);
  const styles = c.gender === 'male' ? ['buzz', 'crew', 'short', 'curly', 'bald'] : ['ponytail', 'bun', 'braid', 'bob', 'short', 'crew'];
  c.hair = { style: rng.pick(styles), color: rng.pick(['black', 'black', 'darkbrown', 'brown', 'auburn', 'blonde']) };
  c.eyes = pickKey(rng, EYE_COLORS);
  c.facialHair = c.gender === 'male' ? pickKey(rng, FACIAL_HAIR) : 'none';
  c.voice = { preset: pickKey(rng, VOICE_PRESETS), pitch: 0.8 + rng() * 0.4, style: pickKey(rng, VOICE_STYLES), voiceURI: '' };
  c.role = pickKey(rng, ROLES);
  c.uniform = { type: pickKey(rng, UNIFORM_TYPES), color: pickKey(rng, UNIFORM_COLORS), camo: pickKey(rng, CAMO_PATTERNS) };
  c.helmet = pickKey(rng, HELMETS);
  c.helmetCover = pickKey(rng, HELMET_COVERS);
  c.vest = pickKey(rng, VESTS);
  c.gloves = pickKey(rng, GLOVES);
  c.boots = pickKey(rng, BOOTS);
  c.backpack = rng.pick(['assault', 'patrol', 'ruck']);
  c.kneepads = pickKey(rng, KNEEPADS);
  c.eyewear = pickKey(rng, EYEWEAR);
  c.radio = rng.pick(['handheld', 'handheld', 'manpack']);
  c.patch = { show: true, color: pickKey(rng, PATCH_COLORS) };
  c.insignia = pickKey(rng, INSIGNIA);
  c.loadout = { primary: ROLES[c.role].primary, kit: fitKit(ROLES[c.role].kit, VESTS[c.vest].slots) };
  return c;
}

export function fitKit(kit, slots) {
  return kit.filter((k) => KIT_OPTIONS[k]).slice(0, slots);
}

// Makes any (possibly old or hand-edited) config valid.
export function sanitizeConfig(raw) {
  const d = defaultConfig();
  const c = { ...d, ...(raw || {}) };
  const inSet = (v, set, def) => (Object.prototype.hasOwnProperty.call(set, v) ? v : def);
  c.name = String(c.name || d.name).replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 24) || d.name;
  c.gender = c.gender === 'female' ? 'female' : 'male';
  c.face = { ...d.face, ...(raw?.face || {}) };
  c.face.shape = inSet(c.face.shape, FACE_SHAPES, 'oval');
  for (const k of ['jaw', 'cheek', 'nose', 'brow', 'age']) c.face[k] = Math.min(1, Math.max(0, Number(c.face[k]) || 0));
  c.skin = Math.min(SKIN_TONES.length - 1, Math.max(0, Math.round(Number(c.skin) || 0)));
  c.hair = { style: inSet(raw?.hair?.style, HAIR_STYLES, d.hair.style), color: inSet(raw?.hair?.color, HAIR_COLORS, d.hair.color) };
  c.eyes = inSet(c.eyes, EYE_COLORS, d.eyes);
  c.facialHair = c.gender === 'male' ? inSet(c.facialHair, FACIAL_HAIR, 'none') : 'none';
  c.voice = { ...d.voice, ...(raw?.voice || {}) };
  c.voice.preset = inSet(c.voice.preset, VOICE_PRESETS, 'medium');
  c.voice.style = inSet(c.voice.style, VOICE_STYLES, 'firm');
  c.voice.pitch = Math.min(1.5, Math.max(0.5, Number(c.voice.pitch) || 1));
  c.voice.voiceURI = String(c.voice.voiceURI || '');
  c.role = inSet(c.role, ROLES, 'rifleman');
  c.uniform = {
    type: inSet(raw?.uniform?.type, UNIFORM_TYPES, d.uniform.type),
    color: inSet(raw?.uniform?.color, UNIFORM_COLORS, d.uniform.color),
    camo: inSet(raw?.uniform?.camo, CAMO_PATTERNS, d.uniform.camo),
  };
  c.helmet = inSet(c.helmet, HELMETS, d.helmet);
  c.helmetCover = inSet(c.helmetCover, HELMET_COVERS, 'camo');
  c.vest = inSet(c.vest, VESTS, d.vest);
  c.gloves = inSet(c.gloves, GLOVES, d.gloves);
  c.boots = inSet(c.boots, BOOTS, d.boots);
  c.backpack = inSet(c.backpack, BACKPACKS, d.backpack);
  c.kneepads = inSet(c.kneepads, KNEEPADS, d.kneepads);
  c.eyewear = inSet(c.eyewear, EYEWEAR, d.eyewear);
  c.radio = inSet(c.radio, RADIOS, d.radio);
  c.patch = { show: raw?.patch?.show !== false, color: inSet(raw?.patch?.color, PATCH_COLORS, 'olive') };
  c.insignia = inSet(c.insignia, INSIGNIA, 'flag');
  const primary = inSet(raw?.loadout?.primary, PRIMARY_WEAPONS, ROLES[c.role].primary);
  const kit = Array.isArray(raw?.loadout?.kit) ? raw.loadout.kit : ROLES[c.role].kit;
  c.loadout = { primary, kit: fitKit(kit, VESTS[c.vest].slots) };
  return c;
}

// Gameplay numbers that follow from the configuration. Called again whenever
// the player swaps gear in the field (e.g. finds police body armour).
export function deriveStats(c) {
  const vest = VESTS[c.vest];
  const pack = BACKPACKS[c.backpack];
  const helmet = HELMETS[c.helmet];
  const role = c.role;
  return {
    capacity: 14 + pack.capacity + (vest.slots >= 5 ? 2 : 0),
    armor: vest.armor,
    headArmor: helmet.head || 0,
    concussionResist: helmet.concussion || 0,
    dustProtection: c.eyewear === 'goggles' ? 0.85 : c.eyewear === 'glasses' ? 0.45 : 0,
    speedMult: (vest.speed || 1) * (pack.speed || 1),
    staminaDrainMult: 1 + (vest.weight - 3) * 0.03,
    noiseMult: (role === 'marksman' ? 0.75 : 1) * (c.boots === 'green' ? 0.9 : 1),
    crouchNoiseMult: c.kneepads === 'standard' ? 0.6 : 1,
    crouchSpeedMult: c.kneepads === 'standard' ? 1.15 : 1,
    kitSlots: vest.slots,
    debrisSpeed: (c.gloves !== 'none' ? 1.3 : 1) * (role === 'engineer' ? 1.4 : 1),
    repairSpeed: role === 'engineer' ? 1.4 : 1,
    treatSpeed: role === 'medic' ? 1.4 : 1,
    healBonus: role === 'medic' ? 1.5 : 1,
    aimSteady: role === 'rifleman' ? 0.75 : 1,
    extraMags: role === 'rifleman' ? 2 : 0,
    droneRange: role === 'marksman' ? 1.3 : 1,
    radioRange: RADIOS[c.radio].range * (role === 'comms' ? 1.5 : 1),
    signalBonus: role === 'comms' ? 1 : 0,
    handCutChance: c.gloves === 'none' ? 0.25 : c.gloves === 'fingerless' ? 0.12 : 0,
    gearWeight: vest.weight + pack.weight,
  };
}

// Items the soldier carries into the opening scene.
export function startingItems(c) {
  const stats = deriveStats(c);
  const w = c.loadout.primary;
  const ammo = { ar: ['ammo_556', 90], carbine: ['ammo_556', 90], smg: ['ammo_9mm', 90], dmr: ['ammo_762', 60], shotgun: ['ammo_12g', 24] }[w];
  const extraPer = { ar: 30, carbine: 30, smg: 30, dmr: 20, shotgun: 8 }[w];
  const items = [
    [`w_${w}`, 1], ['w_pistol', 1], ['ammo_9mm', 45], [ammo[0], ammo[1] + stats.extraMags * extraPer],
    ['flashlight', 1], ['emergency_card', 1],
  ];
  for (const k of c.loadout.kit) items.push([k, KIT_COUNTS[k] || 1]);
  // Merge duplicates (e.g. two bandage slots, or the SMG sharing 9 mm).
  const merged = new Map();
  for (const [id, n] of items) merged.set(id, (merged.get(id) || 0) + n);
  return [...merged.entries()];
}
