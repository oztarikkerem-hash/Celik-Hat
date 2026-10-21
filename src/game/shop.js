/* Mağaza: koruyucu teçhizat, silahlar ve sağlık malzemeleri.

   İki bölüm var — kurşun geçirmez yelekler ve kasklar. Her parçanın bir
   bedeli, bir koruma profili ve bir hareket cezası var. Tasarım kuralı:
   koruma arttıkça hız düşer, uzmanlaşmış parçalar kendi tehdidine karşı
   çok güçlü ama geneli zayıf.

   Tehdit türleri:
     seri   — hafif, hızlı ateş eden silahlar (tek vuruşta az hasar)
     keskin — ağır, tek atışta çok hasar veren silahlar (keskin nişancı)

   Gelen hasar `damage` değerine göre sınıflanır: SNIPER_ESIK üstü tek
   vuruşlar "keskin", altı "seri" sayılır.

   Kredi: her turda kazanılan puanın bir kısmı krediye dönüşür ve
   localStorage'da birikir.                                              */

const DEPO_KEY = 'celikhat.shop.v1';
export const SNIPER_ESIK = 22;       // bu hasarın üstü "keskin nişancı" sayılır

export const YELEKLER = [
  {
    id: 'hafif', ad: 'Hafif Yelek', fiyat: 0,
    aciklama: 'Standart donanım. Hafif, hızdan çalmaz.',
    koruma: 0.10, seri: 0.10, keskin: 0.05, hiz: 1.00, agirlik: 'Hafif',
  },
  {
    id: 'taktik', ad: 'Taktik Yelek', fiyat: 900,
    aciklama: 'Dengeli plaka. Her tehdide karşı makul koruma.',
    koruma: 0.22, seri: 0.26, keskin: 0.18, hiz: 0.97, agirlik: 'Hafif',
  },
  {
    id: 'kevlar', ad: 'Kevlar Katman', fiyat: 1800,
    aciklama: 'Çok katmanlı dokuma. Seri atışları emer, ağır tek '
      + 'vuruşlarda zayıf kalır.',
    koruma: 0.18, seri: 0.48, keskin: 0.10, hiz: 0.96, agirlik: 'Orta',
    uzman: 'seri',
  },
  {
    id: 'plaka', ad: 'Keskin Nişancı Plakası', fiyat: 2400,
    aciklama: 'Sert seramik plaka. Tek ağır isabeti kırar, yaylım '
      + 'ateşinde fark etmez.',
    koruma: 0.18, seri: 0.12, keskin: 0.55, hiz: 0.94, agirlik: 'Orta',
    uzman: 'keskin',
  },
  {
    id: 'agir', ad: 'Ağır Zırh', fiyat: 3600,
    aciklama: 'Tam gövde plakası. Yüksek koruma, belirgin hız kaybı.',
    koruma: 0.40, seri: 0.42, keskin: 0.40, hiz: 0.88, agirlik: 'Ağır',
  },
  {
    id: 'exo', ad: 'Komando Exo Zırhı', fiyat: 6000,
    aciklama: 'En yüksek koruma. Ağırlığı koşuyu belirgin yavaşlatır ve '
      + 'nefesi çabuk tüketir.',
    koruma: 0.52, seri: 0.52, keskin: 0.50, hiz: 0.80, agirlik: 'Çok ağır',
    staminaCarpan: 1.35,
  },
];

export const KASKLAR = [
  {
    id: 'bere', ad: 'Taktik Bere', fiyat: 0,
    aciklama: 'Korumasız ama hiç yük bindirmez.',
    kafa: 0.00, hiz: 1.00,
  },
  {
    id: 'hafifkask', ad: 'Hafif Kask', fiyat: 800,
    aciklama: 'Kompozit kabuk. Kafa hasarını dörtte bir azaltır.',
    kafa: 0.25, hiz: 0.99,
  },
  {
    id: 'balistik', ad: 'Balistik Kask', fiyat: 2000,
    aciklama: 'Ağır kabuk ve boyun koruması. Kafa hasarını yarıya yakın '
      + 'düşürür.',
    kafa: 0.45, hiz: 0.97,
  },
  {
    id: 'siper', ad: 'Yüz Siperli Kask', fiyat: 3200,
    aciklama: 'Siper ve çene koruması. En yüksek kafa koruması, hafif '
      + 'hız kaybı.',
    kafa: 0.60, hiz: 0.93,
  },
  {
    id: 'nisanci', ad: 'Keskin Nişancı Kaskı', fiyat: 4200,
    aciklama: 'Kafaya gelen ÖLÜMCÜL ilk isabeti her turda bir kez '
      + 'karşılar — 1 canla ayakta kalırsın.',
    kafa: 0.35, hiz: 0.96, ilkIsabetiKarsila: true,
  },
];

