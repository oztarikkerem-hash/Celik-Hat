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

  {
    id: 'kiyi',
    ad: 'Kıyı Limanı',
    aciklama: 'Beton rıhtımlar, sığ su yüzeyleri, yük vinçleri, konteynerler ve metal iskele ayaklarıyla ayrıntılı bir liman çatışma alanı.',
    zemin: 'kum', yol: 'asfalt', duvar: 'beton', gok: 'kiyi',
    sis: { renk: 0x91b8c6, yakin: 64, uzak: 225 },
    hemi: [0xa8d1df, 0x4b5e60, 1.42], gunes: [0xffe6c8, 3.15], dolgu: 0.86, pozlama: 1.22,
    lamba: true,
    arketipler: { liman: 0.48, depo: 0.22, avlu: 0.12, kaya: 0.18 },
    yolArketip: { liman: 0.62, kontrol: 0.38 },
    onizleme: ['#629bb5', '#c2dce1', '#8d9a94', '#596d70'],
  },
  {
    id: 'daggecidi',
    ad: 'Kayalık Dağ Geçidi',
    aciklama: 'Dar virajlar, iri kayalıklar, taş setler, gözetleme kuleleri ve çam kümeleri arasında yükselen bir cephe hattı.',
    zemin: 'tas', yol: 'toprak-tas', duvar: 'beton', gok: 'dag',
    sis: { renk: 0xa8b5c0, yakin: 48, uzak: 185 },
    hemi: [0xc2d0d9, 0x555c59, 1.38], gunes: [0xf2f3e8, 2.75], dolgu: 0.78, pozlama: 1.18,
    lamba: false,
    arketipler: { daggecidi: 0.36, kaya: 0.42, kulube: 0.12, koru: 0.1 },
    yolArketip: { daggecidi: 0.7, kontrol: 0.3 },
    onizleme: ['#71869c', '#b7c3ca', '#77776f', '#454a47'],
  },
  {
    id: 'koy',
    ad: 'Anadolu Köyü',
    aciklama: 'Kiremit çatılı evler, avlular, taş kuyular, ahşap çitler, saman balyaları ve kıvrılan toprak yollar.',
    zemin: 'cimen', yol: 'toprak', duvar: 'kerpic', gok: 'koy',
    sis: { renk: 0xc1c9b5, yakin: 58, uzak: 205 },
    hemi: [0xe0dfc8, 0x63624a, 1.42], gunes: [0xffe4b8, 3.2], dolgu: 0.82, pozlama: 1.25,
    lamba: true,
    arketipler: { koy: 0.48, kerpic: 0.22, kulube: 0.12, avlu: 0.1, koru: 0.08 },
    yolArketip: { koy: 0.66, kontrol: 0.34 },
    onizleme: ['#7e9dba', '#d5dfd2', '#77835a', '#4a5739'],
  },
  {
    id: 'bataklik',
    ad: 'Sisli Bataklık',
    aciklama: 'Sığ koyu su birikintileri, sazlıklar, devrilmiş kütükler, yosunlu taşlar ve görüşü kesen yoğun pus.',
    zemin: 'bataklik', yol: 'toprak-sazlik', duvar: 'tahta', gok: 'bataklik',
    sis: { renk: 0x788b81, yakin: 26, uzak: 118 },
    hemi: [0xb1c0b6, 0x3b493d, 1.25], gunes: [0xd9e3d5, 1.9], dolgu: 0.72, pozlama: 1.12,
    lamba: false,
    arketipler: { bataklik: 0.5, koru: 0.2, kaya: 0.12, kulube: 0.18 },
    yolArketip: { bataklik: 0.64, kulube: 0.36 },
    onizleme: ['#4f6c66', '#8da49a', '#475346', '#293a32'],
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
