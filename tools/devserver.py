"""Geliştirme sunucusu: statik dosyaları önbelleksiz servis eder.

Tarayıcılar ES modüllerini agresif önbelleğe alıyor; kod değişince sayfa eski
sürümü çalıştırıyordu. Bu sunucu her yanıta `Cache-Control: no-store` ekler.

Kullanım:  python3 tools/devserver.py [port] [kök_dizin]
"""
import sys
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 404'ler dışındaki gürültüyü kıs
        msg = fmt % args
        if " 404 " in msg or "error" in msg.lower():
            sys.stderr.write(f"{msg}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = partial(NoCacheHandler, directory=root)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Çelik Hat geliştirme sunucusu: http://localhost:{port}  (kök: {root})")
    server.serve_forever()


if __name__ == "__main__":
    main()