/* Silahlar: kalıcı kilit açmalar (kuşanılmaz, bir kez alınır). Tank
   bölümü aynı kaydı okur: 'tankmg' alınmışsa tankın içinden makineli
   kullanılır. */
export const SILAHLAR = [
  {
    id: 'tankmg', ad: 'Otomatik Tank Makinelisi', fiyat: 15000,
    aciklama: 'Uzaktan kumandalı kule makinelisi. Tank bölümünde tanktan '
      + 'çıkmadan E basılı tut ve tetiğe bas: tepe makinelisi ateş eder, '
      + 'mürettebat açıkta kalmaz.',
    kullanim: 'Tankta E basılı + sol tık', atis: '700 / dk', murettebat: 'Korunur',
  },
  {
    id: 'cifttabanca', ad: 'Çift Desert Eagle', fiyat: 10000,
    aciklama: 'İki elde iki altın Desert Eagle: tetik her basışta sırayla sağdan '
      + 've soldan. Şarjör değiştirirken sol tabancayı yeleğine koyar, '
      + 'doldurunca geri çekersin. Görev başındaki silah seçiminde de çıkar.',
    satirlar: [['Kullanım', 'Y tuşu', true], ['Şarjör', '2 × 7 mermi', false], ['Atış hızı', '330 / dk, sırayla', false]],
  },
];

/* Sağlık malzemeleri: tüketilir (her alış bir adet ekler). Ağır yaralıyken
   ayağa kalkınca can 25'te kalır; önce sargı bezi, sonra ilk yardım kiti
   kullanılınca can yeniden dolar. */
export const SAGLIK = [
  {
    id: 'sargi', ad: 'Sargı Bezi', fiyat: 250, tuket: true,
    aciklama: 'Kanamayı durdurur. Ağır yaralandıktan sonra tedavinin ilk '
      + 'adımı: önce bu sarılır.',
    adim: '1. adım', sure: '2,5 sn',
  },
  {
    id: 'kit', ad: 'İlk Yardım Kiti', fiyat: 700, tuket: true,
    aciklama: 'Sargı bezinden sonra kullanılır: can sınırını kaldırır ve '
      + 'canını yeniden 100\'e çıkarır.',
    adim: '2. adım', sure: '4 sn',
  },
];

const VARSAYILAN = {
  kredi: 0,
  sahip: ['hafif', 'bere'],
  yelek: 'hafif',
  kask: 'bere',
  stok: { sargi: 0, kit: 0 },
};

export class Shop {
  constructor() {
    this.durum = { ...VARSAYILAN };
    this.yukle();
  }

  yukle() {
    try {
      const ham = localStorage.getItem(DEPO_KEY);
      if (!ham) return;
      const d = JSON.parse(ham);
      this.durum = {
        kredi: Math.max(0, Number(d.kredi) || 0),
        sahip: Array.isArray(d.sahip) ? d.sahip : [...VARSAYILAN.sahip],
        yelek: d.yelek || VARSAYILAN.yelek,
        kask: d.kask || VARSAYILAN.kask,
        stok: {
          sargi: Math.max(0, Number(d.stok?.sargi) || 0),
          kit: Math.max(0, Number(d.stok?.kit) || 0),
        },
      };
      for (const id of VARSAYILAN.sahip) {
        if (!this.durum.sahip.includes(id)) this.durum.sahip.push(id);
      }
    } catch {
      this.durum = { ...VARSAYILAN, sahip: [...VARSAYILAN.sahip], stok: { ...VARSAYILAN.stok } };
    }
  }

