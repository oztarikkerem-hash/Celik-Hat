"""Blender headless: bir .blend dosyasinin icerigini raporlar."""
import bpy
import sys

print("=== BLEND RAPORU BASLANGIC ===")
print("FILE:", bpy.data.filepath)

total_tris = 0
for ob in bpy.data.objects:
    line = f"OBJ\t{ob.name}\ttype={ob.type}"
    if ob.type == "MESH":
        me = ob.data
        tris = sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
        total_tris += tris
        mats = [m.name if m else "<none>" for m in me.materials] or ["<yok>"]
        dims = tuple(round(d, 3) for d in ob.dimensions)
        line += f"\tverts={len(me.vertices)}\ttris={tris}\tdims={dims}\tmats={mats}"
    print(line)

print("TOTAL_TRIS:", total_tris)
print("MATERIALS:", [m.name for m in bpy.data.materials])
print("IMAGES:", [(i.name, tuple(i.size)) for i in bpy.data.images])
print("ARMATURES:", [a.name for a in bpy.data.armatures])
print("ACTIONS:", [a.name for a in bpy.data.actions])
print("=== BLEND RAPORU SON ===")
