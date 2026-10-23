/* Giriş noktası: oyunu kurar, varlıkları yükler ve döngüyü başlatır. */

import { Game } from './game/game.js?v=perf-20261023a';

const canvas = document.getElementById('viewport');

function fatal(message, detail) {
  const status = document.getElementById('load-status');
  const loader = document.getElementById('loader');
  if (loader) loader.hidden = false;
  if (status) {
    status.textContent = message;
    status.style.color = '#c8432a';
  }
  console.error(message, detail);
}

if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
  fatal('Bu tarayıcı WebGL desteklemiyor.', null);
} else {
  const game = new Game(canvas);
  window.game = game;   // geliştirme sırasında konsoldan incelemek için

  game.load().then(() => {
    const loop = () => {
      game.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }).catch((err) => {
    fatal('Varlıklar yüklenemedi — sunucu çalışıyor mu?', err);
  });
}
