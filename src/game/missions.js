/* Görevler.

   Her görev oyun içindeki olayları dinler ve ilerlemesini kendisi hesaplar.
   Tamamlanan görevler tarayıcıda saklanır; bir sonraki oturumda listede işaretli
   gelir. İlerleme her yeni oyunda sıfırlanır, tamamlanma kalıcıdır.
   Tamamlanmış görev TEKRAR oynanabilir: seçili (focus) görev tamamlanmış
   olsa da bu turda ilerlemesi sayılır; turun bitişi `runDone`'dan okunur. */

const STORE_KEY = 'celik-hat-gorevler';

const SNIPERS = new Set(['barrett_m82', 'm98b']);

export const MISSIONS = [
  {
    // Özel görev: kendi haritası (ev), sabit dalgalar ve donanım seçimi var.
    // İlerlemeyi yalnızca Baskın'ın kendi dalgaları sayar.
    id: 'baskin', name: 'Baskın', target: 4, special: true,
    desc: 'Dört silah arkadaşınla evi tut: 20, 25, 30 ve 25 kişilik dört baskın. '
      + 'Yanında seçtiğin iki silah, %80 koruyan yelekler ve pencerelerde iki M2 Browning.',
    on: (ev) => (ev.type === 'raid-wave' ? 1 : 0),
  },
  {
    id: 'ilk-kan', name: 'İlk Kan', target: 1,
    desc: 'Sahaya in ve ilk hedefi düşür.',
    on: (ev) => (ev.type === 'kill' ? 1 : 0),
  },
  {
    id: 'hat-temizligi', name: 'Hat Temizliği', target: 25,
    desc: '25 düşmanı etkisiz hale getir.',
    on: (ev) => (ev.type === 'kill' ? 1 : 0),
  },
  {
    id: 'keskin-goz', name: 'Keskin Göz', target: 10,
    desc: '10 kafa vuruşu yap — kafadan tek atış yeter.',
    on: (ev) => (ev.type === 'kill' && ev.headshot ? 1 : 0),
  },
  {
    id: 'cephanelik', name: 'Cephanelik', target: 7,
    desc: 'Yedi farklı silahla en az birer düşman düşür.',
    // Aynı silah iki kez sayılmasın diye kullanılan silahları biriktirir.
    on: (ev, state) => {
      if (ev.type !== 'kill' || ev.grenade || !ev.weaponId) return 0;
      state.used ??= new Set();
      if (state.used.has(ev.weaponId)) return 0;
      state.used.add(ev.weaponId);
      return 1;
    },
  },
  {
    id: 'bombaci', name: 'Bombacı', target: 8,
    desc: 'El bombasıyla 8 düşman öldür.',
    on: (ev) => (ev.type === 'kill' && ev.grenade ? 1 : 0),
  },
  {
    id: 'ayakta-kal', name: 'Ayakta Kal', target: 3,
    desc: 'Üçüncü dalgayı tamamla.',
    on: (ev) => (ev.type === 'wave-clear' ? 1 : 0),
  },
  {
    id: 'hasarsiz', name: 'Çiziksiz', target: 1,
    desc: 'Bir dalgayı hiç hasar almadan bitir.',
    on: (ev) => (ev.type === 'wave-clear' && ev.noDamage ? 1 : 0),
  },
  {
    id: 'nisanci', name: 'Nişancı', target: 12,
    desc: 'Keskin nişancı tüfekleriyle 12 düşman düşür.',
    on: (ev) => (ev.type === 'kill' && SNIPERS.has(ev.weaponId) ? 1 : 0),
  },
  {
    id: 'agir-darbe', name: 'Ağır Darbe', target: 5,
    desc: 'Beş "Ağır" sınıfı düşman yok et.',
    on: (ev) => (ev.type === 'kill' && ev.enemyType === 'brute' ? 1 : 0),
  },
  {
    id: 'direnis', name: 'Direniş', target: 8,
    desc: 'Sekizinci dalgaya ulaş.',
    on: (ev) => (ev.type === 'wave-clear' ? 1 : 0),
  },
];

export class MissionBook {
  constructor() {
    this.completed = new Set(this._load());
    this.progress = new Map();
    this.state = new Map();
    this.onComplete = null;        // (mission) => void
    this.resetRun();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...this.completed]));
    } catch { /* depolama kapalıysa sorun değil */ }
  }

  resetRun() {
    this.progress = new Map(MISSIONS.map((m) => [m.id, 0]));
    this.state = new Map(MISSIONS.map((m) => [m.id, {}]));
    this.runDone = new Set();        // bu turda hedefine ulaşan görevler
  }

  /** Seçili görev daha önce tamamlanmış ve yeniden oynanıyor mu. */
  isReplay(id) {
    return id === this.focusId && this.completed.has(id);
  }

  /** Oyun olaylarını görevlere dağıtır. */
  report(ev) {
    for (const m of MISSIONS) {
      if (this.runDone.has(m.id)) continue;
      if (this.completed.has(m.id) && !this.isReplay(m.id)) continue;
      const inc = m.on(ev, this.state.get(m.id)) || 0;
      if (!inc) continue;

      const next = Math.min(m.target, (this.progress.get(m.id) ?? 0) + inc);
      this.progress.set(m.id, next);

      if (next >= m.target) {
        this.runDone.add(m.id);
        if (!this.completed.has(m.id)) {
          this.completed.add(m.id);
          this._save();
        }
        this.onComplete?.(m);
      }
    }
  }

  get(m) {
    const replay = this.isReplay(m.id) && !this.runDone.has(m.id);
    return {
      done: this.completed.has(m.id),
      value: this.completed.has(m.id) && !replay ? m.target : (this.progress.get(m.id) ?? 0),
    };
  }

  /** Oyuncunun ana sayfadan seçtiği görev (HUD'da öncelikli gösterilir). */
  focus(id) {
    this.focusId = id ?? null;
  }

  /** HUD'da gösterilecek görev: seçilmiş olan, yoksa sıradaki eksik görev. */
  get active() {
    if (this.focusId) {
      const m = MISSIONS.find((x) => x.id === this.focusId);
      if (m) return m;                // tamamlanmış olsa da (tekrar oynanıyor)
    }
    return MISSIONS.find((m) => !this.completed.has(m.id)) ?? null;
  }

  get completedCount() {
    return this.completed.size;
  }

  clear() {
    this.completed.clear();
    this._save();
    this.resetRun();
  }
}
