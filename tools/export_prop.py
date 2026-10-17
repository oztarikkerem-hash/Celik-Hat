"""Hazır bir GLB/FBX modeli oyun için hafifletir (ağaç, kaya, varil…).

Ormanlık alanda onlarca ağaç olacak; indirilen model 182 bin üçgen ve
15 MB. Burada inceltilir, dokusu küçültülür ve tek parça GLB yazılır.

Kullanım:
  blender --background --python tools/export_prop.py -- \\
      <girdi.glb> <cikis.glb> [maks_ucgen] [doku_boyutu]
"""
import bpy
import os
import subprocess
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    raise SystemExit("girdi ve çıkış gerekli")
GIRDI, CIKIS = argv[0], argv[1]
MAX_TRIS = int(argv[2]) if len(argv) > 2 else 3000
TEX = int(argv[3]) if len(argv) > 3 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
uzanti = os.path.splitext(GIRDI)[1].lower()
if uzanti in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=GIRDI)
elif uzanti == ".fbx":
    bpy.ops.import_scene.fbx(filepath=GIRDI)
else:
    raise SystemExit("desteklenmeyen biçim: " + uzanti)

meshler = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.polygons)]
if not meshler:
    raise SystemExit("mesh yok")

bpy.ops.object.select_all(action="DESELECT")
for o in meshler:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshler[0]
if len(meshler) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

for mod in list(obj.modifiers):
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except RuntimeError:
        obj.modifiers.remove(mod)

tri = sum(max(len(p.vertices) - 2, 0) for p in obj.data.polygons)
if tri > MAX_TRIS:
    m = obj.modifiers.new("Dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = MAX_TRIS / tri
    bpy.ops.object.modifier_apply(modifier=m.name)
print(f"INCELT\t{tri} → {sum(max(len(p.vertices)-2,0) for p in obj.data.polygons)}")

# Modeli yere otur ve ölçeğini bildir
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
mn = min((obj.matrix_world @ v.co).z for v in obj.data.vertices)
obj.data.transform(__import__("mathutils").Matrix.Translation((0, 0, -mn)))
yuk = max((obj.matrix_world @ v.co).z for v in obj.data.vertices)
print(f"BOY\t{yuk:.2f}")

# Dokuları küçült
for img in list(bpy.data.images):
    if not img.filepath_raw and not img.packed_file:
        continue
    try:
        if max(img.size) > TEX:
            img.scale(TEX, TEX)
        img.pack()
    except Exception as exc:
        print("DOKU_HATA", img.name, exc)

bpy.ops.export_scene.gltf(filepath=CIKIS, export_format="GLB",
                          export_yup=True, export_apply=True)
print(f"EXPORT_OK\t{CIKIS}\t{os.path.getsize(CIKIS)//1024}KB")
