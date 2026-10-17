"""Blender headless: sahnedeki mesh'leri web icin optimize edip GLB olarak dis
aktarir.

Onemli: karar verirken modifier SONRASI (evaluated) ucgen sayisina bakar.
Subdivision modifier'li modeller aksi halde milyonlarca ucgenle dis aktarilir.

Kullanim:
  blender --background giris.blend --python export_glb.py -- cikis.glb [max_tris]
"""
import bpy
import sys

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
out_path = argv[0]
# Tek mesh icin ust sinir; asanlar decimate ile indirilir.
max_tris_per_obj = int(argv[1]) if len(argv) > 1 else 6000
# Subdivision seviyesi ust siniri (0 = tamamen kapat).
subsurf_cap = int(argv[2]) if len(argv) > 2 else 1
# Istege bagli: yalnizca bu koleksiyondaki mesh'ler (ornek: Bazuka.blend'de
# yazarin hazirladigi EXPORT koleksiyonu; digerleri ayni parcalarin kopyasi).
only_collection = argv[3] if len(argv) > 3 else None

if only_collection:
    keep = set(bpy.data.collections[only_collection].all_objects)
    for ob in list(bpy.data.objects):
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)


def base_tris(mesh):
    return sum(max(len(p.vertices) - 2, 0) for p in mesh.polygons)


def eval_tris(ob):
    """Modifier'lar uygulandiktan sonraki ucgen sayisi."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    try:
        me = ev.to_mesh()
    except RuntimeError:
        return base_tris(ob.data)
    n = sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
    ev.to_mesh_clear()
    return n


# 1) Mesh olmayan objeleri (kamera, isik, empty) temizle - oyunda kendi
#    isiklandirmamizi ve kameramizi kullanacagiz.
for ob in list(bpy.data.objects):
    if ob.type != "MESH":
        bpy.data.objects.remove(ob, do_unlink=True)

meshes = [ob for ob in bpy.data.objects if ob.type == "MESH"]
if not meshes:
    print("HATA: sahnede mesh yok")
    sys.exit(1)

# 2) Subdivision'lari sinirla. Exporter viewport seviyesini (levels) kullanir,
#    ama ikisini de ayarlayip belirsizlik birakmiyoruz.
for ob in meshes:
    for mod in ob.modifiers:
        if mod.type == "SUBSURF":
            if subsurf_cap <= 0:
                ob.modifiers.remove(mod)
            else:
                mod.levels = min(mod.levels, subsurf_cap)
                mod.render_levels = min(mod.render_levels, subsurf_cap)

bpy.context.view_layer.update()

# 3) Modifier sonrasi hala agir olan mesh'leri decimate et.
report = []
for ob in meshes:
    tris = eval_tris(ob)
    if tris > max_tris_per_obj:
        ratio = max_tris_per_obj / float(tris)
        mod = ob.modifiers.new(name="WebDecimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        report.append((ob.name, tris, round(ratio, 4)))

bpy.context.view_layer.update()

for name, tris, ratio in report:
    print(f"DECIMATE\t{name}\t{tris} tris\tratio={ratio}")

final_total = sum(eval_tris(ob) for ob in meshes)

# 4) GLB disa aktar.
kwargs = dict(
    filepath=out_path,
    export_format="GLB",
    export_apply=True,          # modifier'lari uygula
    export_yup=True,            # glTF standardi: +Y yukari
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    use_selection=False,
)

try:
    bpy.ops.export_scene.gltf(**kwargs)
except TypeError as exc:
    print("EXPORT TypeError:", exc)
    props = bpy.types.EXPORT_SCENE_OT_gltf.bl_rna.properties.keys()
    kwargs = {k: v for k, v in kwargs.items() if k in props}
    print("Yeniden deneniyor:", sorted(kwargs))
    bpy.ops.export_scene.gltf(**kwargs)

print(f"EXPORT_OK\t{out_path}\tfinal_tris={final_total}\tmesh={len(meshes)}")
