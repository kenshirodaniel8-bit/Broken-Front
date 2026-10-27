// Save slots in localStorage. The game builds the snapshot; this module
// only stores, lists and validates it. Every access is guarded because
// storage can be unavailable (private windows, blocked site data).

export const SAVE_VERSION = 3;
export const SLOTS = ['auto', '1', '2', '3'];
const KEY = (slot) => `brokenfront.save.${slot}`;

function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const k = '__bf_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export function storageAvailable() { return !!storage(); }

export function writeSave(slot, snapshot) {
  const s = storage();
  if (!s) return { ok: false, error: 'Browser storage is not available.' };
  const data = { version: SAVE_VERSION, savedAt: Date.now(), ...snapshot };
  try {
    s.setItem(KEY(slot), JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.name === 'QuotaExceededError' ? 'Storage is full.' : 'Could not save.' };
  }
}

export function readSave(slot) {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY(slot));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function deleteSave(slot) {
  try { storage()?.removeItem(KEY(slot)); } catch { /* ignore */ }
}

export function listSaves() {
  return SLOTS.map((slot) => {
    const d = readSave(slot);
    return d ? { slot, savedAt: d.savedAt, label: d.label || '', day: d.campaign?.day, time: d.campaign?.minutes, name: d.config?.name } : { slot, empty: true };
  });
}

export function latestSave() {
  let best = null;
  for (const s of listSaves()) if (!s.empty && (!best || s.savedAt > best.savedAt)) best = s;
  return best;
}

// Settings and the last created character live next to the saves.
export function loadPref(key, fallback) {
  try {
    const raw = storage()?.getItem(`brokenfront.${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try { storage()?.setItem(`brokenfront.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
}
