/* Klavye, fare ve pointer-lock yönetimi. */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.buttons = new Set();
    this.locked = false;
    // Fare kilidi bazı ortamlarda (gömülü çerçeve, izin reddi) kurulamıyor.
    // O durumda oyun oynanamaz hale gelmesin diye "serbest bakış" devreye
    // girer: imleç görünür kalır, hareket ve tıklamalar yine çalışır.
    this.freeLook = false;
    this.sensitivity = 0.0022;

    this._listeners = { lock: [], unlock: [], key: [], wheel: [] };

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._emit('key', e.code);

      // Klavye düzeni farklıysa (örn. Türkçe F) e.code fiziksel konumu verir
      // ve harf tuşları kaymış olur. Eylem tuşlarında harfin kendisini de
      // bildiriyoruz ki "R" tuşu her düzende şarjör değiştirsin.
      const letter = (e.key ?? '').toLowerCase();
      if (letter.length === 1 && /[a-z0-9]/.test(letter)) {
        const asCode = /[0-9]/.test(letter) ? `Digit${letter}` : `Key${letter.toUpperCase()}`;
        if (asCode !== e.code) this._emit('key', asCode);
      }
      // Space ve oklar sayfayı kaydırmasın
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });

    addEventListener('keyup', (e) => this.keys.delete(e.code));

    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      // movementX/Y kilit olmadan da çalışır — serbest bakışta da kullanırız.
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      this.buttons.add(e.button);
      e.preventDefault();
    });

    document.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    document.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });

    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.wheelDelta += Math.sign(e.deltaY);
      this._emit('wheel', Math.sign(e.deltaY));
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('unlocked', !this.locked);
      if (this.locked) {
        this.freeLook = false;
        document.body.classList.remove('freelook');
        this._emit('lock');
      }
      else {
        this.buttons.clear();
        this.keys.clear();
        if (!this.freeLook) this._emit('unlock');
      }
    });
  }

  on(event, fn) {
    this._listeners[event]?.push(fn);
    return this;
  }

  _emit(event, arg) {
    for (const fn of this._listeners[event] ?? []) fn(arg);
  }

  /** Bakış ve ateş girdisi alınabiliyor mu (kilit ya da serbest bakış). */
  get active() { return this.locked || this.freeLook; }

  requestLock() {
    if (this.locked) return;
    let result;
    try {
      result = this.canvas.requestPointerLock();
    } catch {
      this._fallback();
      return;
    }
    // Modern tarayıcılarda söz (promise) döner; reddedilirse serbest bakış.
    if (result && typeof result.catch === 'function') {
      result.catch(() => this._fallback());
    } else {
      setTimeout(() => { if (!this.locked) this._fallback(); }, 350);
    }
  }

  _fallback() {
    if (this.locked || this.freeLook) return;
    this.freeLook = true;
    document.body.classList.add('freelook');
    this._emit('lock');
  }

  releaseLock() {
    this.freeLook = false;
    document.body.classList.remove('freelook');
    if (this.locked) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  mouse(btn) { return this.active && this.buttons.has(btn); }

  /** Bakış deltasını tüketir (her karede bir kez okunmalı). */
  consumeLook() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeWheel() {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }
}
