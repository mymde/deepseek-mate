#!/usr/bin/env python3
"""Export the public repository (github.com/<owner>/deepseek-mate) from this working copy.

Only redistributable material goes public:
  - the plugin code (MIT) and the vendored koffi (MIT);
  - the DeepSeek Reset avatar (author hihihihi202 allows modification and redistribution with
    credit, non-commercial);
  - motions from Quaternius' Universal Animation Library (CC0) plus the built-in procedural poses.
Motion and expression data converted from GI-Engine / Mate-Engine (AGIA by Clean Curve Studio,
Unity Asset Store EULA; Shiny's non-commercial, no-standalone-redistribution terms) stay local:
they are filtered out of public/motions.json and never copied.

Usage: python3 scripts/export-public.py <target-dir>
"""
import json
import os
import shutil
import sys

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_PROJECTS = {'Quaternius Universal Animation Library'}
SKIP_DIRS = {'node_modules', 'releases', '.git', '__pycache__', 'test/shots', 'test/models', 'test/local-motions', 'test/experiments'}
SKIP_FILES = {'public/whale-maid.vrm', 'public/animation-notices/GI-Engine-LICENSE.md', 'public/animation-notices/Mate-Engine-LICENSE.md'}


def public_motions(pack):
    clips = {k: v for k, v in pack['clips'].items() if v.get('source', {}).get('project') in PUBLIC_PROJECTS}
    def ok(entry):
        sources = entry.get('sources') or ([entry['source']] if isinstance(entry.get('source'), dict) else [])
        return entry.get('id') in clips or (sources and all(s.get('project') in PUBLIC_PROJECTS for s in sources))
    catalog = [e for e in pack.get('catalog', []) if ok(e)]
    defaults = {k: v for k, v in (pack.get('defaults') or {}).items() if v in clips}
    return {**pack, 'name': '希可儿动作库 · Quaternius (CC0)', 'attribution': 'Universal Animation Library (Standard) by Quaternius, CC0 1.0. See public/animation-notices/Quaternius-CC0.txt.', 'clips': clips, 'catalog': catalog, 'defaults': defaults}


def main(target):
    if os.path.exists(os.path.join(target, '.git')):
        # Keep the repository; replace the working files.
        for name in os.listdir(target):
            if name != '.git':
                p = os.path.join(target, name)
                shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)
    os.makedirs(target, exist_ok=True)
    for root, dirs, files in os.walk(SRC):
        rel = os.path.relpath(root, SRC)
        rel = '' if rel == '.' else rel.replace(os.sep, '/')
        dirs[:] = [d for d in dirs if (rel + '/' + d if rel else d) not in SKIP_DIRS and d not in SKIP_DIRS]
        for f in files:
            path = (rel + '/' + f) if rel else f
            if path in SKIP_FILES or f.endswith('.tgz') or f.endswith('.pyc'):
                continue
            dst = os.path.join(target, path)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(root, f), dst)
    with open(os.path.join(SRC, 'public/motions.json'), encoding='utf-8') as fh:
        pack = public_motions(json.load(fh))
    with open(os.path.join(target, 'public/motions.json'), 'w', encoding='utf-8') as fh:
        json.dump(pack, fh, ensure_ascii=False, separators=(',', ':'))
    print(f"exported to {target}: {len(pack['clips'])} clips, {len(pack['catalog'])} catalog entries ({', '.join(sorted(pack['clips']))})")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(os.path.abspath(sys.argv[1]))
