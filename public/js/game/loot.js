// Loot tables and container contents. A container's contents are rolled the
// first time it is opened and then stored in the save, so searched places
// stay searched.

import { makeRng } from '../core/util.js';

// [item, weight, min, max]
export const LOOT_TABLES = {
  supermarket_food: { rolls: [2, 4], entries: [['canned_soup', 4, 1, 2], ['canned_beans', 4, 1, 2], ['crackers', 3, 1, 2], ['bread', 2, 1, 1], ['chocolate', 3, 1, 3], ['energy_bar', 2, 1, 2], ['pretzel', 2, 1, 2], ['apple', 2, 1, 3]] },
  supermarket_drinks: { rolls: [2, 3], entries: [['water_small', 5, 1, 3], ['water_large', 4, 1, 2], ['cola', 3, 1, 2], ['juice', 2, 1, 1]] },
  supermarket_storage: { rolls: [2, 3], entries: [['water_large', 4, 1, 2], ['canned_beans', 3, 1, 3], ['purify_tabs', 2, 5, 10], ['batteries', 2, 1, 2], ['lighter', 1, 1, 1]] },
  pharmacy: { rolls: [2, 3], entries: [['bandage', 5, 1, 3], ['painkillers', 4, 2, 4], ['antiseptic', 3, 1, 1], ['burn_gel', 2, 1, 1], ['splint', 2, 1, 1], ['antibiotics', 2, 1, 2], ['first_aid_kit', 1, 1, 1], ['tourniquet', 1, 1, 1]] },
  pharmacy_counter: { rolls: [1, 2], entries: [['painkillers', 3, 2, 4], ['bandage', 3, 1, 2], ['purify_tabs', 2, 5, 10]] },
  electronics: { rolls: [1, 2], entries: [['batteries', 4, 1, 2], ['usb_cable', 3, 1, 1], ['earphones', 2, 1, 1], ['power_bank', 2, 1, 1], ['drone_battery', 1, 1, 1], ['screen_kit', 1, 1, 1]] },
  electronics_storage: { rolls: [1, 3], entries: [['power_bank', 3, 1, 1], ['batteries', 3, 1, 2], ['screwdriver', 3, 1, 1], ['screen_kit', 1, 1, 1], ['drone_battery', 2, 1, 1]] },
  kiosk: { rolls: [2, 3], entries: [['cola', 3, 1, 2], ['chocolate', 3, 1, 3], ['water_small', 3, 1, 2], ['batteries', 2, 1, 1], ['lighter', 2, 1, 1], ['power_bank', 1, 1, 1]] },
  bakery: { rolls: [1, 3], entries: [['bread', 4, 1, 2], ['pretzel', 4, 1, 4], ['water_small', 1, 1, 1]] },
  kitchen: { rolls: [1, 3], entries: [['canned_soup', 3, 1, 2], ['bread', 2, 1, 1], ['crackers', 2, 1, 1], ['water_large', 3, 1, 1], ['juice', 2, 1, 1], ['canned_beans', 2, 1, 1]] },
  apartment: { rolls: [1, 3], entries: [['painkillers', 3, 1, 3], ['batteries', 3, 1, 1], ['usb_cable', 2, 1, 1], ['blanket', 2, 1, 1], ['earphones', 2, 1, 1], ['duct_tape', 2, 1, 1], ['power_bank', 1, 1, 1], ['bandage', 2, 1, 2]] },
  hardware: { rolls: [2, 3], entries: [['duct_tape', 4, 1, 2], ['rope', 2, 1, 1], ['batteries', 3, 1, 2], ['multitool', 2, 1, 1], ['screwdriver', 3, 1, 1], ['g_gloves', 1, 1, 1], ['plank', 2, 1, 2], ['antenna_wire', 2, 1, 1], ['crowbar', 1, 1, 1]] },
  police: { rolls: [2, 3], entries: [['ammo_9mm', 4, 15, 30], ['ammo_556', 3, 20, 40], ['bandage', 3, 1, 2], ['tourniquet', 2, 1, 1], ['batteries', 2, 1, 2], ['smoke_grenade', 1, 1, 1], ['flashlight', 1, 1, 1]] },
  office: { rolls: [1, 2], entries: [['batteries', 3, 1, 1], ['painkillers', 2, 1, 2], ['usb_cable', 2, 1, 1], ['chocolate', 2, 1, 1], ['sim_tool', 2, 1, 2], ['city_map', 1, 1, 1]] },
  luggage: { rolls: [1, 3], entries: [['water_small', 3, 1, 2], ['energy_bar', 2, 1, 2], ['chocolate', 2, 1, 2], ['painkillers', 2, 1, 2], ['earphones', 2, 1, 1], ['power_bank', 1, 1, 1], ['blanket', 1, 1, 1], ['city_map', 1, 1, 1]] },
  security: { rolls: [1, 2], entries: [['ammo_9mm', 3, 15, 30], ['first_aid_kit', 1, 1, 1], ['batteries', 2, 1, 2]] },
  church: { rolls: [2, 3], entries: [['water_large', 3, 1, 2], ['blanket', 3, 1, 2], ['bread', 2, 1, 1], ['canned_soup', 2, 1, 2]] },
  gym: { rolls: [1, 2], entries: [['blanket', 3, 1, 2], ['water_small', 2, 1, 2], ['g_goggles', 1, 1, 1], ['rope', 1, 1, 1]] },
  shelter_supplies: { rolls: [3, 4], entries: [['water_large', 4, 1, 2], ['canned_beans', 3, 1, 2], ['blanket', 2, 1, 2], ['first_aid_kit', 1, 1, 1], ['batteries', 2, 1, 2], ['purify_tabs', 2, 5, 10]] },
  firestation: { rolls: [2, 3], entries: [['flare', 3, 1, 2], ['burn_gel', 3, 1, 2], ['rope', 2, 1, 1], ['g_goggles', 2, 1, 1], ['bandage', 3, 1, 3], ['tourniquet', 1, 1, 1]] },
  vending: { rolls: [2, 3], entries: [['cola', 3, 1, 2], ['water_small', 3, 1, 2], ['chocolate', 3, 1, 2], ['crackers', 2, 1, 1]] },
  car: { rolls: [1, 2], entries: [['water_small', 3, 1, 1], ['chocolate', 2, 1, 1], ['car_charger', 3, 1, 1], ['usb_cable', 2, 1, 1], ['blanket', 1, 1, 1], ['flashlight', 1, 1, 1], ['duct_tape', 1, 1, 1], ['sim_tool', 1, 1, 1]] },
  squadvan: { rolls: [2, 3], entries: [['water_large', 3, 1, 2], ['ammo_556', 3, 30, 60], ['ammo_9mm', 2, 15, 30], ['first_aid_kit', 1, 1, 1], ['smoke_grenade', 2, 1, 1], ['flare', 1, 1, 1]] },
  enemy: { rolls: [1, 3], entries: [['ammo_556', 5, 10, 30], ['mre', 2, 1, 1], ['bandage', 2, 1, 1], ['water_small', 2, 1, 1], ['batteries', 1, 1, 1], ['smoke_grenade', 1, 1, 1], ['tourniquet', 1, 1, 1]] },
  depot: { rolls: [4, 6], entries: [['mre', 4, 1, 3], ['water_large', 4, 1, 2], ['ammo_556', 3, 30, 60], ['first_aid_kit', 2, 1, 1], ['antibiotics', 2, 1, 2], ['flare', 2, 1, 1], ['drone_battery', 1, 1, 1]] },
};

