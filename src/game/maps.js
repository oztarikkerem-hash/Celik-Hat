/* Alanlar (haritalar).

   Bütün alanlar aynı 9×9 sektörlü akış dünyasını kullanır; değişen zemin,
   gökyüzü, sis, ışık ve sektörlerde kurulan yapı türleridir (arketip).
   Görev seçildikten sonra oyuncuya hangi alanda savaşmak istediği sorulur
   (`game._askMap`). Arketipler `world._buildSector` içinde kurulur.

   arketipler: yol kenarı DIŞINDAKİ sektörlerde kurulacak yapı türlerinin
   ağırlıklı listesi; yol üstü sektörler `yolArketip` listesinden seçer. */

export const MAPS = [
  {
    id: 'sanayi',
    ad: 'Sanayi Bölgesi',
    aciklama: 'Konteyner sıraları, depolar, boru hatları ve kum torbalı kontrol noktaları. Dar sokaklar, bol siper.',
    zemin: 'beton', yol: 'asfalt', duvar: 'beton', gok: 'gunduz',
    sis: { renk: 0xaccbe4, yakin: 60, uzak: 210 },
    hemi: [0x9ec4ea, 0x6b6a4e, 1.5], gunes: [0xfff2d6, 3.4], dolgu: 0.85, pozlama: 1.3,
    lamba: true,
    arketipler: { depo: 0.3, atolye: 0.25, avlu: 0.23, boru: 0.22 },
    yolArketip: { avlu: 0.5, kontrol: 0.5 },
    onizleme: ['#5ea0e0', '#cfe4f4', '#4a5047', '#3d443b'],
  },
  {
    id: 'col',
    ad: 'Çöl Kasabası',
    aciklama: 'Kerpiç evler, hurma ağaçları ve kum torbalı askeri kamplar. Açık, sıcak ve uzun görüşlü.',
    zemin: 'kum', yol: 'toprak', duvar: 'kerpic', gok: 'col',
    sis: { renk: 0xe2d2ae, yakin: 70, uzak: 230 },
    hemi: [0xf0dcb8, 0x8a7350, 1.55], gunes: [0xffe2b0, 3.9], dolgu: 0.7, pozlama: 1.22,
    lamba: false,
    arketipler: { kerpic: 0.45, kamp: 0.3, avlu: 0.25 },
    yolArketip: { kamp: 0.5, kerpic: 0.5 },
    onizleme: ['#9fbfd6', '#efdcb4', '#b99a68', '#a5845c'],
  },
  {
    id: 'orman',
    ad: 'Orman',
    aciklama: 'Sık ağaçlar, kayalar ve kesilmiş kütükler arasında yakın çatışma. Görüş kısa, sis yoğun.',
    zemin: 'cimen', yol: 'toprak', duvar: 'tahta', gok: 'orman',
    sis: { renk: 0xa7b2a6, yakin: 35, uzak: 150 },
    hemi: [0xb8c6c8, 0x4c5a34, 1.35], gunes: [0xf2ecd6, 2.6], dolgu: 0.8, pozlama: 1.3,
    lamba: false,
    arketipler: { koru: 0.55, kaya: 0.25, kulube: 0.2 },
    yolArketip: { koru: 0.4, kaya: 0.6 },
    onizleme: ['#8e9ea8', '#c2c9c0', '#4c5e32', '#3a4825'],
  },
  {
    id: 'kar',
    ad: 'Karlı Dağ Üssü',
    aciklama: 'Karla kaplı bir dağ üssü: konteynerler, kontrol noktaları ve çam ormanı. Soğuk, bembeyaz bir ufuk.',
    zemin: 'kar', yol: 'toprak-kar', duvar: 'beton', gok: 'kar',
    sis: { renk: 0xdfe6ec, yakin: 45, uzak: 175 },
    hemi: [0xdde6f0, 0x8f9aa8, 1.6], gunes: [0xf4f6ff, 2.9], dolgu: 0.9, pozlama: 1.12,
    lamba: true,
    arketipler: { depo: 0.3, camlik: 0.4, avlu: 0.3 },
    yolArketip: { kontrol: 0.6, avlu: 0.4 },
    onizleme: ['#b8c6d4', '#e7edf2', '#dfe6ec', '#c8d2dc'],
  },
];

export const mapById = (id) => MAPS.find((m) => m.id === id) ?? MAPS[0];

/** Ağırlıklı seçim: rand() → 0..1 */
export function weightedPick(table, r) {
  let sum = 0;
  for (const w of Object.values(table)) sum += w;
  let x = r * sum;
  for (const [k, w] of Object.entries(table)) {
    x -= w;
    if (x <= 0) return k;
  }
  return Object.keys(table)[0];
}
