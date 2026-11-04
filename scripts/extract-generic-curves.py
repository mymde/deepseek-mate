"""Read Unity generic clips as data; never evaluate Humanoid muscle curves."""
import json,sys,hashlib,re
from pathlib import Path
import yaml
root=Path(sys.argv[1])/'Assets/MATE ENGINE - Animations'
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
filters=sys.argv[3:]
for p in sorted(root.rglob('*.anim')):
 if filters and not any(f in p.name for f in filters):continue
 raw=p.read_bytes()
 if b'm_RotationCurves: []' in raw:continue
 sha=hashlib.sha256(raw).hexdigest();dest=out/(sha+'.json')
 if dest.exists():continue
 text=raw.decode('utf-8-sig')
 sections=[]
 for name in ['m_AnimationClipSettings','m_RotationCurves','m_PositionCurves','m_ScaleCurves']:
  m=re.search(r'^  '+name+r':.*?(?=^  \w|\Z)',text,re.M|re.S)
  if not m:raise ValueError('Missing '+name)
  sections.append(m[0])
 d=yaml.load(''.join(sections),Loader=yaml.CSafeLoader)
 settings=d['m_AnimationClipSettings']
 curves={}
 for name in ['m_RotationCurves','m_PositionCurves','m_ScaleCurves']:
  curves[name]=[dict(path=c['path'],keys=[[k['time'],*k['value'].values()] for k in c['curve']['m_Curve']]) for c in d.get(name,[])]
 data=dict(source=dict(project='GI-Engine',path=str(p.relative_to(root)),sha256=sha),settings=settings,curves=curves)
 dest.write_text(json.dumps(data,separators=(',',':')))
 print(p.name,flush=True)
