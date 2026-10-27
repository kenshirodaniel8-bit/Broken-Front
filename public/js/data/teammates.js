// The squad: Satgas Elang-7, an Indonesian security detachment attached to
// the German president's visit. Lines carry an English subtitle (`t`) and
// optionally what is actually spoken (`s`, may be Indonesian).

import { defaultConfig } from './customization.js';

const look = (over) => {
  const c = defaultConfig();
  return {
    ...c, ...over,
    face: { ...c.face, ...(over.face || {}) },
    hair: { ...c.hair, ...(over.hair || {}) },
    uniform: { ...c.uniform, ...(over.uniform || {}) },
    voice: { ...c.voice, ...(over.voice || {}) },
  };
};

export const TEAMMATES = [
  {
    id: 'bima',
    name: 'Bima Pratama',
    short: 'Bima',
    rank: 'Serka',
    callsign: 'ELANG-1',
    role: 'Squad leader',
    weapon: 'ar',
    bio: 'Twenty years in uniform. Quiet, steady, the first to see the planes.',
    voice: { pitch: 0.72, rate: 0.92, lang: 'id-ID' },
    look: look({
      name: 'Bima Pratama', gender: 'male', skin: 6, hair: { style: 'buzz', color: 'black' }, facialHair: 'mustache',
      face: { shape: 'square', jaw: 0.8, age: 0.75, brow: 0.7 }, helmet: 'combat', vest: 'plate', backpack: 'patrol', radio: 'manpack',
      eyewear: 'none', insignia: 'eagle', uniform: { camo: 'loreng', color: 'olive', type: 'field' },
    }),
    start: { injuries: [['bleeding_severe', 'leg'], ['fracture', 'leg']], health: 55, trapped: 'slab', critical: 54 },
    lines: {
      help: [{ t: 'Anyone... anyone on this net... ELANG-1... I\'m pinned.', radio: true }, { t: 'Tolong! Help! Over here!', s: 'Tolong!' }],
      found: [{ t: 'Took you long enough. Get this thing off my leg.' }],
      freed: [{ t: 'Arrgh! ...Okay. Okay. I can breathe again.' }],
      treated: [{ t: 'Good work. Now let\'s get our people home.' }],
      follow: [{ t: 'Right behind you.' }, { t: 'Lead the way.' }],
      wait: [{ t: 'Holding here.' }],
      shelter: [{ t: 'Heading back. Watch yourself out there.' }],
      hungry: [{ t: 'When did we last eat? I could use something.' }],
      thirsty: [{ t: 'Water. I need water.' }],
      pain: [{ t: 'The leg... still bleeding. I need a tourniquet.' }],
      danger: [{ t: 'Contact! Get down!', s: 'Awas! Kontak!' }, { t: 'Enemy patrol. Stay low.' }],
      idle: [{ t: 'They planned this. The convoy route, the timing... They knew.' }, { t: 'My daughter turns nine next week.' }],
      night: [{ t: 'Sleep in shifts. I\'ll take first watch.' }],
      thanks: [{ t: 'Terima kasih. I owe you.', s: 'Terima kasih.' }],
      dying: [{ t: 'I can\'t... feel my legs...' }],
      extract: [{ t: 'Elang-7, going home. Every one of us.' }],
    },
  },
  {
    id: 'rizky',
    name: 'Rizky Hidayat',
    short: 'Rizky',
    rank: 'Kopda',
    callsign: 'ELANG-3',
    role: 'Rifleman',
    weapon: 'carbine',
    bio: 'The squad joker. Bought far too much chocolate before the bus.',
    voice: { pitch: 1.08, rate: 1.08, lang: 'id-ID' },
    look: look({
      name: 'Rizky Hidayat', gender: 'male', skin: 4, hair: { style: 'short', color: 'black' }, facialHair: 'none',
      face: { shape: 'round', jaw: 0.4, age: 0.15 }, helmet: 'highcut', vest: 'chestrig', backpack: 'assault', eyewear: 'glasses',
      insignia: 'flag', uniform: { camo: 'multi', color: 'khaki', type: 'combatshirt' }, gloves: 'fingerless',
    }),
    start: { injuries: [['bleeding_minor', 'arm']], health: 70, trapped: 'lamp', critical: 0 },
    lines: {
      help: [{ t: 'Tolong! Somebody! My arm\'s stuck!', s: 'Tolong!' }, { t: 'HEY! Is anyone alive out there?!' }],
      found: [{ t: 'You\'re alive! Get this pole off me, please!' }],
      freed: [{ t: 'Ahh! Thank you, thank you. I thought I was finished.' }],
      treated: [{ t: 'Not bad, doc. Not bad at all.' }],
      follow: [{ t: 'With you.' }, { t: 'Okay, okay, I\'m coming.' }],
      wait: [{ t: 'I\'ll wait. Don\'t forget me, yeah?' }],
      shelter: [{ t: 'Going to the shelter. I\'ll save you some chocolate. Maybe.' }],
      hungry: [{ t: 'My stomach is louder than the helicopters.' }],
      thirsty: [{ t: 'Got any water? My mouth is full of dust.' }],
      pain: [{ t: 'Arm\'s still bleeding... got a bandage?' }],
      danger: [{ t: 'Enemy! There!', s: 'Musuh!' }, { t: 'Patrol coming!' }],
      idle: [{ t: 'Remember the bakery this morning? Feels like a year ago.' }, { t: 'If we get home, I\'m never complaining about rice again.' }],
      night: [{ t: 'Can\'t sleep. Every sound is a plane.' }],
      thanks: [{ t: 'You saved my life, you know that?' }],
      dying: [{ t: 'Tell my mother... tell her...' }],
      extract: [{ t: 'We made it. We actually made it!' }],
    },
  },
  {
    id: 'sari',
    name: 'Sari Wulandari',
    short: 'Sari',
    rank: 'Pratu',
    callsign: 'ELANG-5',
    role: 'Combat medic',
    weapon: 'smg',
    medic: true,
    bio: 'The squad medic. Once rescued she treats wounded teammates at the shelter.',
    voice: { pitch: 1.3, rate: 1.0, lang: 'id-ID' },
    look: look({
      name: 'Sari Wulandari', gender: 'female', skin: 3, hair: { style: 'bun', color: 'darkbrown' }, facialHair: 'none',
      face: { shape: 'oval', jaw: 0.3, age: 0.25 }, helmet: 'combat', vest: 'platelight', backpack: 'patrol', insignia: 'medic',
      uniform: { camo: 'loreng', color: 'ranger', type: 'rolled' }, eyewear: 'none', radio: 'handheld',
    }),
    start: { injuries: [['fracture', 'leg']], health: 60, trapped: null, critical: 96 },
    lines: {
      help: [{ t: '...ELANG-5... my leg is broken... green cross... can anyone hear...', radio: true }, { t: 'Hello? I\'m in here! I can\'t walk!' }],
      found: [{ t: 'Thank God. My leg is broken - I need a splint. Or a plank and tape.' }],
      treated: [{ t: 'Good, that will hold. I can walk - slowly.' }],
      follow: [{ t: 'Coming. Don\'t go too fast.' }],
      wait: [{ t: 'I\'ll stay here.' }],
      shelter: [{ t: 'I\'ll set up a medical corner at the shelter.' }],
      hungry: [{ t: 'We need to eat something. All of us.' }],
      thirsty: [{ t: 'Dehydration will kill us before they do. Water?' }],
      pain: [{ t: 'The splint is slipping... I need painkillers.' }],
      danger: [{ t: 'Soldiers! Get down!', s: 'Tiarap!' }],
      idle: [{ t: 'Keep your wounds clean. Infection is the real enemy here.' }, { t: 'I counted the civilians in the square. I couldn\'t stop counting.' }],
      night: [{ t: 'Let me check your bandages before you sleep.' }],
      thanks: [{ t: 'You came back for me. Thank you.' }],
      dying: [{ t: 'It\'s... infected... I know the signs...' }],
      extract: [{ t: 'Everyone on board. Hold on to each other.' }],
      heal: [{ t: 'Sit down, let me look at that.' }],
    },
  },
  {
    id: 'dimas',
    name: 'Dimas Saputra',
    short: 'Dimas',
    rank: 'Praka',
    callsign: 'ELANG-4',
    role: 'Signaller / engineer',
    weapon: 'carbine',
    comms: true,
    bio: 'The squad signaller. Knows every frequency and the command emergency number by heart.',
    voice: { pitch: 0.95, rate: 0.98, lang: 'id-ID' },
    look: look({
      name: 'Dimas Saputra', gender: 'male', skin: 5, hair: { style: 'curly', color: 'black' }, facialHair: 'goatee',
      face: { shape: 'long', jaw: 0.5, age: 0.35, nose: 0.7 }, helmet: 'boonie', vest: 'chestrig', backpack: 'ruck', radio: 'manpack',
      insignia: 'eagle', uniform: { camo: 'woodland', color: 'olive', type: 'field' }, eyewear: 'goggles',
    }),
    start: { injuries: [['concussion', 'head'], ['bleeding_minor', 'head']], health: 40, trapped: null, unconscious: true, critical: 72 },
    lines: {
      help: [{ t: '(static) ...four... church... (static)', radio: true }],
      found: [{ t: 'Ugh... where... what happened?' }],
      treated: [{ t: 'Head\'s pounding. But I remember the command number. Plus 62 21 555 0173.' }],
      follow: [{ t: 'On you.' }],
      wait: [{ t: 'Staying put.' }],
      shelter: [{ t: 'I\'ll see if I can rig an antenna at the shelter.' }],
      hungry: [{ t: 'Need food. Can\'t think straight.' }],
      thirsty: [{ t: 'Water, please.' }],
      pain: [{ t: 'My head... everything is spinning.' }],
      danger: [{ t: 'Movement! Enemy!', s: 'Musuh!' }],
      idle: [{ t: 'Their radios use frequency hopping. Very professional. Too professional.' }, { t: 'If you find copper wire, bring it. More wire, more signal.' }],
      night: [{ t: 'I keep hearing their radio chatter in my head.' }],
      thanks: [{ t: 'Thanks for not leaving me in there.' }],
      dying: [{ t: '...cold...' }],
      extract: [{ t: 'Command, Elang-4: package secure. Taking us home.' }],
    },
  },
];

