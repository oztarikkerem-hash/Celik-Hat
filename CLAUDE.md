# Çelik Hat — proje notları

Tarayıcıda çalışan birinci şahıs nişancı oyunu. Three.js (render) + cannon-es
(fizik). Derleme adımı yok: saf ES modülleri, kütüphaneler `vendor/` içinde.

## Çalıştırma

```bash
python3 tools/devserver.py 8777      # önbelleksiz sunucu (tarayıcı eski kodu çalıştırmasın)
```
Sonra `http://localhost:8777`. Fare kilidi gerçek tarayıcıda çalışır; kilit
kurulamazsa oyun "serbest bakış" moduna düşer (gömülü önizleme panelleri için).

## Sürüm damgası (önbellek)

GitHub Pages her dosyayı 10 dk önbellekte tutturuyor; tarayıcı sayfa
yenilense bile eski modülleri çalıştırıyordu ("oyun güncellenmiyor").
`tools/stamp.py` içerik özetinden bir SÜRÜM üretir ve:

- `index.html` ile `tankgame/index.html` import map'ine (`SÜRÜM:BAŞ` /
  `SÜRÜM:SON` arası, ELLE DÜZENLEME) her `src/` modülü için `?v=SÜRÜM`
  eşlemesi yazar — göreli içe aktarmalar da yeni adrese gider;
- `index.html`'deki `BUILD` sabitini ve `hud.css?v=` damgasını,
  `version.json`'ı günceller. Sayfa `version.json`'ı önbelleksiz okur,
  kendi sürümü eskiyse bir kez `?v=YENİ` ile kendini yeniden yükler.
- Ana modül import map'ten geçmediği için `src/main.js` sabit `<script>`
  ile değil, sürüm denetiminden sonra kodla eklenir.

`.git/hooks/pre-commit` her commit'te betiği çalıştırır (kanca depoya
girmez; yeni klonda yoksa commit'ten önce `python3 tools/stamp.py`).
Yeni bir modül eklenince ya da import map'e sabit bir giriş gerekince
`stamp.py` içindeki `PAGES` güncellenir.

## Mimari

- `src/core/` — altyapı: `input` (fare kilidi + yedek), `audio`/`music`
  (tamamı sentezlenmiş, ses dosyası yok), `physics` (cannon-es sarmalayıcı).
- `src/game/` — oyun: `game` (durum makinesi), `world` (sektörlü dünya ve
  akış), `player`, `weapons`+`weaponry`, `enemies`+`enemyGear`, `grenades`,
  `effects`, `missions`, `raid` (Baskın), `align`, `finish`, `textures`.
