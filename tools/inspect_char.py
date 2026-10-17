"""İndirilen karakter .blend dosyasının iskelet/ağırlık durumunu raporlar."""
import bpy

arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"RAPOR\tarmature={len(arms)}\tmesh={len(meshes)}")

for a in arms:
    bn = [b.name for b in a.data.bones]
    print(f"ARMATURE\t{a.name}\tkemik={len(bn)}")
    print(f"KEMIKLER\t{bn[:60]}")

tri = 0
for m in meshes:
    tri += sum(max(len(p.vertices) - 2, 0) for p in m.data.polygons)
    vg = [g.name for g in m.vertex_groups]
    mods = [x.type for x in m.modifiers]
    mats = [x.name if x else 'YOK' for x in m.data.materials]
    print(f"MESH\t{m.name}\tkose={len(m.data.vertices)}\tvgrup={len(vg)}\tmod={mods}\tmalz={mats}\thide_render={m.hide_render}")
print(f"TOPLAM_UCGEN\t{tri}")

print("AKSIYON\t", [a.name for a in bpy.data.actions][:20])
for a in arms:
    print("TAM_KEMIK\t", [b.name.replace('mixamorig:', '') for b in a.data.bones])
