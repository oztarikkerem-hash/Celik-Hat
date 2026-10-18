/* Tüm sesler WebAudio ile sentezlenir — harici ses dosyası yok.
   Silah sesi üç katmandan kurulur: gürültü patlaması (barut), alçak gövde
   vuruşu (basınç) ve kısa metalik tık (mekanizma).                        */

const MUTE_KEY = 'celikhat.sessiz';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.enabled = true;
    // Oyuncunun ses tercihi: oyun kapatılıp açılsa da korunur
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  /** Sesi aç/kapat. Kapalıyken ses bağlamı askıya alınır (hiç işlem yok). */
  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (!this.ctx) return;
    this.master.gain.value = muted ? 0 : 0.5;
    if (muted) this.ctx.suspend();
    else this.ctx.resume();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Tarayıcı politikası gereği ilk kullanıcı etkileşiminde çağrılmalı. */
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }

    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    if (this.muted) this.ctx.suspend();

    // Hafif bir limiter: ani üst üste binen ateşlerde kırpmayı yumuşatır.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;

    this.master.connect(comp).connect(this.ctx.destination);
    this.noiseBuffer = this._makeNoise(1.2);
  }

  resume() {
    if (this.muted) return;          // sessizdeyken tıklamalar sesi geri açmasın
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  get t() { return this.ctx.currentTime; }

  _noise({ dur = 0.2, gain = 0.5, type = 'bandpass', freq = 1200, q = 0.8, decay = 1, at = 0 }) {
    const t0 = this.t + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * decay);

    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur * decay + 0.05);
  }

  _tone({ f0 = 200, f1 = 60, dur = 0.18, gain = 0.4, type = 'sine', at = 0 }) {
    const t0 = this.t + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** profile: silahın ses karakteri (weapons.js içinde tanımlı). */
  shot(profile = {}) {
    if (!this.ctx || !this.enabled) return;
    const {
      body = 150,     // gövde vuruşunun temel frekansı
      crack = 2600,   // barut gürültüsünün tepe frekansı
      length = 0.22,  // kuyruk uzunluğu
      punch = 0.55,   // genel şiddet
    } = profile;

    this._noise({ dur: length, gain: 0.5 * punch, freq: crack, q: 0.7, type: 'bandpass' });
    this._noise({ dur: length * 2.4, gain: 0.16 * punch, freq: 420, q: 0.5, type: 'lowpass' });
    this._tone({ f0: body, f1: body * 0.35, dur: length * 0.8, gain: 0.5 * punch, type: 'triangle' });
    // Mekanizma tıkırtısı
    this._noise({ dur: 0.04, gain: 0.12 * punch, freq: 5200, q: 2, at: 0.02 });
  }

  dryFire() {
    if (!this.ctx) return;
    this._noise({ dur: 0.05, gain: 0.2, freq: 3200, q: 3 });
    this._tone({ f0: 900, f1: 300, dur: 0.05, gain: 0.08, type: 'square' });
  }

  /* Mekanik sesler: her biri gerçekteki karşılığına göre kuruldu —
     metal-metal tıkırtılar dar bantlı ve kısa, sürgü/kol sürtünmesi geniş
     bantlı ve uzun, oturtma sesi alçak bir "tok" ile tamamlanır.          */
  reload(stage) {
    if (!this.ctx) return;
    const N = (o) => this._noise(o);
    const T = (o) => this._tone(o);
    switch (stage) {
      case 'out':
      case 'magOut':                 // şarjör yuvadan sıyrılıyor
        N({ dur: 0.09, gain: 0.2, freq: 1900, q: 1.4 });
        T({ f0: 300, f1: 160, dur: 0.07, gain: 0.08, type: 'square' });
        break;
      case 'release':                // şarjör mandalı
        N({ dur: 0.03, gain: 0.2, freq: 4200, q: 4 });
        T({ f0: 1800, f1: 1100, dur: 0.025, gain: 0.05, type: 'square' });
        break;
      case 'pouch':                  // yelek cebi: kumaş + cırt
        N({ dur: 0.22, gain: 0.12, freq: 2600, q: 0.6 });
        N({ dur: 0.08, gain: 0.08, freq: 6000, q: 1.2, at: 0.12 });
        break;
      case 'cloth':
        N({ dur: 0.18, gain: 0.07, freq: 1600, q: 0.5 });
        break;
      case 'magTouch':               // şarjör yuvanın ağzına değiyor
        N({ dur: 0.05, gain: 0.12, freq: 3000, q: 2 });
        break;
      case 'in':
      case 'seat':                   // şarjör oturdu: tok vuruş + mandal
        N({ dur: 0.08, gain: 0.3, freq: 1300, q: 1.1 });
        T({ f0: 160, f1: 80, dur: 0.1, gain: 0.22, type: 'triangle' });
        N({ dur: 0.03, gain: 0.18, freq: 4600, q: 4, at: 0.035 });
        break;
      case 'tug':
        N({ dur: 0.04, gain: 0.08, freq: 2400, q: 2 });
        break;
      case 'boltRelease':            // sürgü durdurucu: sürgü öne çarpar
      case 'chargeFwd':
      case 'slideFwd':
        N({ dur: 0.1, gain: 0.34, freq: 2800, q: 1 });
        T({ f0: 420, f1: 120, dur: 0.09, gain: 0.18, type: 'square' });
        N({ dur: 0.04, gain: 0.16, freq: 6200, q: 3, at: 0.02 });
        break;
      case 'chargeBack':
      case 'slideBack':
      case 'boltBack':               // geri çekiş: sürtünme
        N({ dur: 0.14, gain: 0.2, freq: 3600, q: 0.8 });
        T({ f0: 900, f1: 500, dur: 0.12, gain: 0.04, type: 'sawtooth' });
        break;
      case 'boltUp':
      case 'boltDown':
        N({ dur: 0.05, gain: 0.16, freq: 3900, q: 2.5 });
        break;
      case 'boltFwd':
        N({ dur: 0.1, gain: 0.24, freq: 3000, q: 1 });
        T({ f0: 380, f1: 180, dur: 0.07, gain: 0.08, type: 'square' });
        break;
      case 'coverOpen':
        N({ dur: 0.08, gain: 0.18, freq: 2400, q: 1.6 });
        T({ f0: 600, f1: 300, dur: 0.07, gain: 0.07, type: 'square' });
        break;
      case 'coverClose':
        N({ dur: 0.1, gain: 0.32, freq: 1700, q: 1 });
        T({ f0: 220, f1: 90, dur: 0.1, gain: 0.2, type: 'triangle' });
        break;
      case 'beltOut':
      case 'beltIn':                 // fişek bandı: pirinç şıngırtısı
        for (let i = 0; i < 4; i++) {
          N({ dur: 0.04, gain: 0.08, freq: 5000 + Math.random() * 2500, q: 6, at: i * 0.035 });
        }
        break;
      case 'ratchet':
        for (let i = 0; i < 3; i++) N({ dur: 0.03, gain: 0.12, freq: 3300, q: 3, at: i * 0.05 });
        break;
      case 'rocketLock':
        N({ dur: 0.06, gain: 0.22, freq: 2100, q: 2 });
        T({ f0: 260, f1: 140, dur: 0.07, gain: 0.1, type: 'square' });
        break;
      case 'hammer':                 // tetik çekici kurma
        N({ dur: 0.035, gain: 0.22, freq: 4800, q: 4 });
        T({ f0: 1500, f1: 900, dur: 0.03, gain: 0.05, type: 'square' });
        break;
      default:                       // eski çağrılar ('rack')
        N({ dur: 0.12, gain: 0.26, freq: 3400, q: 1.1 });
    }
  }

  /** Boş şarjör yere düştü. */
  magDrop(heavy = false) {
    if (!this.ctx) return;
    this._noise({ dur: heavy ? 0.16 : 0.09, gain: heavy ? 0.22 : 0.14, freq: heavy ? 700 : 1700, q: 1.2 });
    this._tone({ f0: heavy ? 120 : 260, f1: heavy ? 60 : 140, dur: 0.08, gain: 0.1, type: 'triangle' });
    if (!heavy) this._noise({ dur: 0.05, gain: 0.06, freq: 3800, q: 3, at: 0.09 });
  }

  /** Roket uçuş motoru ateşlendi. */
  rocketMotor() {
    if (!this.ctx) return;
    this._noise({ dur: 0.9, gain: 0.32, freq: 700, q: 0.4, type: 'lowpass' });
    this._noise({ dur: 0.5, gain: 0.18, freq: 2600, q: 0.5 });
  }

  hit(crit = false) {
    if (!this.ctx) return;
    this._noise({ dur: 0.05, gain: crit ? 0.3 : 0.2, freq: crit ? 4200 : 2400, q: 2.4 });
    this._tone({ f0: crit ? 1400 : 900, f1: crit ? 600 : 420, dur: 0.06, gain: 0.12, type: 'square' });
  }

  enemyDeath() {
    if (!this.ctx) return;
    this._tone({ f0: 420, f1: 40, dur: 0.38, gain: 0.3, type: 'sawtooth' });
    this._noise({ dur: 0.3, gain: 0.2, freq: 900, q: 0.6, type: 'lowpass' });
  }

  playerHurt() {
    if (!this.ctx) return;
    this._tone({ f0: 110, f1: 45, dur: 0.3, gain: 0.45, type: 'sine' });
    this._noise({ dur: 0.18, gain: 0.2, freq: 320, q: 0.4, type: 'lowpass' });
  }

  impact() {
    if (!this.ctx) return;
    this._noise({ dur: 0.08, gain: 0.14, freq: 1800, q: 1.1 });
  }

  /** Bıçak savurma: havayı yaran kısa hışırtı. */
  swish() {
    if (!this.ctx) return;
    this._noise({ dur: 0.16, gain: 0.12, freq: 2400, q: 1.6 });
    this._noise({ dur: 0.1, gain: 0.06, freq: 5200, q: 2.5, at: 0.04 });
  }

  /** Bıçak isabeti: boğuk darbe. */
  stab() {
    if (!this.ctx) return;
    this._noise({ dur: 0.09, gain: 0.22, freq: 600, q: 1.2, type: 'lowpass' });
    this._tone({ f0: 140, f1: 70, dur: 0.08, gain: 0.18, type: 'triangle' });
  }

  /** Kurşun geçirmez camda isabet: kuru, tiz bir çatırtı. */
  glassHit() {
    if (!this.ctx) return;
    this._noise({ dur: 0.06, gain: 0.16, freq: 4200, q: 2.2 });
    this._tone({ f0: 3100, f1: 2300, dur: 0.07, gain: 0.04, type: 'sine' });
  }

  /** Cam kırıldı: yüksek frekanslı patlama + dökülen kırıntılar. */
  glassBreak() {
    if (!this.ctx) return;
    this._noise({ dur: 0.4, gain: 0.42, freq: 4800, q: 0.7, type: 'highpass' });
    for (let i = 0; i < 7; i++) {
      const f = 2200 + Math.random() * 3600;
      this._tone({ f0: f, f1: f * 0.8, dur: 0.1, gain: 0.05, type: 'sine', at: 0.05 + i * 0.045 });
    }
  }

  /** Cam kanadı kayarken. */
  glassSlide() {
    if (!this.ctx) return;
    this._noise({ dur: 0.35, gain: 0.06, freq: 900, q: 0.6, type: 'lowpass' });
  }

  swap() {
    if (!this.ctx) return;
    this._noise({ dur: 0.08, gain: 0.18, freq: 2600, q: 1.4 });
    this._tone({ f0: 260, f1: 140, dur: 0.09, gain: 0.1, type: 'square' });
  }

  /** Boş kovanın yere düşüşü. */
  casing() {
    if (!this.ctx) return;
    this._noise({ dur: 0.05, gain: 0.07, freq: 5200 + Math.random() * 2500, q: 7 });
    this._tone({ f0: 2400 + Math.random() * 1200, f1: 900, dur: 0.07, gain: 0.035, type: 'triangle' });
  }

  throwGrenade() {
    if (!this.ctx) return;
    this._noise({ dur: 0.1, gain: 0.16, freq: 1800, q: 1.8 });
    this._tone({ f0: 520, f1: 240, dur: 0.12, gain: 0.08, type: 'square' });
  }

  explosion() {
    if (!this.ctx) return;
    // Alçak gövde + geniş gürültü kuyruğu: patlama mesafeli hissedilsin.
    this._tone({ f0: 90, f1: 24, dur: 0.9, gain: 0.85, type: 'sine' });
    this._tone({ f0: 160, f1: 40, dur: 0.5, gain: 0.4, type: 'triangle' });
    this._noise({ dur: 0.7, gain: 0.7, freq: 900, q: 0.4, type: 'lowpass' });
    this._noise({ dur: 1.3, gain: 0.3, freq: 300, q: 0.3, type: 'lowpass', at: 0.05 });
    this._noise({ dur: 0.12, gain: 0.5, freq: 5200, q: 0.8, type: 'highpass' });
  }

  waveStart() {
    if (!this.ctx) return;
    this._tone({ f0: 180, f1: 180, dur: 0.5, gain: 0.3, type: 'sawtooth' });
    this._tone({ f0: 240, f1: 236, dur: 0.6, gain: 0.22, type: 'sawtooth', at: 0.18 });
  }

  gameOver() {
    if (!this.ctx) return;
    this._tone({ f0: 300, f1: 30, dur: 1.4, gain: 0.4, type: 'sawtooth' });
    this._noise({ dur: 1.2, gain: 0.18, freq: 400, q: 0.4, type: 'lowpass' });
  }
}