- `src/ui/` — `hud` (DOM'a tek yazma noktası), `minimap`, `hud.css`.
- `tools/` — Blender dönüştürücü ve model doğrulama sayfaları.

### Bilinmesi gereken kurallar

- **Model hizalama** (`align.js`): her silah modeli otomatik olarak
  "-Z ileri, +Y yukarı, orijin dipçikte" sözleşmesine sokulur. Otomatik tespit
  yanılırsa `weapons.js` içindeki `view.flipForward` / `view.flipUp` ile elle
  ezilir. Ölçüler sınırlayıcı kutuyla değil **yüzdelik** sınırlarla alınır;
  ayrıca Blender'dan kalan şablon düzlemleri ve zemin levhaları ayıklanır.
- **Namlu ucu konumu holder uzayındadır** — alev/izli mermi modele değil
  `holder`'a bağlanır.
- **Dünya akışı** (`world.js`): 9×9 sektör, yalnızca görüş piramidine giren
  (+ oyuncunun çevresindeki halka) sektörler kurulur; çıkanlar geometri,
  çarpışma kutusu ve fizik gövdeleriyle sökülür. HUD'da "SEKTÖR n / 81"
  sayacı bunu canlı gösterir.
- **Çarpışma**: statik kutular sektörle gelir; devrilebilen eşyaların
  (varil/sandık) kutuları her kare tazelenir (`_refreshProps`). Oyuncu onlara
  çarpınca `pushProp`, mermi isabetinde `hitProp` fizik itmesi uygular.
- **Vuruş bölgeleri**: `weapons.js` içindeki `HEADSHOT_MULT` (3.5),
  `BODY_MULT` (1), `LEG_MULT` (0.5). Asker canı 120, oyuncu canı 100.
- **Yorgunluk**: koşu 6 sn, 1 sn sonra dolmaya başlar, 5 sn'de dolar.
  Ağır silahların `weight` alanı taşırken nefes yakar (minigun 0.24).
- Arayüz metinleri ve kod yorumları **Türkçe**.

## Varlıklar

`assets/weapons/*.glb` — kaynak `.blend` dosyaları kullanıcının diskinde
(`~/Desktop/MAR556`, `~/Downloads`, ana dizin). Yeni silah eklerken:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background <dosya>.blend \
  --python tools/export_glb.py -- assets/weapons/<ad>.glb <maks_üçgen> <subsurf>
```
Sonra `weapons.js`'e künye ekle ve `tools/viewmodel.html` ile yönünü doğrula
(namlu ekranın içine bakmalı), gerekirse flip bayraklarını ayarla.

Düşmanların taşıdığı silahlar ayrı, düşük poligonlu sürümlerdir
(`enemy_*.glb`) ve `enemyGear.js` içinde tek geometriye kaynaştırılır.

Eski `soldier.glb` ve `tex/T_*.png` SİLİNDİ (kullanıcının rigsiz
`Asker.blend`'inden üretiliyordu, artık kullanılmıyor): 108 MB → 38 MB.
`tools/export_soldier_hq.py` o modele ait, yalnızca referans için duruyor.

### Asker modelleri

| Dosya | Kim | Üçgen | Kaynak |
|---|---|---|---|
| `assets/characters/swat.glb` | müttefikler | 50.898 | S.W.A.T. Operator Remaster |
| `assets/characters/fsb.glb` | düşmanlar | 46.411 | FSB Operator |

İkisi de **SpatialNeglect** (Sketchfab, CC BY 4.0) — künye ana ekranda
(`.home-credit`), kaldırma. Kaynak `.blend`'ler `~/Downloads/` altında.
İkisi de **Mixamo iskeletli**: kemik adları `mixamorig:` öneki atılarak
oyunun beklediği sade adlara (Hips, Spine, LeftArm…) dönüşüyor.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background <karakter>.blend \
  --python tools/export_mixamo_char.py -- "$PWD/assets/characters/<ad>.glb" \
  "<haric_malzemeler>" 2048 "<doku_klasoru>"
```

`export_mixamo_char.py` neyi neden yapıyor:

- **Ağırlıklar vertex gruplarından okunur** (tahmin yok). Eski
  `export_soldier_hq.py` mesafeden hesaplıyordu; bel büzülmesi ve omuzdan
  fırlayan üçgenler oradan geliyordu — o betik yalnızca kullanıcının
  kendi rigsiz `Asker.blend`'i için duruyor.
- Karakterin elindeki silah modeli DIŞARIDA kalır: üçüncü argüman hariç
  tutulacak malzeme adları (`ksvr` / `krinkov,magazine,null.001`).
- Hiçbir yere bağlanmamış teçhizat (FSB'nin çantaları) en yakın kemiğe
  sabitlenir ve bu bağ **gerçek vertex grubu** olarak yazılır. Köşe
  aralığıyla takip etmek işe yaramıyor: Blender'ın `join`'i köşe sırasını
  korumuyor, çantanın bağlantısı bota düşüp bot havada uçuyordu.
- Parçaların **UV katmanları tek ada getirilir** (`UVMap`). Farklı adlar
  join'de ayrı katmanlara düşüyor, model düz beyaz görünüyordu. Katmanlar
  silinmez, yalnızca adlandırılır (silme sırasında referans geçersizleşiyor).
- Her şey **dünya uzayında** hesaplanır. Armatür uzayı kırılgandı: FSB'nin
  armatürü hem 0.01 ölçekli hem döndürülmüş, model yan yatıp 0.55 m çıkıyordu.
- **Animasyon klipleri** de dışa aktarılır (`ANIMASYON` satırı). Üç tuzak:
  Blender 5'te aksiyonu atamak yetmiyor, `action_slot` da bağlanmalı
  (yoksa bütün klipler tek pozu pişirir); poz her karede
  DEĞERLENDİRİLMİŞ (depsgraph) nesneden okunmalı; kök kemiğin yatay
  kayması temizlenir (karakteri oyun kodu hareket ettiriyor).
- Dokular `sips` ile 2048'e indirilip JPEG'e çevrilir (4K PNG'ler tek
  karakter için 80 MB'ı buluyordu). Saydamlık gerekenler PNG kalır.
- Açılış için sonradan `assets/characters/tex` elle küçültüldü: yalnızca
  birinci şahıs kollarının kullandığı `Body_Base_color` ve
  `Body_Normal_OpenGL` 2048'de; diğerleri 1024 (göz 256, kirpik/arma 512),
  JPEG kalitesi 82. 33.6 MB → 8.5 MB. Karakter yeniden dışa aktarılırsa
  bu küçültme tekrarlanmalı.

**Açılış**: `game.load` silahları, düşman teçhizatını ve iki asker modelini
AYNI ANDA indirir (`Promise.all`); `loadAll` da silahları paralel indirip
yuva sırasıyla işler. Açılışta inen toplam ~40 MB (eskiden ~66 MB, sırayla).

### Asker duruşu (`src/game/soldier.js`)

Animasyon tamamen yordamsal (modelde animasyon klibi yok):

- Silah ELE değil, kökün çocuğu olan bir **mesnede** bağlı; mesnet nişan
  açısıyla döner. Tüfek modelinin **orijini dipçikte** (gövde z: +0.02 …
  -0.85), bu yüzden mesnet gövdenin biraz gerisinde (z=+0.14) durur.
- Eller `gripLocal` (kabza, dipçikten 25 cm) ve `supportLocal` (el kundağı,
  50 cm) noktalarına iki kemikli IK ile uzanır. Omuz→hedef mesafeleri
  0.25 m ve 0.48 m; kol boyu 0.52 m olduğundan iki dirsek de bükülü kalır.
  Bu mesafeler kol boyunu aşarsa IK kırpar ve el silaha değmez.
- Tutuş ölçüleri SWAT rig'ine göre kalibre: omuz→kabza 0.26 m, omuz→el
  kundağı 0.40 m, kol boyu 0.448 m. Silah `HOLD_YAW` (10°) ile çapraz
  duruyor; düz tutulunca kısa kol kundağa yetişmiyor.
- **Vuruş kutuları kemiğin KENDİ dünya ölçeğine göre boyutlanır**
  (`_buildHitBoxes`), kökünkine göre değil. 0.01 ölçekli armatürden gelen
  rig'lerde (FSB) kemik düğümleri de 0.01 ölçekli oluyor; kutular 100 kat
  küçülüp mermi hiç isabet etmiyor, düşmanlar hasar almıyor görünüyordu.
  Kemiğe bağlanan her şey (kol bandı dâhil) bu tuzağa düşer.
- **Çömelme = yarım diz çökme** (kullanıcının verdiği referans fotoğrafa
  göre): ARKA bacak dizi ve baldırı yerde, ayak ucu kıvrık — taban
  geriye-aşağı bakar; ÖN bacak yalnızca taban yerde, baldır dik, diz 94°.
  Yönler açı yerine doğrudan vektörle veriliyor (`kneelL/R`, `kneelShinL/R`,
  `kneelFootL/R`): açı tabanlı `legDir` ile ön ayak diz hizasında havada
  kalıyordu. Oranlar ölçümle kuruldu — ön uyluk yatay + ön baldır dik
  kalçayı 0.53 m'ye indiriyor, arka uyluk oradan dik-geri inip dizi yere
  koyuyor.
- **Ayaklar yere basar**: bacak pozu çözüldükten sonra en alçak temas
  noktası (taban / diz / devrilmişse omuz-kalça) ölçülüp gövde ona göre
  kaydırılır. Sabit çömelme yüksekliği her rig'de tutmuyor — SWAT'ta
  askeri 46 cm yere gömüyordu.
- Mesnet güncellenirken `updateWorldMatrix(true, true)` kullanılır:
  `updateMatrixWorld` ataları tazelemediği için eller bir kare geride
  kalıyor, silahın ~10 cm gerisine uzanıyordu.
- Adım genliği yürürken 0.42, koşarken 0.62 rad. Daha büyük değerler
  askeri hamle yapıyor gibi açtırıyor.
- Ölümde gövde ayak hizasındaki eksen etrafında yana devrilir; yere
  oturtmayı yukarıdaki temas düzeltmesi yapar. Devrilme başlayınca tüfek
  `body`'ye aktarılır — eskiden mesnette kalıp havada asılı duruyordu.

### Mixamo animasyonları

Klipler `~/Desktop/riffle/*.fbx` (Mixamo, "Without Skin", 30 fps). Modele
eklemek:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background <karakter>.blend \
  --python tools/merge_anims.py -- ~/Desktop/riffle /tmp/karakter_anim.blend
# sonra /tmp/karakter_anim.blend üzerinden export_mixamo_char.py
```

`merge_anims.py` dosya adlarını oyun klip adlarına çevirir
(idle/walk/run/crouch/fire/reload/death) ve kalça konum anahtarlarını
NESNE ÖLÇEĞİ oranıyla düzeltir — Mixamo FBX'i 0.01 ölçekli gelir,
anahtarlar santimetre cinsindedir; düzeltilmezse asker 80 m uzaya uçar.

**Oyun artık yordamsal poz yerine bu klipleri oynatıyor**
(`Soldier._updateClips`): idle / walk / run / crouch / death, hız
klibin zaman ölçeğine bağlı. `crouch` klibi aslında çömelerek YÜRÜME
("Walk Crouching Forward Right"); oynatılırsa duran asker adım atıyor.
Bu yüzden `_plantedTime` klipte iki ayağın da en alçakta olduğu anı bir
kez ölçer, çömelen asker o karede dondurulur; hareket eden asker
çömelmez, ayağa kalkıp yürür. Yordamsal kod `mixer` yoksa devreye giren
yedek olarak duruyor. Klibin üstüne yalnızca nişan açısı bindiriliyor
(ağırlık gövdede; boyna büyük pay verilince asker kafasını eğiyor gibi
görünüyor).

**Nişan katmanı**: bekleme/yürüme/koşma kliplerinde tüfek göğüste, çapraz
duruyor; asker ateş ederken de öyle kalıyordu. `fire` klibinin
(`AIM_AT` = %12) üst gövde kemikleri bir kez örneklenir (`AIMPOSE`) ve
`ctx.aiming` iken (`aimW` ile yumuşak) üstüne yazılır; bacaklar alttaki
klipte kalır. Ateş klibi yan duruşlu (~60°): tüfek yönü (sağ el → sol el)
ölçülüp omurga `-yawFix` kadar döndürülür. `aiming`: müttefikte hedef
varken, düşmanda atış menzilinde ve saklanmıyorken, kule nişancısında
hedef varken, omuz üstü karakterde nişan/ateşte.

**Tüfek yönü kararlılığı** (`_fitRifleToHand`): yön sağ el → sol el, ama
(1) ters çevirme yalnızca namlu AÇIKÇA geriye bakarsa (dot < −0.35; eşik 0
iken çapraz tutuşta kare kare 180° dönüyordu), (2) eller 20 cm'den yakınsa
önceki yön kalır, (3) yumuşatma gövdeye göre ve açısal hız ~140°/sn ile
sınırlı (bekleme klibi tüfeği ani oynatıyordu). Nişan son hedef görüşünden
1.2 sn sonra biter (kalkıp inme titremesi). Müttefik hedefine bağlı kalır:
yeni aday %30 yakın değilse değiştirmez (mevzideki asker hariç).

Takım kol bandı hafif ışır (`emissiveIntensity` 0.18; 0.9 iken omuzda
fener gibi parlıyordu).

Silah **sağ ele** bağlı ama her karede **iki elin arasına** hizalanıyor
(`_fitRifleToHand`): kabza sağ avuçta, namlu ekseni sol ele bakıyor.
Yalnızca sağ ele sabitlemek sol eli boşlukta bırakıyordu. Ölünce silah
köke alınıp zemine yatırılır — elde kalırsa namlu yere giriyor, gövdeye
bağlanırsa havada asılı kalıyor (gövde grubu klip ile hareket etmiyor).

## Birinci şahıs eller ve şarjör değiştirme

Silahlar artık gerçek ELLERLE tutuluyor; konumlar buna göre (dipçik omuzda)
yeniden ayarlandı — eski "havada asılı silah" değerlerine dönme, kol yetişmez.

- `fparms.js` — SWAT modeli klonlanır, yalnızca kol üçgenleri kalır
  (ağırlığı kol/el/parmak kemiklerinde olanlar). İki kemikli IK + bilek
  burulmasının yarısı ön kola + parmak pozları (`POSES`). Modelin kolu kısa
  (0.44 m): ön kol ve el kemik konumları 1.25/1.22 ile UZATILIR (ölçek değil,
  eldiven büyümesin). Tüfekte gövde yan durur (`stance.yaw`), sol omuz öne
  gelir; yoksa sol el el kundağına yetişmiyor (`arms.side.L.err` > 0).
- `mechanics.js` — silah başına `RIGS`: hareketli parça grupları (şarjör,
  sürgü, kurma kolu, kapak, bant…), çapalar (avuç merkezi + bilek→boğum `k`
  + avuç normali `n`, tutucu uzayında) ve koreografiler (saniye cinsinden
  izler: `gun`, `L`, `R`, `mag`, parça izleri, `ev` olayları).
  - `on: 'mag'` çapaları ŞARJÖR PİVOTUNA GÖRE yazılır; diğer `on` çapaları
    (sürgü, kol, kapak) silah üzerindeki mutlak konumla.
  - Yatırma işareti: negatif `rz` = sağ yan yukarı, yuva sol ele döner.
  - Koreografi dönüşü dipçik ucunda değil şarjör yuvası etrafında uygulanır
    (`weaponry.js`, pivot telafisi); dipçik kameranın arkasında olduğundan
    küçük açılar bile namluyu gökyüzüne savuruyordu. Bazukada pivot kabza.
- Silah türleri: AR (düz şarjör + sürgü durdurucu şaplağı), AK (ön tırnaktan
  devrilerek, boşta sol el üstten aşıp sağdaki kolu çeker), tabanca (şaplakla
  oturtma, son mermide sürgü açık kilitlenir, overhand bırakma), Barrett
  (soldaki kol), M98B (her atıştan sonra sürgü döngüsü; kovan sürgü
  çekilince çıkar), MG 43 (kapak, bant, kutu, kurma), minigun (yordamsal bant
  ucu + namlu demetini elle çevirme), bazuka (roket önden sürülüp çevrilir).
- Taktik doldurmada kapalı sürgülülerde namlu içi +1 (`CLOSED_BOLT`).
- `droppedmags.js` — boş şarjörler gerçek fizik gövdesiyle yere düşer.
- Ayar aracı: konsolda `await import('/tools/fpdebug.js?'+Date.now())`,
  sonra `fp.eq(n)`, `fp.reload(0)`, `fp.freeze(t)`, `fp.side()`/`fp.fp()`.
  Önizleme paneli gizliyken kare hızı düşer; ekran görüntüleri bir kare
  geriden gelir.

## Yeni silahlar

- **M4 Karabina** (`m4.glb`): `~/Downloads/free-weapon` (tek parça FBX).
  `tools/export_fbx_weapon.py` gevşek parçalardan şarjörü ayırır, dokuları
  bağlar. Kendi PBR dokusu var (paslı gri çelik), `finish` uygulanmaz.
- **Bazuka** (`bazuka.glb`): `~/Desktop/Bazuka/Bazuka.blend`, yalnızca yazarın
  hazırladığı `EXPORT` koleksiyonu (`export_glb.py`'nin 4. argümanı; diğer
  koleksiyonlar aynı parçaların kopyası). Prosedürel malzemeler glTF'e
  beyaz geçiyor → `weapons.js` içinde `paint` ile ada göre boyanır.
  Roketler `rockets.js`: fırlatma yükü + 0.11 sn sonra uçuş motoru, doğru
  parçası çarpışması, alan hasarı (6.5 m, 280), geri tepme bulutu.
- Duman için `effects.puff` normal karışımlı ayrı bir sistem kullanır
  (toplamalı karışım gri dumanı ışık gibi parlatıyordu).

## Tank bölümü (`tankgame/index.html` — Death Star kopyası)

Bölümler bu sayfayı çerçevede açar; claude.ai'deki Death Star artifact'i
AYRI bir kopyadır, buradaki değişiklikler oraya gitmez.

- **Benzinlik** `istasyon.glb` (`~/Desktop/BenzinIstasyonu/Istasyon.blend`,
  `STATION` koleksiyonu, `export_glb.py ... 4000 0 STATION`). Konum
  `ST` (130, −120), kanopi sahaya dönük. Blender koordinatıyla çalışılır:
  `stDunya(bx,by)` / `stYerel(x,z)` (glTF'te z = −by). `H()` istasyon
  altını düzleştirir (`H0` ham arazi); karolar orada ağaç/kaya koymaz.
- **Yakıt** `YAKIT_MENZIL` 5500 m = oynanabilir çemberin (420 m) çevresinin
  iki turu. Kanopi altında E ile dolar. E başka yerde tepe makinelisi.
- **F** yalnızca benzinlikte tanktan indirir; tankın yanında F ile binilir.
  Yayayken park halindeki tank da vurulabilir (`tankYikik`).
- **Market** (kapının önü, E): el bombası ×3, AK-47, PKM, Dragunov — hepsi
  30 altın. Altın: düşman tankı +30, hedef +10, başlangıç 60.
- Ses tercihi Çelik Hat ile paylaşılır (`localStorage 'celikhat.sessiz'`).
- Tank oyunu artık yerel Three'yi (`../vendor`, r171) kullanır ve Çelik Hat
  modüllerini doğrudan içe aktarır: yayayken `Weaponry` + `FPArms` (eller,
  şarjör değiştirme). `Weaponry.basePath = '../'` (dosya yolu öneki).
  Yedek mermi sınırsız; bazuka roketi tanka 30 hasar (kullanıcı kuralı);
  tüfekler `tankHasari()` ile (keskin nişancı ×0.4, diğerleri ×0.25).
- Saha yarıçapı `SAHA_R` 800 m; yakıt `YAKIT_MENZIL` 10 km (iki tur).
- Siperler: `setKur()` toprak set + kum torbası; mermiyi `siperIcinde()` /
  `siperIsini()` tutar; birlikler `siperSec()` ile setin arkasına girer.
- Puanın %60'ı Çelik Hat mağazasına kredi olur (`krediEkle`, aynı kayıt
  `celikhat.shop.v1`). Mağaza satın almadan önce kaydı diskten tazeler.
- Mağaza "Silahlar" bölümü: `tankmg` (15.000) alınmışsa tankta E basılı +
  tetik kulenin üstündeki uzaktan kumandalı makineliyi ateşler (`rwsAtes`);
  alınmamışsa E eskisi gibi açıktaki tepe makinelisine çıkarır.

## Siper savaşı

- Her sektörde 1 sandık mevzisi (`world._buildTrenches`): düz, L, U.
  Varil/sandık/sandık yığınları `PROP_KEEP` (0.4) oranında kurulur
  (kullanıcı isteğiyle %60 azaltıldı).
  Yükseklik 1.2 m — ayakta göz 1.66 m (üstünden ateş), çömelince 1.10 m
  (tam saklanır). Duvar başına tek birleşik geometri + tek çarpışma kutusu.
- Düşmanlar siperde SAKLAN (çömelir, ateş etmez) ↔ DOĞRUL (seri atar)
  döngüsünde; bir mevzide ~7 sn kalınca hedefe yakın sipere sıçrar.
- Sipere son yaklaşmada engelden kaçınma zayıflatılır: tam kuvvetle itme
  askeri siper noktasına (duvardan 0.55 m) hiç ulaştırmıyordu.

## Alanlar (`src/game/maps.js`)

Görev seçilip "başla" denince alan sorulur (`game._askMap`, `#mapPick`);
seçim `celikhat.alan`'da kalır. Dört alan aynı sektörlü akış dünyasını
kullanır, `world.setTheme(map)` gökyüzü/sis/ışık/zemin/yol/çevre duvarını
değiştirir ve sektörleri söker (yeni arketiplerle yeniden kurulur).

| Alan | Zemin | Arketipler |
|---|---|---|
| Sanayi Bölgesi | beton, asfalt | depo, atölye, avlu, boru (+ yolda kontrol) |
| Çöl Kasabası | kum, toprak yol | kerpiç ev (+hurma), kamp (çadır, torba çemberi) |
| Orman | çimen | koru, kayalık, kulübe |
| Karlı Dağ Üssü | kar | depo, çamlık (karlı çam), avlu |

Ağaçlar sektör başına TEK geometriye kaynaşır (`trees` kapanışı); gövde
mermi durdurur ve çarpışır, taç yalnızca görünüm. Baskın arsasına değen
sektörde yalnızca "güvenli" arketip (boru/atölye/depo değil) kurulur.

## Bıçak

`assets/weapons/knife.glb` (`~/Downloads/combat-knife`, `shrink_glb.py` ile
dokular 1024). `weapons.js`'te listenin SONUNDA (`WEAPONS[1]` AK-47
varsayımı bozulmasın), yuva **0**, `melee` alanı. `weaponry.tryFire`
savurmayı başlatır, `update` `swingPose` ile tutucuyu sap çevresinde
döndürür, `hitAt`'te `onMelee` → `game._meleeAttack`: kısa ışın, tutmazsa
±35° koni; kafaya ×2, arkadan (`backstab`) ×3. Model otomatik hizalamada
ters geliyordu → `flipForward: true`. Baskın'da bıçak seçim hakkından
sayılmaz, hep yanında (`setLoadout`).

## Zırhlı araç (`src/game/vehicle.js`, model `apc.js`)

Model **kodla kurulur** (`buildAPC`): 4×4, eğimli burunlu, açık kuleli,
arka kapılı özgün bir tasarım; kamuflaj canvas'ta üretilir ve alanın
zeminine göre orman / çöl / kış paletini alır (`camoFor`). Hazır M1200
modeli (`~/Downloads/m1200-armored-knight`, ticari bir oyundan çıkarılmış
görünüyor) KULLANILMIYOR ve depoya konmuyor (`.gitignore`); "küçük
değişiklik" telif riskini kaldırmaz — yerine bu özgün model yapıldı.

- Düğüm sözleşmesi: `wheel…wheel4`, `turret` (Mesh), `weapon_muzzle`,
  `gunner_a`, `groundpoint*`, `hatch6` (arka kapı, menteşe), `exhaust`,
  `hull` (yalpalama). Ön +X, sağ +Z. Tekerlek/kule pivotları düğüm konumunda.
- F ile binilir/inilir. 30 m'deki müttefikler biner (`ally.aboard`,
  AllyManager onları atlar); ilki kulede, kule hedefe döner ve ateş eder.
- Sürüş: bisiklet modeli, hızla kısılan direksiyon, 3 çarpışma dairesi;
  eşyalar savrulur, 3.5 m/sn üstünde önüne çıkan düşman ezilir.
- Araçtayken oyuncuya gelen hasar araca gider; gövdeye saplanan düşman
  mermisi `enemies.onBlocked` ile zırhı aşındırır. 2500 zırh bitince patlar.

### Kule (T) ve silah arkadaşının sürüşü

- **T**: aracın kulesine çık / in (`vehicles.climb` / `climbDown`). Göz
  3.05 m (kalkanın üstü), kule bakışı izler, M2 ile ateş (3000 mermi,
  `fireTop`); kendi aracımız mermi hedeflerinden çıkarılır. Kuledeki
  oyuncuya gelen isabetlerin %45'ini kalkan alır.
- Çıkınca `#top-choice` sorar: **1** silah arkadaşın sürsün, **2** araç
  dursun (kulede her an değiştirilir). Sürüş `_autoDrive`: en yakın
  düşmana YOL üzerinden (x = 0 ve z = 0 yolları, kavşaktan geçiş) gider,
  ~24 m kala durur; hedef arkadaysa ileri giderek tam kırıp döner,
  sıkışırsa 1.3 sn geri manevra yapar. Fizik `_physics` (oyuncu sürüşüyle
  ortak).
- Araç camları siyah (gök yansıması maviye çalıyordu).

## Görev girişi sinematiği (`src/game/intro.js`)

Her `start()` sonunda `state = 'cinematic'`: ekip zırhlı araçla gelir.
`game._introPlan` aracın duracağı yeri, yönünü, oyuncunun iniş noktasını ve
**boşaltılacak yol şeridini** verir (`world.setClearRects`: şeritte sektör
eşyası kurulmaz, değen sektör güvenli arketip alır). Planlar: A alçak tele,
B ön çapraz takip, C vinç, D arka çapraz (kapı açılır, askerler sırayla
iner, nişancı en son), E birinci şahıs iniş. Gövde kapalı bir ağ olduğu
için askerler içeride HİÇ görünmez: açık kapının eşiğinde (gövdenin
dışında) belirip basamaktan iner — içeriden yürütülünce arka duvardan
geçiyor gibi görünüyordu. Kapı boşluğu 1.25 × 1.25 m. Baskın'da araç evin güneyinden
geçip kapı yanında durur, ekip bahçe kapısına koşar, kararıp evin içinde
açılır; araç kaldırılır. Boşluk/Enter/Esc ya da "Geç" atlar
(`intro.skip`). Bitince `_afterIntro` dalgayı başlatır. Sinematikte HUD
gizli (`body.cinematic`), elde silah gizli, fare bakışı yutulur.

## Görev sonu sinematiği — tahliye (`src/game/outro.js`)

`missionComplete()` piyadede önce `_beginOutro` çağırır, sonuç ekranı
(`_showVictory`) sinematik bitince açılır. Baskın'da son dalgadan
`FINALE_TIME` (7 sn) sonra aynı tahliye oynar, ardından `_raidVictory`
(Kahraman asker + bayrak). Oynayan sinematik `game.activeCine` (giriş ya
da tahliye); atlama tuşları ona gider.

- Araç yolu: oyuncunun çevresindeki 16 yön × 2 yan içinden ENGELİ EN AZ
  şerit (`_lane`; görev ortasında dünya yeniden kurulmaz). Araç oyuncunun
  4.2 m yanından geçip durur, arka kapısı oyuncuya yakın kalır.
- Oyuncu bu sahnede bir SWAT asker modeliyle (turuncu kol bandı) temsil
  edilir. Müttefikler (yerdekiler de) sırayla kapıya koşar, eşikte kaybolur;
  oyuncu en son biner. Kapı kapanır, araç hızlanır (3.4 m/sn²), vinç geri
  çekilir, kararma.
- Kalan düşmanlar sahneden gizlenir. Baskın'da kararmayla ekip bahçe
  kapısında belirir; ufuktaki birlik (`raid.update`) yürümeye devam eder.
  Baskın şeridi batıya da uzatıldı (araç oradan çıkar).

## Omuz üstü görüş (`src/game/thirdperson.js`)

**V**: gözden ⇄ omuz üstü (`celikhat.gorus`'ta saklanır). Kamera sağ
omzun 2.35 m arkasında, nişanda 1.25 m'ye yaklaşır; kamera–baş arasında
engel varsa öne çekilir. Karakter SWAT modeli (kol bandı yok), gövde nişan
yönünde. Atış: nişan noktası kameradan (`aimPoint`, kamera–karakter arası
atlanır), mermi karakter göğsünden oraya; roket ve bıçak da karakterden.
Araçta, kulede, M2'de, dürbünde ve keskin nişancı dürbünüyle nişanda gözden
görüşe geçilir. Birinci şahıs silah/eller gizlenir (şarjör animasyonu
karakterde yok).

## Eğilme, çömelme, etkileşim tuşları

- **Q / E**: basılı tutunca sola/sağa eğilme (`player.lean`): baş 0.48 m
  kayar, kamera ~13° yatar; `eyePosition` da kayar (düşman başa nişan alır).
  Baş engele girecekse eğilme kısılır (`_leanRoom`).
- İsabet: çömelmişken düşman isabetlerinin %20'si ıskalar; eğilmişken
  ayrıca %35 (`_onPlayerHit` başında).
- **F**: etkileşim — M2'ye geç/bırak, araca bin/in, pencere camı
  (`game._interact`, öncelik bu sırayla). Q'daki "önceki silah" kaldırıldı.
  M2'den kalkınca o pencerenin camı kapanır.

## Ağır yaralı ve tedavi## Ağır yaralı ve tedavi

- Can 0 olunca `game._goDown()`: oyuncu yere düşer (`player.downed`, göz
  0.55 m), silah inik, hareket yok. Ekranda üstte "AĞIR YARALI", ortada
  nabızlı kalp ve çember (`#downed`, `hud.setDowned`).
- Çember `REVIVE_TIME` (10 sn) hasar almadan dolar; yerdeyken her isabet
  çemberi sıfırlar, `DOWNED_HITS` (3). isabet ölümdür (gameOver). Düşman
  yerdeki oyuncuyu daha az önceler (mesafe ×2.5).
- Kalkınca `player.healthCap` = 25: yenilenme ve dalga ikmali bunu aşmaz.
  H tuşu tedavinin sıradaki adımı: önce sargı bezi (2.5 sn), sonra ilk
  yardım kiti (4 sn) → sınır kalkar, can 100. Malzemeler mağazanın
  "Sağlık" bölümünden alınır, `shop.durum.stok`'ta adetle tutulur.

## Mağaza (`src/game/shop.js`)

İki bölüm: **6 yelek**, **5 kask** (biri korumasız varsayılan bere).
Kredi puandan kazanılır (`puanEkle`, tur sonu puanın %60'ı) ve
`localStorage`'da birikir.

- Gelen hasar `SNIPER_ESIK` (22) üstündeyse **keskin nişancı**, altındaysa
  **seri atış** sayılır; yelekler bu iki türe ayrı yüzdelerle direnir.
  Kevlar seriye karşı %48 ama keskine karşı %10; plaka tam tersi.
- Koruma arttıkça `hiz` çarpanı düşer (Exo 0.80), Exo ayrıca nefesi
  %35 hızlı tüketir.
- Kask yalnızca `bolge === 'head'` hasarını azaltır. Düşman hitscan'i
  artık isabet yüksekliğine göre bölge bildiriyor (`enemies.js`), yoksa
  kask hiç devreye girmiyordu.
- Keskin Nişancı Kaskı turda bir kez ölümcül kafa isabetini karşılar
  (`_kaskKalkaniKullanildi`).

## Baskın görevi (`src/game/raid.js`)

Görev listesinin başındaki özel görev (`special: true`). Başlatınca önce
donanım ekranı açılır (`showRaidLoadout`): 9 silahtan tam 2 tanesi seçilir,
seçim `celikhat.baskin.silahlar` anahtarında hatırlanır ("Tekrar oyna"
doğrudan başlatır).

- **Ev**: `RAID.center` (-42, -42) çevresinde, dünyaya "fixture" olarak
  eklenir (`world.addFixture`) — sektör akışı onu sökmez. `world.setClearZone`
  arsayı (r = 17) boşaltır: o daireye sektör eşyası/siperi kurulmaz, değen
  sektörler `avlu` arketipine zorlanır (boru hattı çatıdan geçiyordu).
  Bölge değişince bütün sektörler sökülüp yeniden kurulur.
- **Dalgalar**: `enemies.raid = { waves, center, minR, maxR, maxAlive }`.
  Dalga boyları sabit, doğma evin 45–72 m çevresinde, aynı anda en fazla 16
  düşman (kuyruk bekler). Son düşman düşünce `onWaveClear` çağrılır.
- **Müttefikler**: 4 asker, her biri bir pencere mevziinde (`ally.post`);
  oradan ayrılmaz, yaralanınca orada toparlanır, menzil 80 m.
- **Cephane**: `weaponry.setLoadout(ids)` — yalnızca seçilen iki silah
  kuşanılır; her biri diğer görevlerdeki cephanesiyle gelir (şarjör +
  yedek, ör. MG 43: 100 + 400) ve dalga arası ikmal normal görevlerdeki
  gibi yapılır. (Kullanıcı ortak 600 mermi istemedi — geri getirme.)
- **M2 Browning** (`assets/weapons/m2.glb`, Ajay Kumar, CC BY 4.0): kaynak
  `~/Downloads/m2_browning_machine_gun.glb` (43 MB) `tools/shrink_glb.py`
  ile 2.9 MB'a indirildi (dokular 1024 JPEG, üçgen ×0.5). Model tek ağ;
  `splitM2` üçgen adalarının sınır kutusuna bakıp tüfeği sehpadan ayırır
  (mermi kutusu ve kuşak tüfekle döner). Model −X'e bakar, ayaklar y=-0.377.
  E ile geçilir; oyuncu sehpanın arkasına sabitlenir, kamera tüfeğin
  gözüne bağlanır, ±46° yan, −11°…+14° dikey tarama. 140 hasar, 550/dk.
  Makineli pencereleri 2.8 m geniş, denizlik 0.7 m (sehpa hizası); tüfek
  iç yüzden yalnızca 0.3 m içeride, namlu dışarı taşar. 1.5 m'lik normal
  pencerede görüş ±17°'ydi.
- **Görev yeleği** (`RAID.vest` 0.8): Baskın'da oyuncu ve 4 müttefik gelen
  hasarın %80'ini soğurur. Oyuncuda `shop.hasarAzalt(..., gorevYelegi)`
  mağaza yeleğinden iyiyse onun yerine geçer (kask kafada ayrıca işler);
  müttefikte `onAllyHit` hasarı 0.2 ile çarpar.
- **Kurşun geçirmez cam** (`_addGlass`): her pencerede (kapı hariç) kayar
  kanat; F ile açılır/kapanır, duvarın içine kayar (yanındaki uzun duvar
  parçasına doğru). Kapalı cam ayrı bir fixture'da (`glassFixture`) mermi
  durdurur + fizik kutusu el bombasını sektirir. Düşman ateşi
  `enemies.onBlocked`, oyuncu ateşi `_resolveShot`, patlamalar `raid.blast`
  ile hasar verir; 450 can, çatlak katmanı hasarla belirginleşir, bitince
  kırılır (kalıcı açık). Pencere başındaki asker hedefi varken camını açar,
  3 sn sessizlikte kapatır; oyuncu elle dokunduysa 10 sn karışmaz.
  M2'ye geçince o pencerenin camı açılır.
- **Müttefik ateşi**: tarama ortasında şarjör biterse tarama bırakılır.
  Eskiden `burstLeft > 0 && ammo == 0` durumunda asker sonsuza dek takılıyor,
  ilk 30 mermiden sonra hiç ateş etmiyordu (bütün görevlerde). Mevzideki
  asker yalnızca penceresinin baktığı ±75°'deki, arada duvar olmayan
  düşmanı seçer (`_pickFromPost`).
- **Saldıran yapay zekâsı** (`Enemy.update(..., raid)`): Baskın'da düşman
  hep hedefe yaklaştıran siperi seçer, her mevzide 2.5–4 sn kalır, kısa
  saklanır, 14 m'ye gelince siperi bırakıp hücum eder. Normal kural (7 sn
  bekle) Baskın'da 50 m ötede çömelip kalmalarına yol açıyordu.
- **Kapanış**: 4. dalga temizlenince 15 FSB askeri ~105 m güneydoğudan eve
  yürür; 14 sn sonra `#raidFinale`: "KAHRAMAN ASKER" (3.6 sn), ardından
  canvas'ta dalgalanan Türk bayrağı (resmî ölçülerle ay-yıldız yolu) ve
  "İkinci bölüm yakında".

- **Üst gösterge**: Baskın'da sol üstte "BASKIN" yazar, altında düşman can
  barı dolu başlar ve her ölümde azalır (`hud.setRaidMode`); bar bitince
  dalga bitmiştir.

**Dürbün (X)**: her piyade görevinde çalışır; 8× büyütme, fare hassasiyeti
de 1/8, telemetre (ışın) ve pusula yönü. Dürbündeyken ateş edilmez.

## Sırada ne var

- MAR 556 için ekranın altında yakınlaştırmayan dürbün paneli.
- `reload` klibi GLB'de var ama oynatılmıyor (`fire` nişan pozu olarak
  kullanılıyor).
- Baskın 2. bölüm ("yakında" yazıyor): ufukta görünen birlik.
- M4'te kurma kolu ve sürgü durdurucu ayrı parça değil (tek parça FBX);
  el hareketi var ama parça kımıldamıyor.
