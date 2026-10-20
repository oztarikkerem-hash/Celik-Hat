"""Sürüm damgası: tarayıcı önbelleğinin eski kodu çalıştırmasını önler.

GitHub Pages her dosyayı `Cache-Control: max-age=600` ile gönderiyor;
tarayıcı sayfa yenilense bile modülleri 10 dakika boyunca önbellekten
alıyor, güncelleme "gelmiyor". Bu betik:

1. `src/` altındaki her dosyanın, `index.html` ve `tankgame/index.html`
   içeriğinin özetinden 10 haneli bir SÜRÜM üretir (içerik değişmezse
   sürüm de değişmez).
2. İki sayfanın import map'ine her modül için `?v=SÜRÜM` eşlemesi yazar:
   modüllerin birbirini göreli yollarla içe aktarması da böylece yeni
   adrese gider.
3. `index.html` içindeki BUILD sabitini, stil dosyasını ve `version.json`'ı
   günceller. Sayfa açılırken `version.json`'ı önbelleksiz okur; kendi
   sürümü eskiyse `?v=YENİ` ile kendini yeniden yükler.

Her commit'ten önce çalıştırılır (`.git/hooks/pre-commit` bunu yapar):

    python3 tools/stamp.py
"""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = {
    # sayfa → modül yollarının öneki ve sabit (sürümsüz) eşlemeler
    'index.html': ('./', {
        'three': './vendor/three.module.js',
        'three/addons/': './vendor/addons/',
        'rapier': './vendor/rapier3d-compat.js',
    }),
    'tankgame/index.html': ('../', {
        'three': '../vendor/three.module.js',
        'three/addons/': '../vendor/addons/',
    }),
}
STAMP = re.compile(r"(\?v=|BUILD = ')[0-9a-f]{10}")
BLOCK = re.compile(r'(<!-- SÜRÜM:BAŞ -->\n).*?(\n<!-- SÜRÜM:SON -->)', re.S)


def build_id(modules):
    h = hashlib.sha1()
    for p in sorted((ROOT / 'src').rglob('*')):
        if p.is_file():
            h.update(str(p.relative_to(ROOT)).encode())
            h.update(p.read_bytes())
    for page in PAGES:
        text = (ROOT / page).read_text(encoding='utf-8')
        h.update(STAMP.sub(r'\1', BLOCK.sub(r'\1\2', text)).encode())
    h.update('\n'.join(modules).encode())
    return h.hexdigest()[:10]


def main():
    modules = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'src').rglob('*.js'))
    v = build_id(modules)

    for page, (prefix, fixed) in PAGES.items():
        path = ROOT / page
        text = path.read_text(encoding='utf-8')
        imports = dict(fixed)
        for m in modules:
            imports[prefix + m] = f'{prefix}{m}?v={v}'
        block = ('<script type="importmap">\n'
                 + json.dumps({'imports': imports}, indent=1, ensure_ascii=False)
                 + '\n</script>')
        if not BLOCK.search(text):
            raise SystemExit(f'{page}: SÜRÜM:BAŞ / SÜRÜM:SON işaretleri yok')
        text = BLOCK.sub(lambda mt: mt.group(1) + block + mt.group(2), text)
        text = STAMP.sub(lambda mt: mt.group(1) + v, text)
        path.write_text(text, encoding='utf-8')

    (ROOT / 'version.json').write_text(json.dumps({'build': v}) + '\n', encoding='utf-8')
    print('SÜRÜM', v)


if __name__ == '__main__':
    main()
