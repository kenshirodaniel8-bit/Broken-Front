// Main menu, pause menu, settings, save/load and controls.

import { h, clear } from './dom.js';
import { listSaves, deleteSave, latestSave, savePref, storageAvailable } from '../game/save.js';
import { formatClock } from '../core/util.js';

export const CONTROLS = [
  ['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['C / Ctrl', 'Crouch (quieter, harder to see)'], ['Space', 'Jump'],
  ['E (hold)', 'Interact: search, free, treat, talk, climb'], ['Left mouse', 'Fire'], ['Right mouse', 'Aim down sights'], ['R', 'Reload'],
  ['1 / 2', 'Primary / sidearm'], ['3 – 8', 'Use pouch items'], ['T', 'Throw smoke grenade'], ['F', 'Flashlight'], ['G', 'Deploy / land drone'],
  ['P', 'Phone'], ['Tab / I', 'Inventory'], ['M', 'Map'], ['J', 'Journal'], ['K', 'Squad'], ['Esc', 'Close / pause'],
];

export function installMenus(ui, app) {
  const menuRoot = h('div', { id: 'menu' });
  ui.root.append(menuRoot);
  ui.menuRoot = menuRoot;

  const screen = (...content) => {
    clear(menuRoot).append(h('div', { class: 'menu-bg' }), h('div', { class: 'menu-box' }, ...content));
    menuRoot.hidden = false;
  };

  ui.showMainMenu = () => {
    ui.showHud(false);
    const last = latestSave();
    screen(
      h('div', { class: 'logo' }, h('h1', {}, 'BROKEN', h('span', {}, ' FRONT')), h('p', {}, 'Twelve days. One ruined city. Bring them home.')),
      h('div', { class: 'btn-col' },
        last ? h('button', { class: 'primary', onclick: () => app.loadSlot(last.slot) }, `Continue — ${last.label || `Day ${last.day}`}`) : '',
        h('button', { class: last ? '' : 'primary', onclick: () => app.openCreator() }, 'New game'),
        h('button', { onclick: () => ui.showLoad('menu') }, 'Load game'),
        h('button', { onclick: () => ui.showSettings('menu') }, 'Settings'),
        h('button', { onclick: () => ui.showControls('menu') }, 'Controls'),
        h('button', { onclick: () => ui.showAbout() }, 'About'),
      ),
      storageAvailable() ? '' : h('p', { class: 'warn' }, 'Browser storage is unavailable: saving is disabled in this window.'),
      h('p', { class: 'foot' }, 'A fictional story. Headphones recommended.'),
    );
  };

  ui.hideMenu = () => { menuRoot.hidden = true; clear(menuRoot); };

  ui.showAbout = () => {
    screen(h('h2', {}, 'About BROKEN FRONT'),
      h('p', {}, 'A realistic first-person survival game. Satgas Elang-7, an Indonesian security detachment, is in the German city of Kreuzhafen for the Federal President\'s visit when a pre-planned strike levels the district. Find your squad, keep them alive, repair your phone, call for rescue and survive twelve days until extraction.'),
      h('p', { class: 'muted' }, 'All characters, units, the city and the hostile force are fictional. Graphics, models and sounds are procedurally generated stand-ins; drop GLB models into assets/models and audio files into assets/audio (see their manifest.json) to replace them.'),
      h('button', { onclick: () => ui.showMainMenu() }, 'Back'));
  };

  ui.showControls = (from) => {
    const back = () => (from === 'pause' ? ui.openPause() : ui.showMainMenu());
    const content = [h('h2', {}, 'Controls'), h('div', { class: 'controls' }, ...CONTROLS.map(([k, v]) => h('div', {}, h('kbd', {}, k), h('span', {}, v)))), h('button', { onclick: back }, 'Back')];
    if (from === 'pause') { ui.close('pause'); ui.open('controls', h('div', { class: 'panel dialog wide' }, ...content)); } else screen(...content);
  };

  ui.showSettings = (from) => {
    const g = ui.game;
    const s = { ...g.settings };
    const row = (label, control) => h('label', { class: 'set-row' }, h('span', {}, label), control);
    const range = (key, min, max, step) => {
      const out = h('output', {}, String(s[key]));
      const inp = h('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => { s[key] = Number(e.target.value); out.textContent = e.target.value; } });
      return h('div', { class: 'range' }, inp, out);
    };
    const check = (key) => h('input', { type: 'checkbox', checked: s[key], onchange: (e) => { s[key] = e.target.checked; } });
    const select = (key, opts) => h('select', { onchange: (e) => { s[key] = e.target.value; } }, ...opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)));
    const apply = () => {
      const needsReload = s.quality !== g.settings.quality && QUALITY_NEEDS_RELOAD(g.settings.quality, s.quality);
      g.settings = s;
      savePref('settings', s);
      g.applySettings();
      if (needsReload) g.toast('Anti-aliasing changes take effect after reloading the page.', 'info');
    };
    const back = () => { apply(); if (from === 'pause') { ui.close('settings'); ui.openPause(); } else ui.showMainMenu(); };
    const content = [
      h('h2', {}, 'Settings'),
      h('div', { class: 'settings' },
        h('h3', {}, 'Graphics'),
        row('Quality', select('quality', [['low', 'Low (no shadows)'], ['medium', 'Medium'], ['high', 'High']])),
        row('Field of view', range('fov', 55, 100, 1)),
        h('h3', {}, 'Controls'),
        row('Mouse sensitivity', range('sensitivity', 0.2, 3, 0.05)),
        row('Invert mouse Y', check('invertY')),
        h('h3', {}, 'Audio'),
        row('Master volume', range('master', 0, 1, 0.05)),
        row('Effects', range('sfx', 0, 1, 0.05)),
        row('Ambience', range('ambience', 0, 1, 0.05)),
        row('Voices', range('voice', 0, 1, 0.05)),
        row('Spoken dialogue (speech synthesis)', check('tts')),
        row('Subtitles', check('subtitles')),
        h('h3', {}, 'Gameplay'),
        row('Day length', select('dayLength', [['short', 'Short (≈10 min per day)'], ['normal', 'Normal (≈16 min)'], ['long', 'Long (≈24 min)']])),
        row('Tutorial hints', check('hints')),
      ),
      h('div', { class: 'btn-row' }, h('button', { class: 'primary', onclick: back }, 'Apply & back')),
    ];
    if (from === 'pause') { ui.close('pause'); ui.open('settings', h('div', { class: 'panel dialog wide' }, ...content)); } else screen(...content);
  };

  ui.showLoad = (from, mode = 'load') => {
    const g = ui.game;
    const slots = listSaves();
    const rows = slots.filter((s) => mode === 'load' || s.slot !== 'auto').map((s) => h('div', { class: 'slot-row' },
      h('div', {}, h('b', {}, s.slot === 'auto' ? 'Autosave' : `Slot ${s.slot}`), h('div', { class: 'muted' }, s.empty ? 'Empty' : `${s.name} · Day ${s.day} ${formatClock(s.time || 0)} · ${new Date(s.savedAt).toLocaleString()}`)),
      mode === 'save'
        ? h('button', { onclick: () => { const r = g.save(s.slot); if (!r.ok) g.toast(r.error, 'warn'); ui.showLoad(from, 'save'); } }, s.empty ? 'Save here' : 'Overwrite')
        : h('button', { disabled: s.empty, onclick: () => { ui.close('saves'); app.loadSlot(s.slot); } }, 'Load'),
      !s.empty ? h('button', { class: 'ghost', onclick: () => { deleteSave(s.slot); ui.showLoad(from, mode); } }, 'Delete') : ''));
    const back = () => (from === 'pause' ? (ui.close('saves'), ui.openPause()) : ui.showMainMenu());
    const content = [h('h2', {}, mode === 'save' ? 'Save game' : 'Load game'), h('div', { class: 'slots' }, ...rows), h('button', { onclick: back }, 'Back')];
    if (from === 'pause') { ui.close('pause'); ui.close('saves'); ui.open('saves', h('div', { class: 'panel dialog wide' }, ...content)); } else screen(...content);
  };

  ui.openPause = () => {
    const g = ui.game;
    if (!g || g.mode === 'menu' || g.mode === 'dead' || g.mode === 'ending') return;
    if (ui.isOpen('pause')) return;
    ui.pauseOpenedAt = performance.now();
    const canSave = g.campaignStarted;
    ui.open('pause', h('div', { class: 'panel dialog pause' },
      h('h2', {}, 'Paused'),
      h('p', { class: 'muted' }, g.campaignStarted ? `Day ${g.campaign.day}, ${formatClock(g.campaign.minutes)}` : 'The opening'),
      h('div', { class: 'btn-col' },
        h('button', { class: 'primary', onclick: () => ui.close('pause') }, 'Resume'),
        h('button', { disabled: !canSave, title: canSave ? '' : 'You can save once the twelve days begin', onclick: () => ui.showLoad('pause', 'save') }, 'Save game'),
        h('button', { onclick: () => ui.showLoad('pause', 'load') }, 'Load game'),
        h('button', { onclick: () => ui.showSettings('pause') }, 'Settings'),
        h('button', { onclick: () => ui.showControls('pause') }, 'Controls'),
        h('button', { class: 'ghost', onclick: () => { ui.close('pause'); app.toMainMenu(); } }, 'Quit to main menu'))));
  };
}

function QUALITY_NEEDS_RELOAD(a, b) { return (a === 'low') !== (b === 'low'); }
