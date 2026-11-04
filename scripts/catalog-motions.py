"""Inventory both local animation trees, deduplicate bytes, and sample face curves.

Run after import-gi-motions.mjs. Requires PyYAML; no Unity or network required.
Usage: python3 scripts/catalog-motions.py MATE_REPO GI_REPO [public/motions.json]
Humanoid muscles and generic source-rig curves are catalogued, never guessed.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import yaml
from motion_sources import transform_evidence, classify_transform

EXPRESSIONS = dict(A='aa', I='ih', U='ou', E='ee', O='oh', Joy='happy',
                   Fun='relaxed', Sorrow='sad', Angry='angry', Blink='blink',
                   Blink_L='blinkLeft', Blink_R='blinkRight', Neutral='neutral')
LABELS = {'PET_TALKING': '说话口型', 'FACE_SMILE': '微笑', 'FACE_SMILE 1': '微笑变体',
          'PET_HAPPY': '开心', 'FACE_HAIR_STROKE': '摸头表情', 'FACE_DRAG': '拖拽表情',
          'FACE_RESET': '恢复表情', 'FACE_IDLE_1': '待机表情', 'FACE_INTIME': '亲近表情'}


def sample(keys, t):
    if t <= keys[0]['time']:
        return keys[0]['value']
    for a, b in zip(keys, keys[1:]):
        if t <= b['time']:
            dt = b['time'] - a['time']
            if not dt:
                return b['value']
            if not math.isfinite(a['outSlope']) or not math.isfinite(b['inSlope']):
                return a['value']
            # Unweighted Unity curves are cubic Hermite. Fail explicitly for
            # unsupported weighted curves instead of silently changing timing.
            if a.get('weightedMode', 0) & 2 or b.get('weightedMode', 0) & 1:
                raise ValueError('Weighted face curve requires a Bezier evaluator')
            u = (t - a['time']) / dt
            return ((2*u**3-3*u*u+1)*a['value'] + (u**3-2*u*u+u)*dt*a['outSlope']
                    + (-2*u**3+3*u*u)*b['value'] + (u**3-u*u)*dt*b['inSlope'])
    return keys[-1]['value']


def main():
    output = Path(sys.argv[3] if len(sys.argv) > 3 else 'public/motions.json')
    pack = json.loads(output.read_text())
    inventory = {}
    for project, repo in zip(('Mate-Engine', 'GI-Engine'), sys.argv[1:3]):
        root = Path(repo) / 'Assets/MATE ENGINE - Animations'
        for path in sorted(root.rglob('*')):
            if path.suffix.lower() not in ('.anim', '.fbx', '.vmd', '.vrma'):
                continue
            raw = path.read_bytes()
            sha = hashlib.sha256(raw).hexdigest()
            source = dict(project=project, path=str(path.relative_to(root)))
            if sha in inventory:
                inventory[sha]['sources'].append(source)
                continue
            kind = 'fbx'
            if path.suffix == '.anim':
                text = raw.decode('utf-8-sig')
                attrs = re.findall(r'^    attribute: (.*)$', text, re.M)
                kind = ('transform' if 'm_RotationCurves: []' not in text else
                        'humanoid' if any(re.match(r'Root|Left|Right', a) for a in attrs) else 'expression')
            entry = dict(id='source-' + sha[:16], label=path.stem, kind=kind, sha256=sha,
                         sources=[source], bytes=len(raw))
            inventory[sha] = entry
            if kind == 'transform':
                entry['evidence'] = transform_evidence(text)
            if kind != 'expression':
                continue
            data = yaml.load('\n'.join(text.splitlines()[3:]), Loader=yaml.CSafeLoader)['AnimationClip']
            settings = data['m_AnimationClipSettings']
            duration = settings['m_StopTime'] - settings['m_StartTime']
            if not 0 < duration <= 300:
                raise ValueError(f'Invalid face duration: {path}')
            count = max(2, math.ceil(duration * 30) + 1)
            expressions = {}
            for curve in data['m_FloatCurves']:
                name = EXPRESSIONS.get(curve['attribute'])
                if name is None:
                    raise ValueError(f'Unknown face channel: {curve["attribute"]}')
                keys = curve['curve']['m_Curve']
                expressions[name] = [round(max(0, min(1, sample(keys, settings['m_StartTime'] + i * duration / (count-1)))), 6)
                                     for i in range(count)]
            id = 'face-' + sha[:12]
            pack['clips'][id] = dict(label=LABELS.get(path.stem, path.stem), category='表情',
                                    duration=duration, loop=bool(settings['m_LoopTime']),
                                    frames={}, expressions=expressions,
                                    source=dict(**source, sha256=sha))
    ready = {clip['source']['sha256']: (id, clip) for id, clip in pack['clips'].items()}
    for sha, entry in inventory.items():
        if sha in ready:
            id, clip = ready[sha]
            entry.update(id=id, label=clip['label'], category=clip['category'], status='ready')
        else:
            reasons = {'humanoid': ('needs-unity', 'Unity Humanoid 肌肉曲线，需要动画求值导出'),
                       'transform': ('needs-rig', '原角色骨架曲线，需要参考骨架重定向'),
                       'fbx': ('source-asset', '模型、道具或特效资源，尚未识别为可播角色动作')}
            status, reason = (classify_transform(entry['sources'][0]['path'], entry['evidence'])
                              if entry['kind'] == 'transform' else reasons[entry['kind']])
            entry.update(status=status, reason=reason, category='待转换' if status != 'source-asset' else '源资源')
    pack['catalog'] = list(inventory.values())
    pack['name'] = 'Mate-Engine / GI-Engine 动作库'
    output.write_text(json.dumps(pack, ensure_ascii=False, separators=(',', ':')))
    counts = {status: sum(e['status'] == status for e in pack['catalog'])
              for status in sorted({e['status'] for e in pack['catalog']})}
    print(json.dumps(dict(files=sum(len(e['sources']) for e in inventory.values()), unique=len(inventory),
                          playable=len(pack['clips']), statuses=counts), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
