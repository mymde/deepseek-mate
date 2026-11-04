"""Reproducible audit of the 88 source-rig clips; writes evidence, not motions.
Usage: python3 scripts/audit-generic-motions.py GI_REPO [REPORT.json]
"""
import hashlib
import json
import sys
from pathlib import Path
from collections import Counter
from motion_sources import transform_evidence, classify_transform

root = Path(sys.argv[1]) / 'Assets/MATE ENGINE - Animations'
entries = {}
for p in sorted(root.rglob('*.anim')):
    raw = p.read_bytes()
    if b'm_RotationCurves: []' in raw:
        continue
    sha = hashlib.sha256(raw).hexdigest()
    if sha in entries:
        entries[sha]['paths'].append(str(p.relative_to(root)))
        continue
    evidence = transform_evidence(raw.decode('utf-8-sig'))
    status, reason = classify_transform(str(p.relative_to(root)), evidence)
    entries[sha] = dict(sha256=sha, paths=[str(p.relative_to(root))], status=status,
                        reason=reason, evidence=evidence)
report = dict(scope='GI-Engine/Assets/MATE ENGINE - Animations: nonempty m_RotationCurves',
              unique=len(entries), counts=dict(Counter(e['status'] for e in entries.values())),
              entries=list(entries.values()))
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'test/local-motions/generic-audit.json')
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(dict(unique=report['unique'], counts=report['counts']), ensure_ascii=False))
