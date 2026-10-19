# Çelik Hat

**Oyna:** https://oztarikkerem-hash.github.io/Celik-Hat/
(ilk açılışta ~40 MB model iner; sonraki açılışlarda tarayıcı önbelleğinden gelir)

Tarayıcıda çalışan birinci şahıs nişancı oyunu. Three.js (görüntü) ve
cannon-es (fizik) ile yazıldı; derleme adımı yok, saf ES modülleri.

- On silah (Desert Eagle, AK-47, MAR 556, MG 43, Barrett M82, M98B,
  Minigun, M4 Karabina, Bazuka, M4A1 Dürbünlü) ve bıçak — gerçek ellerle tutuluyor, her birinin
  kendine özgü şarjör değiştirme animasyonu var.
- Sandıklardan siper hatları; düşmanlar siperde saklanıp doğrularak ateş
  ediyor, siperden sipere ilerliyor.
- Görevler (bitenler tekrar oynanabilir), müttefik askerler, mağaza (yelek,
  kask, silah, sağlık) ve **haftalık giriş ödülleri** (1.000'den 4.000'e).
- **Dört alan**: Sanayi Bölgesi, Çöl Kasabası, Orman, Karlı Dağ Üssü —
  görev seçilince hangi alanda savaşacağın sorulur.
- **Bıçak** (0 tuşu) ve asker taşıyan **zırhlı araç** (F: bin / in) —
  her görev zırhlı araçla gelişin ve inişin sinematiğiyle başlar, görev
  bitince ekip araca binip uzaklaşır (tahliye sinematiği).
- Köşeden **eğilme** (Q / E); çömelince daha az isabet alınır.
- Görev başında **dört silah seçimi**; haritada **makineli yuvası** (üç
  sandık üstünde M2 — nişancısını indirince başına sen geçersin) ve iki
  **mühimmat sandığı** (F: bütün mermiler dolar).
- **Başarımlar**: Kendi yıldızlarını parlat, İlk kan, Keskin nişancı,
  Beceriksiz… — sağ üstte bildirim ve puan ödülü.
- **Ağır yaralı**: can bitince yere düşersin; düşmanlar işini bitirmeye
  çalışır ve TEK isabet ölümcüldür — sürünerek (W A S D) siper al. Hasar
  almadan beklersen kalkarsın ama canın 25'te kalır — sargı bezi ve ilk
  yardım kitiyle (mağaza) tedavi olursun.
- **Baskın** (özel görev): dört silah arkadaşınla bir evi dört dalgaya karşı
  tut (20 · 25 · 30 · 25). Yanında seçtiğin iki silah (normal cephaneleriyle);
  pencerelerde 10.000'er mermili iki M2 Browning; düşmanların bir kısmı
  kurşun geçirmez camları kırmaya çalışır.
- **Füze Rampası** (2. özel görev): zırhlı araçla ormanın içinden 12 km;
  pusularda 1 ile kuleye geç (arkadaşın sürer), 2 ile direksiyona dön.
  Ormanda 40 + 30 düşman, sonra roketatar ve ayrıntılı bir sinematik.
- **Bölümler:** tank bölümü — T-90 ya da M1 Abrams, müttefik ve
  düşman tanklar, yakıt, benzinlik ve market.

## Çalıştırma

Oyun dosyaları doğrudan açılmaz (tarayıcı modülleri `file://` üzerinden
yüklemez); yerel bir sunucu gerekir:

```bash
python3 tools/devserver.py 8777
```

Sonra tarayıcıda `http://localhost:8777` adresini aç.

## Telefon ve tablet

Yatay tutulur (dikeyde uyarı çıkar). Sol yarı: hareket çubuğu; sağ yarı:
sürükleyerek bakış; sağ altta ATEŞ, NİŞAN, DOLDUR, ZIPLA, ÇÖMEL, BOMBA,
F · KULLAN, SİLAH ↻, TEDAVİ; üstte duraklat.

## Kontroller

| Tuş | İş |
|---|---|
| W A S D | Hareket |
| Fare | Nişan |
| Sol tık / Sağ tık | Ateş / nişan al |
| R | Şarjör değiştir |
| 1–9, fare tekerleği | Silah seç |
| 0 | Bıçak (sol tık savurur; arkadan üç kat hasar) |
| B | M4A1 dürbünlü tüfek (büyütmesiz dürbün) |
| Y | Çift Desert Eagle (mağazadan 10.000 kredi; doldururken biri yeleğe girer) |
| C / Ctrl | Çömel (siperin arkasında tamamen saklanırsın) |
| G | El bombası |
| X | Dürbün |
| Q / E | Sola / sağa eğil (köşeden çıkmadan ateş) |
| F | Etkileşim: zırhlı araca bin / in, M2'ye geç / bırak (yuvadaki nişancıyı öldürünce o M2'ye de), mühimmat sandığından mermi doldur, pencere camı |
| T | Zırhlı aracın kulesine çık / in — 1: silah arkadaşın sürsün, 2: araç dursun |
| W/S, A/D, Space | Araçta: gaz-geri, direksiyon, fren |
| H | Tedavi: önce sargı bezi, sonra ilk yardım kiti |
| M | Sesi aç / kapat |

Tank bölümünde: W/S sür, A/D dön, E (basılı) tepe makinelisi ya da
benzinlikte yakıt al / market, F benzinlikte tanktan in / tanka bin.

## Klasörler

- `src/` — oyun kodu (`core` altyapı, `game` oyun, `ui` arayüz)
- `tankgame/` — Bölümler'deki tank oyunu (tek sayfa)
- `assets/` — modeller ve dokular
- `vendor/` — Three.js ve cannon-es
- `tools/` — geliştirme sunucusu, Blender dönüştürücüleri, ayar araçları

Ayrıntılı geliştirici notları: [CLAUDE.md](CLAUDE.md).

## Model lisansları

Oyun içinde ana ekranın sağ alt köşesindeki **Lisanslar** bağlantısından da görülür.

- Asker modelleri: **SpatialNeglect** — S.W.A.T. Operator ve FSB Operator
  (Sketchfab, CC BY 4.0).
- M4A1 (Classic M4): **Mateusz Woliński** — Sketchfab, CC BY 4.0;
  dokular 2048'e küçültüldü.
- M2 Browning makineli tüfek: **Ajay Kumar** — "M2 Browning Machine Gun"
  (Sketchfab, CC BY 4.0); dokular küçültüldü, üçgen sayısı yarıya indirildi.
- Diğer silah, araç ve yapı modelleri Sketchfab ve kişisel Blender
  dosyalarından alındı; depoyu herkese açık paylaşmadan önce her birinin
  lisansının yeniden dağıtıma izin verdiğini kontrol et.
