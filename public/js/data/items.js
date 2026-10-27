// Every item in BROKEN FRONT. Weight is in kilograms, price in euros (only
// used by the shops in the opening). `use` describes what happens when the
// item is consumed; the survival system interprets it.

export const CATEGORIES = {
  weapon: 'Weapons',
  ammo: 'Ammunition',
  food: 'Food',
  water: 'Drinks',
  medical: 'Medical',
  power: 'Power',
  comms: 'Communications',
  document: 'Documents',
  tool: 'Tools & Survival',
  gear: 'Gear',
};

const I = (id, name, cat, weight, extra = {}) => ({ id, name, cat, weight, stack: 1, price: 0, ...extra });

export const ITEMS = Object.fromEntries([
  // --- Weapons (fictional designs, balanced around role) -------------------
  I('w_ar', 'AR-7 Assault Rifle', 'weapon', 3.6, { weapon: 'ar', desc: 'Reliable 5.56 rifle. Good all-rounder.' }),
  I('w_carbine', 'CK-4 Carbine', 'weapon', 2.9, { weapon: 'carbine', desc: 'Short 5.56 carbine. Handy indoors.' }),
  I('w_smg', 'SM-9 Submachine Gun', 'weapon', 2.4, { weapon: 'smg', desc: 'Fast-firing 9 mm. Quieter, short range.' }),
  I('w_dmr', 'M-308 Marksman Rifle', 'weapon', 4.5, { weapon: 'dmr', desc: 'Semi-automatic 7.62 rifle. Precise and loud.' }),
  I('w_shotgun', 'PS-12 Shotgun', 'weapon', 3.4, { weapon: 'shotgun', desc: 'Pump shotgun. Devastating up close.' }),
  I('w_pistol', 'P-9 Pistol', 'weapon', 0.9, { weapon: 'pistol', desc: 'Standard sidearm.' }),

  I('ammo_556', '5.56 mm rounds', 'ammo', 0.012, { stack: 300, ammo: '556' }),
  I('ammo_762', '7.62 mm rounds', 'ammo', 0.025, { stack: 160, ammo: '762' }),
  I('ammo_9mm', '9 mm rounds', 'ammo', 0.008, { stack: 300, ammo: '9mm' }),
  I('ammo_12g', '12 gauge shells', 'ammo', 0.04, { stack: 60, ammo: '12g' }),

  // --- Food -----------------------------------------------------------------
  I('bread', 'Bread loaf (Brot)', 'food', 0.5, { stack: 4, price: 2.49, use: { hunger: -28 }, desc: 'Dense rye bread from the bakery.' }),
  I('pretzel', 'Pretzel (Brezel)', 'food', 0.12, { stack: 6, price: 0.89, use: { hunger: -12 } }),
  I('chocolate', 'Chocolate bar', 'food', 0.1, { stack: 8, price: 1.29, use: { hunger: -10, stamina: 25 }, desc: 'Quick energy.' }),
  I('energy_bar', 'Energy bar', 'food', 0.06, { stack: 10, price: 1.49, use: { hunger: -15, stamina: 15 } }),
  I('canned_soup', 'Canned soup', 'food', 0.45, { stack: 4, price: 2.19, use: { hunger: -32, thirst: -6 } }),
  I('canned_beans', 'Canned beans', 'food', 0.42, { stack: 4, price: 1.39, use: { hunger: -34 } }),
  I('crackers', 'Crackers', 'food', 0.2, { stack: 6, price: 1.79, use: { hunger: -14, thirst: 4 } }),
  I('apple', 'Apple', 'food', 0.18, { stack: 6, price: 0.49, use: { hunger: -9, thirst: -5 } }),
  I('mre', 'Field ration (MRE)', 'food', 0.6, { stack: 4, use: { hunger: -55, thirst: -5 }, desc: 'Military ration. A full meal.' }),

  // --- Drinks ---------------------------------------------------------------
  I('water_small', 'Water bottle 0.5 L', 'water', 0.5, { stack: 6, price: 0.89, use: { thirst: -30 } }),
  I('water_large', 'Water bottle 1.5 L', 'water', 1.5, { stack: 3, price: 1.29, use: { thirst: -70 } }),
  I('cola', 'Cola can', 'water', 0.35, { stack: 6, price: 1.49, use: { thirst: -18, stamina: 15 } }),
  I('juice', 'Apple juice', 'water', 1.0, { stack: 3, price: 1.99, use: { thirst: -40, hunger: -6 } }),
  I('dirty_water', 'Unsafe water', 'water', 1.0, { stack: 3, use: { thirst: -45, sickChance: 0.6 }, desc: 'From a broken pipe. Purify it first.' }),
  I('purify_tabs', 'Purification tablets', 'tool', 0.02, { stack: 20, price: 6.49, desc: 'Turns unsafe water into drinkable water.' }),

  // --- Medical --------------------------------------------------------------
  I('bandage', 'Bandage', 'medical', 0.05, { stack: 10, price: 3.95, use: { treat: ['bleeding_minor', 'laceration'], health: 4 }, desc: 'Stops minor bleeding, dresses cuts.' }),
  I('tourniquet', 'Tourniquet', 'medical', 0.08, { stack: 4, price: 24.9, use: { treat: ['bleeding_severe'] }, desc: 'Stops severe bleeding.' }),
  I('splint', 'Splint', 'medical', 0.15, { stack: 3, price: 14.9, use: { treat: ['fracture'] }, desc: 'Immobilises a broken limb so you can move.' }),
  I('painkillers', 'Painkillers', 'medical', 0.03, { stack: 10, price: 5.49, use: { painkiller: 120 }, desc: 'Dulls pain and disorientation for two hours.' }),
  I('antiseptic', 'Antiseptic spray', 'medical', 0.12, { stack: 4, price: 4.99, use: { treat: ['laceration', 'infection_risk'] }, desc: 'Cleans wounds and prevents infection.' }),
  I('antibiotics', 'Antibiotics', 'medical', 0.04, { stack: 6, use: { treat: ['infection', 'sickness'] }, desc: 'Cures infection and water sickness.' }),
  I('burn_gel', 'Burn dressing', 'medical', 0.1, { stack: 4, price: 7.95, use: { treat: ['burn'] } }),
  I('first_aid_kit', 'First aid kit', 'medical', 0.6, { stack: 2, price: 19.9, use: { health: 35, treat: ['bleeding_minor', 'laceration', 'concussion', 'unconscious'] }, desc: 'Restores health and can revive an unconscious person.' }),

  // --- Power ----------------------------------------------------------------
  I('batteries', 'AA batteries (4)', 'power', 0.1, { stack: 6, price: 4.99, desc: 'Powers the flashlight and the field radio.' }),
  I('power_bank', 'Power bank', 'power', 0.3, { price: 29.99, charge: 100, desc: 'Charges the phone. Needs a USB cable.' }),
  I('drone_battery', 'Drone battery', 'power', 0.25, { stack: 3, price: 49.0, desc: 'Fully recharges the drone.' }),
  I('car_charger', 'Car USB charger', 'power', 0.05, { desc: 'Charge the phone from a wrecked car with a working battery.' }),
  I('crank_charger', 'Hand-crank charger', 'power', 0.45, { desc: 'Slow, noisy, but needs nothing else.' }),
  I('solar_charger', 'Folding solar charger', 'power', 0.5, { desc: 'Charges the phone slowly outdoors in daylight.' }),
  I('phone_battery', 'Replacement phone battery', 'power', 0.05, { desc: 'Fits your phone model. Restores full battery capacity.' }),

  // --- Communications --------------------------------------------------------
  I('usb_cable', 'USB-C cable', 'comms', 0.05, { price: 9.99 }),
  I('earphones', 'Wired earphones', 'comms', 0.03, { price: 14.99, desc: 'Lets you hear calls even if the phone speaker is broken.' }),
  I('speaker_module', 'Phone speaker module', 'comms', 0.01, { desc: 'Replacement earpiece speaker. Needs a precision screwdriver.' }),
  I('screen_kit', 'Screen repair kit', 'comms', 0.1, { desc: 'Replacement display and digitiser.' }),
  I('antenna_wire', 'Copper wire', 'comms', 0.2, { desc: 'Improvised antenna: one more bar of signal.' }),
  I('spare_phone', 'Abandoned phone', 'comms', 0.2, { desc: 'Intact phone, no SIM card, low battery.' }),
  I('sim_tool', 'Paperclip', 'comms', 0.005, { stack: 5, desc: 'Opens a SIM tray.' }),
  I('screwdriver', 'Precision screwdriver', 'tool', 0.05, { desc: 'For small electronics repairs.' }),
  I('field_radio', 'Field radio', 'comms', 2.2, { desc: 'Long-range military radio. Needs batteries and a frequency card.' }),
  I('sat_phone', 'Satellite phone', 'comms', 0.4, { desc: 'Works without a cell network if it has power and open sky.' }),

  // --- Documents -------------------------------------------------------------
  I('emergency_card', 'Emergency contact card', 'document', 0.01, { desc: 'Satgas Elang-7 laminated card: Central Command emergency line +62 21 555 0173.' }),
  I('freq_card', 'Radio frequency card', 'document', 0.01, { desc: 'Command net frequencies and call signs.' }),
  I('intel_orders', 'Enemy operation orders', 'document', 0.02, { desc: 'Orders for operation ASHEN SKY. Proof the strike was planned weeks in advance.' }),
  I('city_map', 'Tourist map of Kreuzhafen', 'document', 0.05, { desc: 'Reveals the street layout on your map.' }),
  I('note_sari', "Torn notebook page", 'document', 0.01, { desc: '"...carried her into the Apotheke, leg looks broken. Couldn\'t stay. - K." A green cross is sketched in the margin.' }),
  I('note_dimas', 'Radio log scrap', 'document', 0.01, { desc: 'Callsign ELANG-4 (Dimas) last keyed his radio near the church, St. Marien.' }),
  I('note_bima', 'Bloody field notebook', 'document', 0.01, { desc: '"Bima pinned near the Feuerwache. Need a jack or bar to lift the slab."' }),

  // --- Tools & survival --------------------------------------------------------
  I('flashlight', 'Flashlight', 'tool', 0.25, { price: 12.99, desc: 'Toggle with F. Visible from far away at night.' }),
  I('crowbar', 'Crowbar', 'tool', 1.6, { desc: 'Pry open doors and lift debris.' }),
  I('car_jack', 'Hydraulic jack', 'tool', 3.5, { desc: 'Lifts heavy slabs off trapped people.' }),
  I('multitool', 'Multitool', 'tool', 0.25, { price: 24.9, desc: 'Speeds up repairs.' }),
  I('rope', 'Rope (15 m)', 'tool', 1.2, {}),
  I('duct_tape', 'Duct tape', 'tool', 0.2, { price: 3.99, desc: 'Improvise a splint with a broken plank and tape.' }),
  I('plank', 'Broken plank', 'tool', 0.8, { desc: 'Can become a splint with duct tape or a bandage.' }),
  I('lighter', 'Lighter', 'tool', 0.02, { price: 1.49 }),
  I('blanket', 'Emergency blanket', 'tool', 0.06, { price: 3.49, desc: 'Better rest anywhere you sleep.' }),
  I('smoke_grenade', 'Smoke grenade', 'tool', 0.45, { stack: 3, desc: 'Throw with T. Blocks vision. Marks a landing zone.' }),
  I('flare', 'Signal flare', 'tool', 0.3, { stack: 3, desc: 'Signals the rescue helicopter.' }),
  I('drone', 'Recon drone', 'tool', 1.1, { price: 229.0, desc: 'Camera quadcopter. Deploy with G outdoors.' }),
  I('drone_broken', 'Damaged drone', 'tool', 1.1, { desc: 'A rotor arm is cracked. Repair with duct tape or a multitool.' }),

  // --- Gear found in the world -------------------------------------------------
  I('g_backpack_patrol', 'Patrol pack (45 L)', 'gear', 1.6, { slot: 'backpack', gear: 'patrol' }),
  I('g_vest_police', 'Police body armour', 'gear', 4.0, { slot: 'vest', gear: 'police' }),
  I('g_helmet_fire', 'Firefighter helmet', 'gear', 1.2, { slot: 'helmet', gear: 'fire' }),
  I('g_goggles', 'Dust goggles', 'gear', 0.15, { slot: 'eyewear', gear: 'goggles' }),
  I('g_gloves', 'Work gloves', 'gear', 0.15, { slot: 'gloves', gear: 'tactical' }),
].map((it) => [it.id, it]));

