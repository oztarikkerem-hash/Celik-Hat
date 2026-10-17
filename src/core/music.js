/* Menü müziği — tamamen sentezlenir, ses dosyası yok.

   İki katman: yavaş bir nabız ve seyrek metalik vuruşlar. Oyun başlayınca
   kısılır, menüye dönünce geri açılır. (Eskiden alçak bir dron da vardı;
   sürekli uğultu yaptığı için kaldırıldı.)                                */

export class Music {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.nodes = null;
    this.playing = false;
    this._timer = null;
    this._step = 0;
  }

  get ctx() { return this.audio.ctx; }

  start() {
    if (!this.ctx || this.playing) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.5, now + 2.5);
    out.connect(this.audio.master);

    // Sürekli uğultu yapan dron katmanı (55–110 Hz testere dalgaları +
    // süzülen filtre) oyuncu isteğiyle kaldırıldı: "vuuu" diye bitmeyen bir
    // ses olarak duyuluyordu. Yalnızca nabız ve metalik vuruşlar kaldı.
    const oscs = [];

    this.nodes = { out, oscs };
    this.playing = true;

    // ── Nabız ve metalik vuruşlar ──────────────────────────────────────
    this._step = 0;
    this._timer = setInterval(() => this._tick(), 700);
  }

  _tick() {
    if (!this.playing || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const step = this._step++;

    // Her 2 adımda bir alçak nabız
    if (step % 2 === 0) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(34, t + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.42, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(g).connect(this.nodes.out);
      osc.start(t);
      osc.stop(t + 0.4);
    }

    // Seyrek metalik tıkırtı — sahanın demir sesi
    if (step % 8 === 3 || Math.random() < 0.18) {
      const src = ctx.createBufferSource();
      src.buffer = this.audio.noiseBuffer;
      src.playbackRate.value = 0.5 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800 + Math.random() * 2600;
      f.Q.value = 9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      src.connect(f).connect(g).connect(this.nodes.out);
      src.start(t);
      src.stop(t + 0.6);
    }
  }

  /** Oyun sırasında kısılır (0.12), menüde tam açılır (0.5). */
  setLevel(level, seconds = 1.2) {
    if (!this.nodes || !this.ctx) return;
    const g = this.nodes.out.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.exponentialRampToValueAtTime(Math.max(level, 0.0001), now + seconds);
  }

  stop() {
    if (!this.playing) return;
    clearInterval(this._timer);
    this.setLevel(0.0001, 0.8);
    const { oscs, out } = this.nodes;
    const stopAt = this.ctx.currentTime + 1;
    for (const o of oscs) o.stop(stopAt);
    setTimeout(() => out.disconnect(), 1200);
    this.playing = false;
    this.nodes = null;
  }
}
