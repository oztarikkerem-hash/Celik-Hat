/* Bölümler: zırhlı birlik seferberliği.

   Her bölümde 6 görev var. Şimdilik yalnızca 1. bölümün 1. görevi
   oynanabilir; diğerleri kilitli görünür.

   Yakıt dengesi: görev yakıtı BİLEREK yetmeyecek kadar verilir. Oyuncu
   10 düşmanı temizlemeye çalışırken deposu biter; haritadaki ikmal
   noktasına uğramak zorunda kalır. `yakit` değeri tam gazda yaklaşık
   ne kadar sürdüğünü belirler:
     Abrams: 60 / 0.52 ≈ 115 sn hareket
     Tank:   60 / 0.95 ≈  63 sn hareket
   Ağır tankı seçen oyuncu ikmale daha erken gitmek zorunda — tasarım
   gereği: güç karşılığında menzil kaybı.                               */

export const BOLUMLER = [
  {
    id: 1,
    ad: 'Çelik Kama',
    ozet: 'Zırhlı tugay doğu hattını yarıyor. Önce düşman tank '
      + 'müfrezesini temizle, sonra ikmal noktasından yakıt al.',
    gorevler: [
      {
        id: '1-1',
        ad: 'Hat Yarması',
        ozet: '10 düşman tankını imha et ve bir kez yakıt ikmali yap.',
        hedefler: [
          { tip: 'imha', sayi: 10, metin: 'Düşman tankı imha et' },
          { tip: 'ikmal', sayi: 1, metin: 'Yakıt ikmali yap' },
        ],
        dusman: 10,
        muttefik: 3,
        ikmalHedefi: 1,
        yakit: 60,                 // tam depo değil: ikmal şart
        yakitNoktalari: [[-62, -4], [58, -56]],
        kilitli: false,
      },
      { id: '1-2', ad: 'Köprü Başı', ozet: 'Yakında.', kilitli: true },
      { id: '1-3', ad: 'Demiryolu Hattı', ozet: 'Yakında.', kilitli: true },
      { id: '1-4', ad: 'Petrol Deposu', ozet: 'Yakında.', kilitli: true },
      { id: '1-5', ad: 'Gece Baskını', ozet: 'Yakında.', kilitli: true },
      { id: '1-6', ad: 'Son Hat', ozet: 'Yakında.', kilitli: true },
    ],
  },
];

export function bolumBul(id) {
  return BOLUMLER.find((b) => b.id === id) ?? null;
}

export function gorevBul(gorevId) {
  for (const b of BOLUMLER) {
    const g = b.gorevler.find((x) => x.id === gorevId);
    if (g) return { bolum: b, gorev: g };
  }
  return null;
}