  kaydet() {
    try {
      localStorage.setItem(DEPO_KEY, JSON.stringify(this.durum));
    } catch { /* gizli sekmede yazamayabiliriz */ }
  }

  get kredi() { return this.durum.kredi; }

  /** Tur sonunda puanın bir kısmı krediye dönüşür. */
  puanEkle(puan) {
    const kazanc = Math.max(0, Math.round(puan * 0.6));
    if (!kazanc) return 0;
    this.durum.kredi += kazanc;
    this.kaydet();
    return kazanc;
  }

  /** Görev içi alışveriş (silah dükkânı): krediden düşer. */
  harca(miktar) {
    this.yukle();
    if (this.durum.kredi < miktar) return false;
    this.durum.kredi -= miktar;
    this.kaydet();
    return true;
  }

  sahipMi(id) { return this.durum.sahip.includes(id); }

  urun(id) {
    return YELEKLER.find((u) => u.id === id) ?? KASKLAR.find((u) => u.id === id)
      ?? SILAHLAR.find((u) => u.id === id) ?? SAGLIK.find((u) => u.id === id) ?? null;
  }

  /** Tüketilen malzemeden elde kaç tane var. */
  adet(id) { return this.durum.stok?.[id] ?? 0; }

  /** Bir adet kullanır; elde yoksa false. */
  kullan(id) {
    this.yukle();
    if (this.adet(id) <= 0) return false;
    this.durum.stok[id]--;
    this.kaydet();
    return true;
  }

  satinAl(id) {
    // Tank bölümü de krediyi aynı kayda yazıyor: önce diskten tazele,
    // yoksa bellekteki eski bakiye onun kazandırdıklarının üzerine yazar
    this.yukle();
    const u = this.urun(id);
    if (u?.tuket) {
      if (this.durum.kredi < u.fiyat) return { ok: false, sebep: 'kredi' };
      this.durum.kredi -= u.fiyat;
      this.durum.stok[id] = this.adet(id) + 1;
      this.kaydet();
      return { ok: true };
    }
    if (!u || this.sahipMi(id)) return { ok: false, sebep: 'zaten' };
    if (this.durum.kredi < u.fiyat) return { ok: false, sebep: 'kredi' };
    this.durum.kredi -= u.fiyat;
    this.durum.sahip.push(id);
    if (!this.kus(id)) this.kaydet();     // silahlar kuşanılmaz, yine de kaydet
    return { ok: true };
  }

  /** Sahip olunan parçayı kuşanır. */
  kus(id) {
    if (!this.sahipMi(id)) return false;
    if (YELEKLER.some((u) => u.id === id)) this.durum.yelek = id;
    else if (KASKLAR.some((u) => u.id === id)) this.durum.kask = id;
    else return false;
    this.kaydet();
    return true;
  }

  get yelek() { return this.urun(this.durum.yelek) ?? YELEKLER[0]; }
  get kask() { return this.urun(this.durum.kask) ?? KASKLAR[0]; }

  /** Oyuna verilecek toplam etki. */
  etkiler() {
    const y = this.yelek, k = this.kask;
    return {
      hiz: y.hiz * k.hiz,
      staminaCarpan: y.staminaCarpan ?? 1,
      govde: { seri: y.seri, keskin: y.keskin, genel: y.koruma },
      kafa: k.kafa,
      ilkIsabetiKarsila: !!k.ilkIsabetiKarsila,
    };
  }

  /**
   * Gelen hasarı teçhizata göre azaltır.
   * @param miktar  ham hasar
   * @param bolge   'head' | 'body' | 'leg'
   */
  /** gorevYelegi: görevin verdiği yeleğin soğurma oranı (0–1); mağaza
      yeleğinden iyiyse onun yerine geçer (Baskın: 0.8). */
  hasarAzalt(miktar, bolge = 'body', gorevYelegi = 0) {
    const e = this.etkiler();
    const tur = miktar >= SNIPER_ESIK ? 'keskin' : 'seri';
    let kalan = miktar * (1 - Math.max(e.govde[tur], gorevYelegi));
    if (bolge === 'head') kalan *= (1 - e.kafa);
    return Math.max(1, kalan);
  }
}
