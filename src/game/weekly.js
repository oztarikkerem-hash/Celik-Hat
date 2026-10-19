/* Haftalık ödüller: her takvim günü bir ödül alınabilir. 1. gün 1.000,
   her gün 500 artarak 7. gün 4.000 puan; 7. günden sonra takvim baştan
   başlar. Puan mağaza kredisine eklenir. Gün kaçırmak cezalandırılmaz:
   sıradaki gün bir sonraki girişte açılır.                              */

const KEY = 'celikhat.haftalik';

export const ODULLER = [1000, 1500, 2000, 2500, 3000, 3500, 4000];

/** Yerel takvim günü (YYYY-AA-GG). */
function bugun() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Weekly {
  /** @param shop Shop — ödül kredisi buraya yazılır */
  constructor(shop) {
    this.shop = shop;
    this.durum = { alinan: 0, son: null };   // bu döngüde alınan gün sayısı
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (d) this.durum = { alinan: Math.min(7, Math.max(0, d.alinan | 0)), son: d.son ?? null };
    } catch { /* bozuk kayıt: baştan */ }
  }

  _kaydet() {
    try { localStorage.setItem(KEY, JSON.stringify(this.durum)); } catch { /* gizli sekme */ }
  }

  /** Bugün alınabilir mi. */
  get alinabilir() { return this.durum.son !== bugun(); }

  /** Sıradaki (alınacak) günün sırası, 0–6. Döngü bitince 0. */
  get sira() { return this.durum.alinan >= 7 ? 0 : this.durum.alinan; }

  /** Takvim görünümü: her gün için { gun, odul, durum: 'done'|'today'|'next'|'locked' }. */
  gunler() {
    const yeniDongu = this.durum.alinan >= 7 && this.alinabilir;
    const alinan = yeniDongu ? 0 : this.durum.alinan;
    return ODULLER.map((odul, i) => {
      let durum = 'locked';
      if (i < alinan) durum = 'done';
      else if (i === alinan) durum = this.alinabilir ? 'today' : 'next';
      return { gun: i + 1, odul, durum };
    });
  }

  /** Bugünün ödülünü verir; verilen puan (alınamazsa 0). */
  al() {
    if (!this.alinabilir) return 0;
    const i = this.sira;
    const odul = ODULLER[i];
    this.shop.yukle();
    this.shop.durum.kredi += odul;
    this.shop.kaydet();
    this.durum = { alinan: i + 1, son: bugun() };
    this._kaydet();
    return odul;
  }
}
