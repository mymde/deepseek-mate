#!/bin/sh
# Rebuild public/deepseek-reset.vrm from the source .blend (credit: bilibili @hihihihi202; non-commercial).
# Usage: scripts/build-deepseek-reset.sh /path/to/DeepSeek_Reset_4K_Lite.blend [OUT.vrm]
# Needs Blender 5.2 with the VRM Add-on 4.10, and Python 3 with numpy + Pillow.
set -e
here=$(cd "$(dirname "$0")" && pwd)
blend="$1"
out="${2:-$here/../public/deepseek-reset.vrm}"
work=$(mktemp -d)
"${BLENDER:-blender}" -b "$blend" --python "$here/blender/export-deepseek-reset.py" -- "$work/raw.vrm" "$work/bake"
"${PYTHON:-python3}" "$here/repair-vrm.py" "$work/raw.vrm" "$out" --textures-max 2048 --jpeg 88 --report "$work/slim.json"
echo "wrote $out ($(du -h "$out" | cut -f1)); intermediates in $work"
