/* Dokunmatik kontroller (telefon ve tablet, YATAY kullanım).

   Fare kilidi mobilde yok: Input "serbest bakış"a geçer, bu modül de
   klavye/fare girdisini taklit eder — oyun kodu değişmeden çalışır:
     • Sol yarı: parmağın değdiği yerde beliren hareket çubuğu (W A S D);
       sonuna kadar ileri itilince koşu (Shift).
     • Sağ yarı: sürükleyerek bakış (fare hareketi).
     • ATEŞ basılıyken parmak kaydırılırsa nişan da kayar (tek başparmak).
     • Diğer düğmeler tuş olayı üretir (R, Space, C, G, F, H, tekerlek…).
   Yalnızca oyun sırasında görünür (HUD açıkken).                          */

const LOOK_K = 2.4;          // dokunma pikseli → fare pikseli
const STICK_R = 56;          // çubuğun yarıçapı (px)

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
}

export class TouchControls {
  /** @param input Input  @param hooks { pause, onFirstTouch } */
  constructor(input, hooks = {}) {
    this.input = input;
    this.hooks = hooks;
    this.stick = null;        // { id, x0, y0 }
    this.look = new Map();    // dokunma kimliği → { x, y }
    this.crouch = false;
    this.aim = false;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.className = 'touch-ui';
    root.innerHTML = `
      <div class="t-stick" hidden><div class="t-knob"></div></div>
      <button class="t-btn t-pause" data-act="pause" type="button" aria-label="Duraklat">❚❚</button>
      <button class="t-btn t-e" data-key="KeyE" type="button">E</button>
      <button class="t-btn t-tel" data-key="KeyP" type="button">TEL</button>
      <div class="t-cluster">
        <button class="t-btn t-fire" data-act="fire" type="button">ATEŞ</button>
        <button class="t-btn t-aim" data-act="aim" type="button">NİŞAN</button>
        <button class="t-btn t-jump" data-hold="Space" type="button">ZIPLA</button>
        <button class="t-btn t-crouch" data-act="crouch" type="button">ÇÖMEL</button>
        <button class="t-btn t-reload" data-key="KeyR" type="button">DOLDUR</button>
        <button class="t-btn t-swap" data-act="swap" type="button">SİLAH ↻</button>
        <button class="t-btn t-nade" data-key="KeyG" type="button">BOMBA</button>
        <button class="t-btn t-use" data-key="KeyF" type="button">F · KULLAN</button>
        <button class="t-btn t-heal" data-key="KeyH" type="button">TEDAVİ</button>
      </div>`;
    document.body.append(root);
    this.root = root;
    this.stickEl = root.querySelector('.t-stick');
    this.knob = root.querySelector('.t-knob');

    // Düğmeler
    for (const b of root.querySelectorAll('.t-btn')) {
      b.addEventListener('touchstart', (e) => this._press(e, b), { passive: false });
      b.addEventListener('touchend', (e) => this._release(e, b), { passive: false });
      b.addEventListener('touchcancel', (e) => this._release(e, b), { passive: false });
    }
    // Boş alan: sol yarı çubuk, sağ yarı bakış
    root.addEventListener('touchstart', (e) => this._start(e), { passive: false });
    root.addEventListener('touchmove', (e) => this._move(e), { passive: false });
    root.addEventListener('touchend', (e) => this._end(e), { passive: false });
    root.addEventListener('touchcancel', (e) => this._end(e), { passive: false });
  }

  _key(code, down) {
    const k = this.input.keys;
    if (down) {
      if (!k.has(code)) { k.add(code); this.input._emit('key', code); }
    } else k.delete(code);
  }

  _press(e, b) {
    e.preventDefault();
    e.stopPropagation();
    this.hooks.onFirstTouch?.();
    b.classList.add('on');
    const act = b.dataset.act;
    if (b.dataset.key) { this._key(b.dataset.key, true); this._key(b.dataset.key, false); }
    if (b.dataset.hold) this._key(b.dataset.hold, true);
    if (act === 'fire') {
      this.input.buttons.add(0);
      // Ateş ederken aynı parmakla nişan kaydırılabilir
      const t = e.changedTouches[0];
      this.look.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (act === 'aim') {
      this.aim = !this.aim;
      if (this.aim) this.input.buttons.add(2); else this.input.buttons.delete(2);
    }
    if (act === 'crouch') {
      this.crouch = !this.crouch;
      this._key('KeyC', this.crouch);
    }
    if (act === 'swap') this.input._emit('wheel', 1);
    if (act === 'pause') this.hooks.pause?.();
    this._sync();
  }

  _release(e, b) {
    e.preventDefault();
    e.stopPropagation();
    const act = b.dataset.act;
    if (b.dataset.hold) this._key(b.dataset.hold, false);
    if (act === 'fire') {
      this.input.buttons.delete(0);
      for (const t of e.changedTouches) this.look.delete(t.identifier);
    }
    if (act !== 'aim' && act !== 'crouch') b.classList.remove('on');
  }

  /** Ekrana yeni dokunma (düğme dışı). */
  _start(e) {
    e.preventDefault();
    this.hooks.onFirstTouch?.();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && !this.stick) {
        this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.stickEl.hidden = false;
        this.stickEl.style.left = `${t.clientX}px`;
        this.stickEl.style.top = `${t.clientY}px`;
        this.knob.style.transform = 'translate(-50%, -50%)';
      } else {
        this.look.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  _move(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        let dx = t.clientX - this.stick.x0, dy = t.clientY - this.stick.y0;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const nx = dx / STICK_R, ny = dy / STICK_R;
        this._key('KeyW', ny < -0.3);
        this._key('KeyS', ny > 0.3);
        this._key('KeyA', nx < -0.3);
        this._key('KeyD', nx > 0.3);
        // Sonuna kadar ileri: koşu
        this._key('ShiftLeft', ny < -0.92 && Math.abs(nx) < 0.5);
        continue;
      }
      const p = this.look.get(t.identifier);
      if (p) {
        this.input.mouseDX += (t.clientX - p.x) * LOOK_K;
        this.input.mouseDY += (t.clientY - p.y) * LOOK_K;
        p.x = t.clientX;
        p.y = t.clientY;
      }
    }
  }

  _end(e) {
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null;
        this.stickEl.hidden = true;
        for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']) this._key(k, false);
      }
      this.look.delete(t.identifier);
    }
  }

  /** Aç/kapa düğmelerinin görünümü girdiyle uyumlu kalsın. */
  _sync() {
    this.root.querySelector('.t-aim').classList.toggle('on', this.aim);
    this.root.querySelector('.t-crouch').classList.toggle('on', this.crouch);
  }

  /** Oyun dışına çıkılınca (duraklatma, menü) bütün girdiler bırakılır. */
  reset() {
    this.stick = null;
    this.stickEl.hidden = true;
    this.look.clear();
    this.aim = false;
    this.crouch = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    for (const b of this.root.querySelectorAll('.t-btn.on')) b.classList.remove('on');
  }
}
