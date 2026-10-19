"""MLRS roketatar kamyonunu oyuna aktarır (Blender içinde, arka planda).

    Blender --background <Roketatar.blend> --python tools/export_mlrs.py -- \
        <arac.glb> <fuze.glb>

- 1. kare kullanılır: rampa 33° kalkık, füze tüpte (ateşe hazır).
- Environment (zemin, kayalar), kameralar, ışıklar ve LaunchFX (duman,
  alev, kapak kırıntıları) dışarıda kalır — bu efektleri oyun kendisi çizer.
- Araç TEK nesnede birleştirilir (630 parça ayrı kalınca 630 çizim çağrısı
  oluyordu); yalnızca ateşlenecek tüpün ön/arka kapakları ayrı kalır
  (`CapFront` / `CapBack`), oyun onları fırlatır.
- "Camo" malzemesi prosedürel (glTF'e beyaz geçerdi): yüzlerine dünya
  uzayında kutu izdüşümü UV verilir; oyun kendi kamuflaj dokusunu basar.
- Füze ayrı dosyaya, tüpteki dünya konumuyla aktarılır (oyun onu ekseni
  boyunca uçurur). Tüp ekseni ve füzenin dinlenme noktası "MLRS_OK"
  satırında yazılır.
"""
import sys
import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out_vehicle, out_rocket = argv[0], argv[1]

sc = bpy.context.scene
sc.frame_set(1)
dg = bpy.context.evaluated_depsgraph_get()

FIRE_CAPS = {'Pod0_CapAnimF_11': 'CapFront', 'Pod0_CapAnimB_11': 'CapBack'}
ROCKET_PARTS = ('Rocket_Body', 'Rocket_Nose', 'Rocket_Nozzle', 'Rocket_Fin_', 'Rocket_Canard_')

veh_cols = ['Body', 'Cab', 'Chassis', 'Launcher', 'Wheels']
vehicle = set()
for c in veh_cols:
    for o in bpy.data.collections[c].all_objects:
        if o.type in ('MESH', 'CURVE'):
            vehicle.add(o)
rocket = [o for o in bpy.data.collections['LaunchFX'].all_objects
          if o.type == 'MESH' and o.name.startswith(ROCKET_PARTS)]
caps = [bpy.data.objects[n] for n in FIRE_CAPS if n in bpy.data.objects]

tube = bpy.data.objects['FX_TubeAxis'].matrix_world
axis = (tube.to_3x3() @ Vector((1, 0, 0))).normalized()
rest = bpy.data.objects['Rocket'].matrix_world.translation.copy()


def baked_copy(o, name):
    """Değerlendirilmiş (animasyon + değiştiriciler uygulanmış) dünya uzayı kopya."""
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(o.matrix_world)
    ob = bpy.data.objects.new(name, me)
    return ob


def build(objs, name, camo_uv=False):
    bm = bmesh.new()
    mats = []
    for o in objs:
        tmp = baked_copy(o, '_tmp')
        me = tmp.data
        # Malzeme dizinlerini birleşik listeye çevir
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for p in me.polygons:
            if remap:
                p.material_index = remap[p.material_index]
        bm.from_mesh(me)
        bpy.data.objects.remove(tmp)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if camo_uv:
        camo_ids = {i for i, m in enumerate(mats) if m and m.name == 'Camo'}
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
        uv = me.uv_layers.active.data
        for p in me.polygons:
            if p.material_index not in camo_ids:
                continue
            n = p.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                a, b = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
                uv[li].uv = (a / 3.0, b / 3.0)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


body = build([o for o in vehicle if o not in caps], 'MLRS', camo_uv=True)
cap_objs = [build([c], FIRE_CAPS[c.name]) for c in caps]
rocket_ob = build(rocket, 'Fuze')

tris = sum(len(p.vertices) - 2 for p in body.data.polygons)


def export(objs, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_animations=False,
        export_image_format='JPEG',
    )


export([body, *cap_objs], out_vehicle)
export([rocket_ob], out_rocket)
print('MLRS_OK', 'tris', tris, 'caps', [c.name for c in cap_objs],
      'axis', tuple(round(x, 4) for x in axis), 'rest', tuple(round(x, 3) for x in rest))
