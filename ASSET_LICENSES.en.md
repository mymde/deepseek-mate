# Asset sources and terms

[中文版](ASSET_LICENSES.md)

## DeepSeek Reset model (`deepseek-reset.vrm`, default character)

- **When you use this model, credit bilibili @hihihihi202**: https://space.bilibili.com/3546568969947566
- The original author allows modification; **commercial use is forbidden**. This plugin is free and open source and charges nothing; keep this notice when you repost or redistribute it.
- The version in this plugin was re-exported from `DeepSeek_Reset_4K_Lite.blend`: orientation fixed, HoYoverse/Genshin toon materials baked to MToon, expressions bound to the existing shape keys, duplicate outline meshes removed. The export script is `scripts/blender/export-deepseek-reset.py`.
- The VRM metadata records: author hihihihi202 (bilibili), personal non-profit use, credit required, modification and redistribution allowed.

## 希可儿 model (`whale-maid.vrm`, optional, not shipped in 0.6.x)

### Base model

- Victoria Rubin / VRoid Studio β AvatarSample_4, pixiv Inc.
- Mirror used for the download: https://github.com/madjin/vrm-samples/blob/master/vroid/beta/Victoria_Rubin.vrm
- Official terms: https://vroid.pixiv.help/hc/en-us/articles/360014900233
- The official page marks this base model CC0; the VRM `meta.licenseName` in the downloaded file is also CC0.
- The character keeps its face, expressions, body, skeleton and part of the hair; a dark-blue maid outfit, apron, headpiece, long hair, fin ears and a whale tail were added.

## Reference art and derivative character

The reference art was supplied by the requester for this prototype only. Its character and image rights do not become CC0 because the base model is CC0. Any public release must stay within the rights holder's authorisation.

## Code dependencies

The previewer uses Three.js 0.169.0 and @pixiv/three-vrm 3.3.3, both MIT; their licence texts are kept in the vendor directory.
Desktop mode uses Electron (MIT). The plugin does not bundle Electron: it downloads the official release (or the npmmirror mirror) only when the user enables desktop mode, and verifies it against `SHASUMS256.txt`. Building needs Blender 4.2.3 and VRM Add-on 4.10.3.

## Current scope

This is a template-derived prototype. The VRM contains a skeleton and expressions, and the motion is driven live by the preview page inside the DeepSeek Harness plugin. It does not include a Unity project, a separate chat service or a standalone pet installer. The long skirt does not fully support sitting or long strides; the tail fin and hair tips use simplified springs without full collision.

## 0.5.5 locally converted motions (`public/motions.json`)

- Source: Nekoluna-dot/GI-Engine, commit `7544dab99f1d1509a2e61ed995b13f4ae4f4145e`.
- Files used: `AGIA_Idle_generic_01.fbx`, `AGIA_Other_walking_01.fbx`, `AGIA_Other_waving_arm_01.fbx`, plus the Humanoid mapping and reference skeleton in their `.meta` files.
- AGIA author: Clean Curve Studio (Anime Girl Idle Animations). The asset product is under the Unity Asset Store EULA, not MIT / CC0: https://assetstore.unity.com/packages/3d/animations/anime-girl-idle-animations-free-150406 . That link identifies the series and author; it does not prove every file here belongs to the free edition.
- The GI-Engine / Mate-Engine asset notices also require credit to Shiny, non-commercial use, and restrict redistributing the assets on their own. The original text is kept at `public/animation-notices/GI-Engine-LICENSE.md`.
- The conversion was done in a local, personal workspace; the maintainer chose to host the converted result publicly in this repository. Conversion does not change the original licence; **the motion data is not MIT and this project grants no redistribution licence for it**. Copyright stays with the original authors; on request from a rights holder the maintainer removes the affected clips from the repository and any package. Obtain the original author's permission before commercial use or standalone redistribution.
- The skeleton player and conversion scripts are original to this project; no GI-Engine / Mate-Engine engine source was copied. No FBX models, textures, music, Genshin motions or Unity project are included.
- Conversion method: using the real reference skeleton from the `.meta` files, sampled global rotation deltas are converted into humanoid local quaternions; 51 bone channels including fingers at 30 fps; source SHA-256 values are recorded. Unity muscle values are not treated as Euler angles.
- Limits: the walk FBX has several animation layers and the current Three.js FBXLoader reads only the first. The local preview shows the gait but does not claim parity with every Unity layer. Mate-Engine Humanoid `.anim` files were not ported, and there is no general `.vmd` leg-IK solver.

## 0.5.6 motion-library sources

- Mate-Engine (Shiny), commit `2c5ea6b8f4cf5e1773a0816b46d9267cda5174d4`; the GI-Engine commit is the same as above.
- Contains the converted results of 14 AGIA FBX clips and 9 expression curves deduplicated by SHA-256 across both repositories. Each item's original path, file hash and duplicate source are stored in `clips` / `catalog` of `public/motions.json`.
- Mate-Engine licence copy: `public/animation-notices/Mate-Engine-LICENSE.md`. The AGIA, Shiny and GI-Engine terms above also apply; converted motions and expressions are not relicensed as MIT.
- Resources still awaiting conversion keep only their file names, hashes and status; they are not packaged as motion data. The UI does not display licence notices; the original statements stay in the package for future consolidation.

## 0.5.7 added Quaternius motions

- Author: Quaternius / Gonzalo Furnier. Series: Universal Animation Library (Standard, CC0). Official page: https://quaternius.itch.io/universal-animation-library .
- Access: the official page returned HTTP 403 from this server, so the public glTF mirror `J-Ponzo/gltf-universal-animation-library` was used at pinned commit `e24c23cf2a1323488a3faa226ea7ea21f644b73e` (the mirror describes itself as the 2025-06-10 Standard release). No paid Pro or Source edition was used. Mirror: https://github.com/J-Ponzo/gltf-universal-animation-library/tree/e24c23cf2a1323488a3faa226ea7ea21f644b73e .
- Licence copy: `public/animation-notices/Quaternius-CC0.txt`.
- Ten clips were taken from that glTF: Idle_Loop, Idle_Talking_Loop, Dance_Loop, Interact, PickUp_Table, Sitting_Idle_Loop, Sitting_Talking_Loop, Crouch_Idle_Loop, Walk_Formal_Loop, Walk_Loop.
- The source SHA-256 is the digest of the original glTF bytes followed by the external buffer bytes in order; each clip also records its original clip name, so they are not ten independent source files. Mapping was checked against the original skin joint list; the author's A_TPose was used to retarget 52 humanoid bones including fingers. Sampling is 30 fps; horizontal root translation is omitted and seated height is controlled by the plugin's seat positioning.
- The new assets are used as alternative motions and do not claim to restore the missing body trajectories from Mate-Engine / GI-Engine. The official VRoid seven-motion pack was not bundled and no software dependency was added.

## koffi 3.1.0 (`desktop/vendor/koffi`)

- Source: npm packages `koffi` 3.1.0 (JS loader) and `@koromix/koffi-win32-x64` 3.1.0 (`koffi.node` prebuilt binary), https://koffi.dev , author Niels Martignène.
- Licence: MIT; full text at `desktop/vendor/koffi/LICENSE.txt`.
- Use: reads window positions on Windows in desktop mode only (never titles or contents).