export function teammate(id) {
  return TEAMMATES.find((t) => t.id === id);
}

// Opening scene dialogue.
export const PROLOGUE_LINES = {
  arrive: [
    { who: 'bima', t: 'Kreuzhafen. The President speaks at the Rathaus at fourteen hundred. We are outer perimeter support.' },
    { who: 'bima', t: 'Gear check, then supplies. Bus leaves from the Hauptbahnhof stop in thirty minutes.' },
    { who: 'rizky', t: 'Thirty minutes of free shopping in Germany. I love this job.' },
  ],
  shopping: [
    { who: 'sari', t: 'Get some medical supplies at the Apotheke. You never know.' },
    { who: 'dimas', t: 'Elektro Brandt sells drones. Recon at our own expense, but still.' },
  ],
  walk: [
    { who: 'bima', t: 'Everyone, with me. Bus is on Bahnhofstraße.' },
    { who: 'rizky', t: 'Did anyone else buy pretzels? No? Just me? Okay.' },
  ],
  lookUp: [{ who: 'bima', t: '...Tunggu. Wait. Listen.', s: 'Tunggu.' }],
  run: [{ who: 'bima', t: 'KABUR! SEMUA, LARI!  (Run! Everyone, run!)', s: 'Kabur! Semua, lari!', shout: true }],
  panic: [
    { who: 'sari', t: 'Get off the street! Off the street!' },
    { who: 'rizky', t: 'What is that?! What IS that?!' },
  ],
  blackout: [
    { who: 'rizky', t: 'Tolong...! Somebody...!', s: 'Tolong!' },
    { who: 'sari', t: '...can\'t feel my leg... Bima?... BIMA!' },
    { who: 'bima', t: 'ELANG... sound off... sound off...' },
  ],
};
