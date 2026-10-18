/* Silah tanımları.

   adsPos (nişan konumu) modelden ÖLÇÜLDÜ: gez ve arpacığın en üst noktaları
   (silah ekseninin ±1.2 cm bandında) namlunun ne kadar üstündeyse tutucu o
   kadar aşağı iner, nişan hattı ekranın tam ortasından geçer. Eski elle
   verilmiş değerler AK'de 3.2, M4'te 2.5 cm sapıyordu.
   Modeller Blender'dan GLB olarak geldi; her birinin ölçeği ve yönü farklı
   olduğu için `view` alanı modeli kameraya göre hizalamak için kullanılır.
   `view.length` metre cinsinden hedef namlu-dipçik uzunluğudur; model
   otomatik olarak bu boya ölçeklenir (weaponView.js).                     */

export const WEAPONS = [
  {
    id: 'deagle',
    // Altın kaplama Desert Eagle: pirinç gövde, krom sürgü, siyah kabza
    finish: { body: 0xb5821f, metal: 0x9e998f, grip: 0x141513, stock: 0x141513, accent: 0xdcb758 },
    name: 'Desert Eagle',
    file: 'assets/weapons/deagle.glb',
    kind: 'Tabanca',
    slot: 1,
    damage: 62,
    rpm: 220,
    auto: false,
    mag: 7,
    reserve: 56,
    reloadTime: 1.5,
    spread: 0.6,        // derece, kalçadan ateşte
    adsSpread: 0.12,
    recoil: 2.4,        // dikey tepme (derece)
    kickback: 0.055,    // modelin geri gitme mesafesi (m)
    zoom: 1.15,
    tracer: 0xffd27a,
    flash: 0.9,
    sound: { body: 190, crack: 3000, length: 0.26, punch: 0.85 },
    view: {
      length: 0.33, pos: [0.10, -0.188, -0.32], rot: [0, 3, 0], adsPos: [0, -0.1135, -0.30],
      flipForward: true, flipUp: false,
    },
    // Modelde arpacık yok: gez (sürgüde, 111 mm) var ama önünde yalnızca
    // üst ray (103 mm) uzanıyor, nişan alınca hedefe bakan bir şey
    // kalmıyordu. Ray ucuna arpacık eklenir; tepesi (113.5 mm) nişanda
    // tam merkezde, gezin hemen üstünde görünür. Gez sürgü pivotunda
    // durduğu için yalnızca model taranan ölçümlerde görünmez.
    sights: { front: [-0.215, 0.099, 0.1135] },
  },
  {
    id: 'ak47',
    // Klasik AK: mavimsi çelik gövde, ahşap kundak
    finish: { body: 0x22262a, metal: 0x6d747a, grip: 0x191a1a, stock: 0x4a2c15, accent: 0xa8762f },
    name: 'AK-47',
    file: 'assets/weapons/ak47.glb',
    kind: 'Piyade Tüfeği',
    slot: 2,
    damage: 34,
    rpm: 600,
    auto: true,
    mag: 30,
    reserve: 240,
    reloadTime: 2.3,
    spread: 1.5,
    adsSpread: 0.35,
    recoil: 1.15,
    kickback: 0.04,
    zoom: 1.25,
    tracer: 0xffc266,
    flash: 1,
    sound: { body: 150, crack: 2400, length: 0.2, punch: 0.72 },
    view: {
      length: 0.72, pos: [0.13, -0.2, 0.04], rot: [0, 3, 0], adsPos: [0, -0.092, 0.0],
      flipForward: false, flipUp: false,
    },
  },
  {
    id: 'mar556',
    // Modern tüfek: siyah polimer, tan aksan
    finish: { body: 0x1c1f22, metal: 0x5e656b, grip: 0x141516, stock: 0x2b2d2a, accent: 0x8d7c5c },
    name: 'MAR 556',
    file: 'assets/weapons/mar556.glb',
    kind: 'Piyade Tüfeği',
    slot: 3,
    damage: 27,
    rpm: 780,
    auto: true,
    mag: 30,
    reserve: 270,
    reloadTime: 2.0,
    spread: 1.1,
    adsSpread: 0.22,
    recoil: 0.8,
    kickback: 0.032,
    zoom: 1.3,
    tracer: 0xbfe3ff,
    flash: 0.85,
    sound: { body: 135, crack: 2900, length: 0.16, punch: 0.6 },
    view: {
      length: 0.74, pos: [0.13, -0.205, 0.027], rot: [0, 3, 0], adsPos: [0.006, -0.134, -0.01],
      flipForward: false, flipUp: false,
    },
  },
  {
    id: 'mg43',
    // Makineli: zeytin yeşili gövde, pirinç fişek bandı
    finish: { body: 0x2f3628, metal: 0x6a7169, grip: 0x191a16, stock: 0x3a4030, accent: 0xa87d28 },
    name: 'MG 43',
    file: 'assets/weapons/mg43.glb',
    kind: 'Makineli',
    weight: 0.12,         // makineli de ağır, ama minigun kadar değil
    slot: 4,
    damage: 31,
    rpm: 880,
    auto: true,
    mag: 100,
    reserve: 400,
    reloadTime: 4.0,
    spread: 2.4,
    adsSpread: 0.9,
    recoil: 1.0,
    kickback: 0.045,
    zoom: 1.15,
    tracer: 0xffb14d,
    flash: 1.15,
    sound: { body: 125, crack: 2200, length: 0.19, punch: 0.78 },
    view: {
      length: 0.88, pos: [0.15, -0.235, 0.05], rot: [0, 3, 0], adsPos: [0, -0.14, 0.0],
      flipForward: false, flipUp: false,
    },
  },
  {
    id: 'barrett_m82',
    // Barrett: koyu toprak rengi, mat metal
    finish: { body: 0x3b372c, metal: 0x636864, grip: 0x171816, stock: 0x463f30, accent: 0x857c5b },
    name: 'Barrett M82',
    file: 'assets/weapons/barrett_m82.glb',
    kind: 'Keskin Nişancı',
    slot: 5,
    damage: 260,
    rpm: 48,
    auto: false,
    mag: 10,
    reserve: 40,
    reloadTime: 3.4,
    spread: 2.2,
    adsSpread: 0.02,
    recoil: 5.5,
    kickback: 0.1,
    zoom: 5,
    scope: true,
    tracer: 0xfff0c2,
    flash: 1.6,
    sound: { body: 95, crack: 1800, length: 0.42, punch: 1 },
    view: {
      length: 1.05, pos: [0.13, -0.225, 0.072], rot: [0, 3, 0], adsPos: [0, -0.095, 0.03],
      flipForward: false, flipUp: false,
    },
  },
  {
    id: 'm98b',
    // M98B: kurşuni gövde, koyu yeşil kabza
    finish: { body: 0x272b2d, metal: 0x6f7678, grip: 0x1b1f18, stock: 0x2f3429, accent: 0x7e8580 },
    name: 'M98B',
    file: 'assets/weapons/m98b.glb',
    kind: 'Keskin Nişancı',
    slot: 6,
    damage: 185,
    rpm: 60,
    auto: false,
    mag: 8,
    reserve: 48,
    reloadTime: 2.9,
    spread: 1.8,
    adsSpread: 0.02,
    recoil: 4.2,
    kickback: 0.085,
    zoom: 2.4,
    // Dürbün yok: açık nişangah, nişan alırken ateş serbest
    tracer: 0xe6f2ff,
    flash: 1.3,
    sound: { body: 110, crack: 2000, length: 0.36, punch: 0.95 },
    view: {
      length: 0.98, pos: [0.13, -0.23, 0.023], rot: [0, 3, 0], adsPos: [0, -0.095, -0.02],
      flipForward: false, flipUp: false,
    },
  },
  {
    id: 'minigun',
    // Minigun: ağır çelik, pirinç fişek zinciri
    finish: { body: 0x24282b, metal: 0x7d8488, grip: 0x141618, stock: 0x24282b, accent: 0xb08a35 },
    name: 'Minigun',
    file: 'assets/weapons/minigun.glb',
    kind: 'Rotatif',
    slot: 7,
    damage: 24,
    rpm: 1500,
    auto: true,
    mag: 200,
    reserve: 600,
    reloadTime: 5.0,
    spread: 3.2,
    adsSpread: 1.8,
    recoil: 0.35,
    kickback: 0.02,
    zoom: 1,
    noAds: true,          // ağır silah: omza alınmaz, kalçadan taranır
    weight: 0.24,         // taşırken nefes yavaşça erir, koşarken hızla biter
    spinUp: 0.55,       // tam hıza çıkma süresi (s)
    spinParts: /^(Barrel_|BarrelCollar_|Rotor|CenterSpindle)/,   // dönen namlu demeti
    tracer: 0xff9a3c,
    flash: 1.4,
    sound: { body: 140, crack: 2100, length: 0.12, punch: 0.5 },
    view: {
      length: 1.02, pos: [0.2, -0.448, 0.073], rot: [0, 3, 0], adsPos: [0.2, -0.448, 0.073],
      flipForward: false, flipUp: false,
    },
  },
  {
    id: 'm4',
    // Sketchfab "free weapon" (AR-15 ailesi, dörtlü raylı). Kendi PBR
    // dokularıyla geliyor; palet uygulanmaz (finish yok).
    name: 'M4 Karabina',
    file: 'assets/weapons/m4.glb',
    kind: 'Piyade Tüfeği',
    slot: 8,
    damage: 29,
    rpm: 800,
    auto: true,
    mag: 30,
    reserve: 270,
    reloadTime: 2.1,
    spread: 1.2,
    adsSpread: 0.2,
    recoil: 0.85,
    kickback: 0.034,
    zoom: 1.3,
    tracer: 0xffd9a0,
    flash: 0.9,
    sound: { body: 140, crack: 2800, length: 0.16, punch: 0.62 },
    view: {
      length: 0.86, pos: [0.13, -0.18, 0.11], rot: [0, 3, 0], adsPos: [0, -0.087, 0.07],
      // Otomatik tespit yanılıyor: iskelet dipçik namlu ağzından ince
      // olduğu için dipçiği namlu sanıp silahı ters çeviriyordu
      flipForward: true,
    },
  },
  {
    id: 'bazuka',
    // RPG-7 tipi omuzdan atımlı roketatar. Roket namlunun ÖNÜNDE durur
    // (gerçekteki gibi); atışta görünmez olur, doldurmada yenisi takılır.
    name: 'Bazuka',
    file: 'assets/weapons/bazuka.glb',
    kind: 'Roketatar',
    slot: 9,
    damage: 280,          // patlama merkezindeki hasar (rocket.maxDamage); mermi yolu kullanılmaz
    rocket: { speed: 92, radius: 6.5, maxDamage: 280, gravity: 2.2 },
    weight: 0.1,
    rpm: 30,
    auto: false,
    mag: 1,
    reserve: 7,
    reloadTime: 3.3,
    spread: 0.5,
    adsSpread: 0.08,
    recoil: 3.2,
    kickback: 0.07,
    zoom: 2.2,
    tracer: 0xffc070,
    flash: 1.8,
    sound: { body: 70, crack: 900, length: 0.7, punch: 1 },
    // Blender'daki prosedürel malzemeler glTF'e renk olarak geçmiyor (beyaz
    // geliyor); malzeme ADINA göre boyanır: [renk, pürüzlülük, metallik]
    paint: {
      GUNMETAL: [0x1c1e20, 0.42, 0.75],
      BAKELITE: [0x4b2616, 0.5, 0.05],
      SIGHT_PAINT: [0x262a26, 0.62, 0.3],
      WOOD: [0x7c4224, 0.58, 0.02],
      COPPER: [0xa8673b, 0.34, 0.85],
      PAINT_OLIVE: [0x414a30, 0.55, 0.2],
    },
    view: {
      length: 1.6, pos: [0.21, -0.21, 0.52], rot: [0, 0, 0], adsPos: [0.038, -0.094, 0.565],
      // Otomatik tespit ters çeviriyor (nişangâh ve roket kütlesi üstte)
      flipUp: false,
    },
  },
  {
    id: 'm4a1',
    // Sketchfab "Classic M4" (Mateusz Woliński, CC BY 4.0): kırmızı noktalı
    // nişangâh, kayış. Kendi dokuları siyah; renk ayarı siyahı koyulaştırır.
    name: 'M4A1 Dürbünlü',
    file: 'assets/weapons/m4classic.glb',
    kind: 'Piyade Tüfeği',
    slot: 'B',
    damage: 31,
    rpm: 760,
    auto: true,
    mag: 30,
    reserve: 270,
    reloadTime: 2.1,
    spread: 1.05,
    adsSpread: 0.14,
    recoil: 0.8,
    kickback: 0.032,
    zoom: 1,              // dürbün görüntüsü var ama YAKINLAŞTIRMAZ
    // Nişanda dürbün görüntüsü (keskin nişancı gibi, büyütmesiz); modelin
    // nişangâh parçası o an gizlenir, görüşü kapatmasın
    optic: true,
    opticHide: /^Scope/,
    tracer: 0xffd9a0,
    flash: 0.9,
    sound: { body: 145, crack: 2850, length: 0.16, punch: 0.6 },
    // Siyah: dokunun rengi bu tonla çarpılır (kayış ve nişangâh dahil)
    // (metallik değer düşük: yüksekken gökyüzünü yansıtıp maviye çalıyordu)
    tint: { color: 0x3c3c3c, roughness: 0.62, metalness: 0.25, materials: ['material', 'scope', 'sling'] },
    view: {
      // Nişanda kırmızı nokta tüpü (namlunun ~10.5 cm üstü) göz hizasına
      // gelir; yan açı 0 — 3° iken tüp ekran merkezinin solunda kalıyordu
      length: 0.84, pos: [0.13, -0.18, 0.11], rot: [0, 0, 0], adsPos: [0, -0.105, 0.05],
    },
  },
];