export function item(id) {
  const it = ITEMS[id];
  if (!it) throw new Error(`Unknown item: ${id}`);
  return it;
}

export const WEAPONS = {
  ar: { name: 'AR-7', item: 'w_ar', ammo: '556', mag: 30, damage: 34, rpm: 650, auto: true, spread: 1.1, range: 220, noise: 95, recoil: 1.0, slot: 'primary' },
  carbine: { name: 'CK-4', item: 'w_carbine', ammo: '556', mag: 30, damage: 30, rpm: 760, auto: true, spread: 1.5, range: 170, noise: 90, recoil: 0.9, slot: 'primary' },
  smg: { name: 'SM-9', item: 'w_smg', ammo: '9mm', mag: 30, damage: 22, rpm: 880, auto: true, spread: 2.1, range: 90, noise: 60, recoil: 0.6, slot: 'primary' },
  dmr: { name: 'M-308', item: 'w_dmr', ammo: '762', mag: 20, damage: 62, rpm: 260, auto: false, spread: 0.35, range: 400, noise: 120, recoil: 1.8, slot: 'primary' },
  shotgun: { name: 'PS-12', item: 'w_shotgun', ammo: '12g', mag: 8, damage: 13, pellets: 8, rpm: 70, auto: false, spread: 4.5, range: 40, noise: 100, recoil: 2.2, slot: 'primary' },
  pistol: { name: 'P-9', item: 'w_pistol', ammo: '9mm', mag: 15, damage: 25, rpm: 380, auto: false, spread: 1.6, range: 60, noise: 70, recoil: 0.7, slot: 'sidearm' },
};

export const AMMO_ITEM = { '556': 'ammo_556', '762': 'ammo_762', '9mm': 'ammo_9mm', '12g': 'ammo_12g' };
