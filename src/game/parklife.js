/* Parklarda banka oturan düşman askerleri.

   Oyuncunun 40–150 m çevresindeki kurulu park bloklarında boş banklara
   ara sıra bir asker oturur. En çok 60 sn oturur (10–60 sn arası rastgele),
   sonra kalkar; vurulursa, alarm verilirse ya da (görev isterse) oyuncu
   yaklaşınca hemen kalkar. Kalkınca ne yapacağını görev belirler
   (`onStand`): Suikast'ta devriyeye çıkar, Tümgeneral'in kaçışında saldırır.
   Oturma pozu `Soldier.sit` (araç sürücüsüyle aynı): eller dizlerde, tüfek
   otururken görünmez.                                                    */

const MAX_SITTERS = 4;

export class ParkLife {
  /**
   * @param opts  { onSpawn(e), onStand(e), wakeR }  wakeR: oyuncu bu kadar
   *              yaklaşınca kalkar (0 = kalkmaz)
   */
  constructor(game, city, opts = {}) {
    this.game = game;
    this.city = city;
    this.opts = opts;
    this.sitters = [];
    this._at = 0;
  }

  update(now) {
    if (now < this._at || !this.city?.active) return;
    this._at = now + 1;
    const g = this.game, p = g.player.pos;
    // Ölenler, kalkanlar ve uzakta kalanlar listeden çıkar
    this.sitters = this.sitters.filter((e) => {
      if (!e.alive || !e.sitting) return false;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > 210) {
        if (e.sitting.bench) e.sitting.bench.taken = null;
        g.enemies.despawn(e);
        return false;
      }
      return true;
    });
    if (this.sitters.length >= MAX_SITTERS || Math.random() > 0.35) return;
    const free = [];
    for (const b of this.city.benches()) {
      if (b.taken) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (d > 40 && d < 150) free.push(b);
    }
    if (!free.length) return;
    const bench = free[Math.floor(Math.random() * free.length)];
    const e = g.enemies.spawnAt('runner', bench.pos.clone(), 1);
    e.facing = bench.face;
    e.sitting = {
      bench,
      until: now + 10 + Math.random() * 50,          // en çok 60 sn
      wakeR: this.opts.wakeR ?? 0,
      onStand: (x) => this.opts.onStand?.(x, bench),
    };
    bench.taken = e;
    this.opts.onSpawn?.(e);
    this.sitters.push(e);
  }

  clear() {
    const g = this.game;
    for (const e of this.sitters) {
      if (e.sitting?.bench) e.sitting.bench.taken = null;
      if (e.alive) g.enemies.despawn(e);
    }
    this.sitters = [];
  }
}

/** Bankın bulunduğu bloğun devriye halkası (kalkan asker parkın çevresinde yürür). */
export function parkLoop(city, bench) {
  const [i, j] = city.cellOf(bench.pos.x, bench.pos.z);
  return city.loop(i, j);
}