// Bıçak: listenin SONUNDA (yuva sırası WEAPONS[1] = AK-47 varsayımını bozmasın).
// Yakın dövüş — mermi yok; sol tık savurur, 0 tuşuyla kuşanılır.
WEAPONS.push({
  id: 'bicak',
  name: 'Muharebe Bıçağı',
  file: 'assets/weapons/knife.glb',
  kind: 'Bıçak',
  slot: 0,
  melee: { damage: 75, range: 2.4, backstab: 3, swing: 0.42, hitAt: 0.16 },
  damage: 75,
  rpm: 110,
  auto: true,           // basılı tutunca art arda savurur
  mag: 1,
  reserve: 0,
  reloadTime: 0,
  spread: 0,
  adsSpread: 0,
  recoil: 0,
  kickback: 0,
  zoom: 1,
  noAds: true,
  tracer: 0xffffff,
  flash: 0,
  sound: { body: 0, crack: 0, length: 0, punch: 0 },
  view: {
    // Ucu ileri, keskin ağzı aşağı; sağ alt köşede. 31 cm küçük
    // görünüyordu, 42'ye büyütüldü (kabza çapası mechanics.js'te orantılı)
    length: 0.42, pos: [0.17, -0.2, -0.2], rot: [8, -6, -12],
    // Otomatik tespit sapı ileri koyuyordu (sap kalın, ağız ince)
    flipForward: true,
  },
});

export const byId = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/* Vuruş bölgesi çarpanları: ayaktan en az, gövdeden orta, kafadan en çok
   hasar. 3.5 çarpanıyla tüfekler kafadan tek atışta (AK 34 → 119), zayıf
   silahlar iki atışta 120 canlı askeri düşürür.                           */
export const HEADSHOT_MULT = 3.5;
export const BODY_MULT = 1;
export const LEG_MULT = 0.5;
