"""Hazır bir GLB'yi oyuna uygun boyuta indirir (Blender içinde çalışır).

    Blender --background --python tools/shrink_glb.py -- \
        <girdi.glb> <çıktı.glb> <doku_px> <üçgen_oranı> [keep]

- Dokular <doku_px>'e küçültülür ve JPEG olarak gömülür (saydamlık yoksa).
- Ağ tek nesneye kaynaştırılır, <üçgen_oranı> < 1 ise Decimate uygulanır.
  5. argüman `keep` verilirse parçalar AYRI ve adlarıyla kalır (şarjör,
  kurma kolu gibi hareketli parçaları olan silahlar için).
- Sonuçta kaç üçgen kaldığı "SHRINK_OK" satırında yazılır.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, px, ratio = argv[0], argv[1], int(argv[2]), float(argv[3])
keep = len(argv) > 4 and argv[4] == 'keep'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# Dokuları küçült
for img in bpy.data.images:
    if img.size[0] > px or img.size[1] > px:
        img.scale(px, px)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if keep:
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    bpy.ops.export_scene.gltf(
        filepath=dst, export_format='GLB', export_image_format='JPEG',
        export_jpeg_quality=82, export_apply=True, export_yup=True,
    )
    print('SHRINK_OK', tris, 'keep', [o.name for o in meshes])
    raise SystemExit(0)

# Bütün ağları tek nesnede topla (dünya dönüşümleri uygulanmış halde)
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)

if ratio < 1:
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
dims = tuple(round(v, 3) for v in obj.dimensions)

bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', use_selection=False,
    export_image_format='JPEG', export_jpeg_quality=82,
    export_apply=True, export_yup=True,
)
print('SHRINK_OK', tris, dims)
