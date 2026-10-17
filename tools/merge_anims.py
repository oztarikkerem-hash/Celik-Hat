"""Mixamo'dan inen animasyon FBX'lerini karakter .blend'ine aksiyon olarak ekler.

Mixamo klipleri "Without Skin" indirildiğinde yalnızca iskelet + hareket
içerir. Kemik adları (mixamorig:*) karakterinkiyle aynı olduğu için aksiyon
doğrudan karakterin armatürüne takılabiliyor.

İki tuzak var:
  • İçe aktarılan rig genelde 0.01 ölçekli geliyor; aksiyonun kalça KONUM
    anahtarları o ölçekte. Hedef rig'le oranlanmazsa asker havaya fırlıyor.
  • Dosya adları oyunun beklediği klip adlarına çevrilmeli (idle/walk/…).

Kullanım:
  blender --background <karakter>.blend --python tools/merge_anims.py -- \\
      <animasyon_klasoru> <cikis.blend>
"""
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    raise SystemExit("Kullanım: <animasyon_klasoru> <cikis.blend>")
ANIM_DIR, OUT_BLEND = argv[0], argv[1]

# Dosya adı (küçük harf, uzantısız) → oyundaki klip adı
AD = {
    "rifle idle": "idle",
    "rifle walk": "walk",
    "rifle run": "run",
    "walk crouching forward right": "crouch",
    "crouch walk": "crouch",
    "firing rifle": "fire",
    "reloading": "reload",
    "dying backwards": "death",
}


def fcurves(action):
    """Blender 5 katmanlı aksiyon API'si; eski sürümde action.fcurves."""
    out = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out.extend(bag.fcurves)
    if not out and hasattr(action, "fcurves"):
        out = list(action.fcurves)
    return out


hedef_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
hedef_kalca = next((b for b in hedef_arm.data.bones if b.name.endswith("Hips")), None)
# Oran NESNE ÖLÇEĞİNDEN gelir. Mixamo FBX'i Blender'a 0.01 ölçekli bir
# armatür nesnesi olarak giriyor; aksiyonun konum anahtarları hâlâ
# santimetre cinsinde ve nesne ölçeğinin telafi etmesi bekleniyor. Aynı
# anahtarlar 1.0 ölçekli hedef rig'e takılınca asker 80 m uzaya uçuyordu.
hedef_boy = hedef_kalca.head_local.z if hedef_kalca else 1.0
hedef_olcek = hedef_arm.matrix_world.to_scale().z or 1.0
print(f"HEDEF\t{hedef_arm.name}\tkalca_yukseklik={hedef_boy:.3f}")

# Modelle gelen duruş/idle aksiyonlarını at: yerlerine indirilenler gelecek
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

eklenen = []
for dosya in sorted(os.listdir(ANIM_DIR)):
    if not dosya.lower().endswith(".fbx"):
        continue
    yol = os.path.join(ANIM_DIR, dosya)
    onceki = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.fbx(filepath=yol, automatic_bone_orientation=False,
                                 ignore_leaf_bones=True)
    except RuntimeError as exc:
        print(f"ICE_AKTARMA_HATASI\t{dosya}\t{exc}")
        continue
    yeni = [o for o in bpy.data.objects if o not in onceki]
    imp_arm = next((o for o in yeni if o.type == "ARMATURE"), None)
    act = imp_arm.animation_data.action if (imp_arm and imp_arm.animation_data) else None

    if act:
        taban = os.path.splitext(dosya)[0].lower()
        act.name = AD.get(taban, taban.replace(" ", "_"))
        act.use_fake_user = True            # armatür silinince aksiyon kalsın

        # Kalça konum anahtarlarını hedef rig'in ölçeğine getir
        imp_kalca = next((b for b in imp_arm.data.bones if b.name.endswith("Hips")), None)
        imp_boy = imp_kalca.head_local.z if imp_kalca else 1.0
        imp_olcek = imp_arm.matrix_world.to_scale().z or 1.0
        oran = imp_olcek / hedef_olcek
        if abs(oran - 1.0) > 0.001:
            for fc in fcurves(act):
                if fc.data_path.endswith("location"):
                    for kf in fc.keyframe_points:
                        kf.co[1] *= oran
                        kf.handle_left[1] *= oran
                        kf.handle_right[1] *= oran
        r = act.frame_range
        eklenen.append(act.name)
        print(f"KLIP\t{act.name}\tkare={r[0]:.0f}-{r[1]:.0f}\tolcek_orani={oran:.4f}")

    for o in yeni:
        bpy.data.objects.remove(o, do_unlink=True)

# İçe aktarmayla gelen artık veriler (malzeme/mesh) temizlensin
for blok in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures):
    for d in list(blok):
        if d.users == 0:
            blok.remove(d)

print(f"TOPLAM_KLIP\t{len(eklenen)}\t{eklenen}")
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print(f"KAYIT\t{OUT_BLEND}")
