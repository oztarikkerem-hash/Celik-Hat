"""FBX araç modelini GLB'ye çevirir (Blender içinde çalışır).

    Blender --background --python tools/export_vehicle.py -- \
        <girdi.fbx> <doku_klasörü> <çıktı.glb> [doku_px]

- FBX içindeki doku yolları çoğu zaman başka bir bilgisayarın yoludur
  (C:/...); dokular dosya adına göre (uzantı yok sayılarak) verilen
  klasörde aranır. Bulunamayanların (ör. normal haritası) düğümleri silinir:
  yoksa glTF'e boş doku yazılıyor, model düz beyaz görünüyordu.
- Nesne adları ve boş nesneler (sürücü, koltuk, namlu ucu…) korunur;
  oyun kodu bunları adlarıyla bulur.
- Dokular <doku_px>'e küçültülüp JPEG olarak gömülür.
"""
import os
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, texdir, dst = argv[0], argv[1], argv[2]
px = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

files = {}
for f in os.listdir(texdir):
    files[os.path.splitext(f)[0].lower()] = os.path.join(texdir, f)

for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type != 'TEX_IMAGE' or not node.image:
            continue
        base = os.path.splitext(os.path.basename(node.image.filepath.replace('\\', '/')))[0].lower()
        path = files.get(base)
        if path:
            node.image = bpy.data.images.load(path, check_existing=True)
        else:
            nt.nodes.remove(node)
            print('DOKU_YOK', mat.name, base)

for img in bpy.data.images:
    if img.size[0] > px or img.size[1] > px:
        img.scale(px, px)

tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_image_format='JPEG',
    export_jpeg_quality=85, export_apply=True, export_yup=True,
)
print('VEHICLE_OK', tris)