// Scarcity grows after Day 6: other survivors got there first.
export function scarcityFor(day) {
  if (day >= 9) return 0.45;
  if (day >= 6) return 0.6;
  return 1;
}

export function rollTable(tableId, rng, scarcity = 1) {
  const t = LOOT_TABLES[tableId];
  if (!t) return [];
  const total = t.entries.reduce((a, e) => a + e[1], 0);
  const rolls = Math.max(0, Math.round(rng.int(t.rolls[0], t.rolls[1]) * scarcity));
  const out = new Map();
  for (let r = 0; r < rolls; r++) {
    let x = rng() * total;
    for (const [id, w, lo, hi] of t.entries) {
      x -= w;
      if (x <= 0) {
        const n = rng.int(lo, hi);
        out.set(id, (out.get(id) || 0) + n);
        break;
      }
    }
  }
  return [...out.entries()];
}

// Contents for a container the first time it's opened. Fixed items (needed
// for story progress) are always present, whatever the scarcity.
export function generateContents(container, worldSeed, day) {
  const rng = makeRng(`${worldSeed}:${container.id}`);
  const items = rollTable(container.table, rng, scarcityFor(day));
  for (const [id, n] of container.fixed || []) {
    const e = items.find((i) => i[0] === id);
    if (e) e[1] += n; else items.unshift([id, n]);
  }
  return items.map(([id, n]) => ({ id, n }));
}
