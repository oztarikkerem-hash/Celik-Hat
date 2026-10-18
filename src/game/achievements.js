/* Başarımlar: her biri bir kez kazanılır ve tarayıcıda saklanır
   (`celikhat.basarimlar`). Kazanılınca ekranın sağ üstünde başarımın adı ve
   altında ödülü görünür; ödül puanı o anki tura eklenir.                 */

const KEY = 'celikhat.basarimlar';

export const BASARIMLAR = {
  yildiz: { ad: 'Kendi yıldızlarını parlat', aciklama: 'Gökyüzüne ateş et', odul: 200 },
  ilkkan: { ad: 'İlk kan', aciklama: 'İlk düşmanını öldür', odul: 200 },
  sarjor: {
    ad: 'Şarjör değiştirmeyi öğrenmişsin, şimdi de düzgün savaşmayı öğren',
    aciklama: 'İlk şarjör değişimi', odul: 200,
  },
  beceriksiz: { ad: 'Beceriksiz', aciklama: 'Koca bir şarjörü tek isabet almadan boşalt', odul: 0 },
  keskin: { ad: 'Nişan almayı biliyorsun hey keskin nişancı', aciklama: 'İlk kafa vuruşu', odul: 200 },
};

export class Achievements {
  /** @param onAward (id, tanım) => void — puan ve bildirim burada verilir */
  constructor(onAward) {
    this.onAward = onAward;
    this.kazanilan = new Set();
    try {
      for (const id of JSON.parse(localStorage.getItem(KEY) ?? '[]')) this.kazanilan.add(id);
    } catch { /* bozuk kayıt ya da gizli sekme: boş başla */ }
  }

  has(id) { return this.kazanilan.has(id); }

  /** Kazanılmamışsa verir; verildiyse true. */
  award(id) {
    const def = BASARIMLAR[id];
    if (!def || this.kazanilan.has(id)) return false;
    this.kazanilan.add(id);
    try { localStorage.setItem(KEY, JSON.stringify([...this.kazanilan])); } catch { /* yok say */ }
    this.onAward?.(id, def);
    return true;
  }
}
