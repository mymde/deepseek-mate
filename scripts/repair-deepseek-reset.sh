#!/bin/sh
# Rebuild the repaired DeepSeek Reset model from the original export (never modified).
# Usage: scripts/repair-deepseek-reset.sh /path/to/DeepSeek_Reset_4K_Lite.vrm OUT.vrm
set -e
here=$(dirname "$0")
python3 "$here/repair-vrm.py" "$1" "$2" \
  --rest-from-bind --face +x --unlit-emission --eyes LeftEye,RightEye \
  --expressions "$here/deepseek-reset.expressions.json" \
  --patch-materials "$here/deepseek-reset.materials.json" \
  --add-image iris_L="$here/deepseek-reset-assets/iris_L.png" --add-image iris_R="$here/deepseek-reset-assets/iris_R.png" \
  --nudge Iris_L=0,0,0.0015 --nudge Iris_R=0,0,0.0015 --nudge QC_Star_L=0,0,0.0018 --nudge QC_Star_R=0,0,0.0018 \
  --thicken "DeepSeek mouth contour=y,6" \
  --report "${2%.vrm}.repair.json"
