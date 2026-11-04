"""Structural checks for Unity YAML. A parent path is not an animated bone.

For example, a curve ending in /UpperArm/+Sleeve animates the sleeve only.
Keep this preflight independent of the renderer and of animation file names.
"""
import re


def transform_evidence(text):
    section = re.search(r'^  m_RotationCurves:.*?(?=^  \w|\Z)', text, re.M | re.S)
    paths = re.findall(r'^    path: (.*)$', section[0], re.M) if section else []
    body = re.compile(r'^Bip001(?: (?:Pelvis|Spine[12]?|Neck|Head|[LR] (?:Clavicle|UpperArm|Forearm|Hand|Thigh|Calf|Foot|Toe0)))?$')
    core = [p for p in paths if body.fullmatch(p.split('/')[-1])]
    attrs = re.findall(r'^    attribute: (.*)$', text, re.M)
    muscles = [a for a in attrs if re.match(r'^(Left|Right|Spine |Chest |UpperChest |Neck |Head )', a)]
    return dict(rotationTracks=len(paths), bodyRotationPaths=core, humanoidAttributes=muscles,
                floatAttributes=attrs, exampleRotationPaths=paths[:3])


def classify_transform(relative, evidence):
    if evidence['humanoidAttributes']:
        return 'needs-unity', '混合动画：含 Humanoid 肌肉曲线，不能仅转换附属骨骼'
    if relative.startswith('nEW/AnimationClip/Eff_'):
        return 'source-asset', '相机／材质特效曲线，不是角色身体动作'
    if not evidence['bodyRotationPaths']:
        return 'missing-body', '缺少主体动画：旋转轨迹只作用于附属骨骼，需补齐原动作数据'
    return 'needs-rig', '原角色骨架曲线，需要参考骨架重定向'
