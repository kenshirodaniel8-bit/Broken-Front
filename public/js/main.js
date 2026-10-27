// BROKEN FRONT - entry point. Creates the UI, audio and game and wires the
// menus to them.

import { Game, DEFAULT_SETTINGS } from './game/game.js';
import { UI } from './ui/ui.js';
import { installPanels } from './ui/panels.js';
import { installDialogs } from './ui/dialogs.js';
import { installPhone } from './ui/phone-ui.js';
import { installMenus } from './ui/menus.js';
import { Creator } from './ui/creator.js';
import { AudioEngine } from './core/audio.js';
import { loadPref } from './game/save.js';
import { loadModelOverrides } from './core/assets.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const ui = new UI(document.getElementById('ui'));
const audio = new AudioEngine();
audio.onSubtitle = (who, text, opts) => ui.subtitle(who, text, opts);

let game;
try {
  game = new Game({ canvas, ui, audio, settings: loadPref('settings', DEFAULT_SETTINGS) });
} catch (e) {
  loading.hidden = false;
  loading.querySelector('p').textContent = 'WebGL is not available in this browser, so the game cannot start. Try a current version of Chrome, Edge or Firefox with hardware acceleration enabled.';
  throw e;
}
ui.attach(game);

const showLoading = (text) => {
  loading.hidden = false;
  loading.querySelector('p').textContent = text;
};

const app = {
  openCreator() {
    audio.init();
    new Creator(ui, audio, (cfg, skip) => app.startNew(cfg, skip), () => ui.showMainMenu()).open();
  },
  startNew(cfg, skip) {
    audio.init();
    ui.hideMenu();
    showLoading('Building Kreuzhafen…');
    setTimeout(() => {
      game.newGame(cfg, { skipPrologue: skip });
      loading.hidden = true;
      game.input.requestLock();
    }, 60);
  },
  loadSlot(slot) {
    audio.init();
    ui.hideMenu();
    while (ui.stack.length) ui.closeTop();
    showLoading('Loading…');
    setTimeout(() => {
      const ok = game.load(slot);
      loading.hidden = true;
      if (!ok) ui.showMainMenu(); else game.input.requestLock();
    }, 60);
  },
  toMainMenu() {
    while (ui.stack.length) ui.closeTop();
    game.toMenu();
    ui.showMainMenu();
  },
};

installPanels(ui);
installDialogs(ui, { onMainMenu: () => app.toMainMenu(), onLoadSlot: (s) => app.loadSlot(s) });
installPhone(ui);
installMenus(ui, app);

canvas.addEventListener('click', () => {
  audio.init();
  if ((game.mode === 'play' || game.mode === 'drone') && !ui.anyOpen()) game.input.requestLock();
});
document.addEventListener('pointerdown', () => audio.init(), { once: true });

loadModelOverrides().finally(() => {
  loading.hidden = true;
  ui.showMainMenu();
});

// Handle for automated tests and debugging from the console.
window.__BF = {
  game, ui, app, audio,
  // Render one settled frame with the loop paused (for screenshots).
  frame() {
    game.stop();
    ui.settle();
    ui.update(0.016);
    game.render();
  },
};
