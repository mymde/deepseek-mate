# 希可儿 · deepseek-mate

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A 3D desktop companion (桌宠) for [DeepSeek Harness](https://github.com/deepseek-ai).** Install the plugin and 希可儿 appears in the Harness Web UI, sitting on the chat input box. She breathes, looks at your cursor, reacts while the agent thinks, mouths the streamed reply, and can move out to your real desktop to sit on the top edge of any window or the taskbar.

> **Naming.** The project/repository is **deepseek-mate**; the plugin package id is **`dsh-plugin-whale-mate`** (kept unchanged so existing installs, config keys and stored settings keep working). The character is **希可儿** (Xikeer).

[中文文档](README.zh-CN.md) · [Changelog](CHANGELOG.md) · [Asset licences](ASSET_LICENSES.md) · [Contributing](CONTRIBUTING.md)

![希可儿](public/thumbs/avatar.png)

---

## Table of contents

- [What she does](#what-she-does)
- [Requirements](#requirements)
- [Installation](#installation)
- [Using her](#using-her)
- [Desktop mode](#desktop-mode)
- [Models](#models)
- [Configuration](#configuration)
- [Agent tools](#agent-tools)
- [How it works](#how-it-works)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## What she does

| Scenario                                  | Behaviour                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle                                      | Breathes, blinks, swings her legs, follows the mouse with her eyes and head. Occasionally stretches, walks around, sits on the edge, or plays a small motion. After 3 minutes without activity she dozes off.                                                                     |
| You send a message                        | Nods to acknowledge it.                                                                                                                                                                                                                                                           |
| DeepSeek is thinking                      | Hand on chin, with a "…" bubble.                                                                                                                                                                                                                                                  |
| DeepSeek replies                          | Her mouth moves in sync with the streamed text; the bubble shows the latest part of the reply, then the opening of the reply once it finishes.                                                                                                                                    |
| A request fails                           | Sad face, shakes her head, and the bubble explains why (for example, "no API key configured").                                                                                                                                                                                    |
| You drag her                              | She dangles from the grab point and swings as you move. Release her and she falls, or throws her. She lands on the top edge of whatever card is below, or on the bottom of the window. Surfaces too close to the top of the window (where her head would be cut off) are skipped. |
| Double-click                              | Waves and says hello.                                                                                                                                                                                                                                                             |
| Click her head / stroke it with the mouse | Headpat: she squints and smiles.                                                                                                                                                                                                                                                  |
| Click her body                            | She gets startled.                                                                                                                                                                                                                                                                |
| Right-click                               | A radial wheel: your favourite actions and expressions, the window/desktop switch, and hide.                                                                                                                                                                                      |
| Settings                                  | **Settings → 希可儿桌宠**: model, mode, size, right-click wheel contents, diagnostics.                                                                                                                                                                                            |

The character is fully local: the plugin ships its own Three.js/three-vrm engine and VRM avatar. It does not call any LLM itself — the bubble text comes from the Harness session it is watching.

## Requirements

- **DeepSeek Harness** — the official Desktop app (recommended) or `dsh web`, version `0.2.1` or newer.
- **OS** — Windows 10/11, macOS, or Linux (X11). Desktop mode has the best window tracking on Windows; see [Desktop mode](#desktop-mode).
- **Node.js 22+** only if you build from source or run the test suite. Installing the plugin needs no toolchain.
- No Unity, no Blender, no separate application. Desktop mode downloads its own Electron runtime on first use (or reuses one you already have).

## Installation

### Install sources

The **添加插件 (Add plugin)** dialog accepts three kinds of source:

| Source                | Example                                                                                    | Notes                                                                |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| npm package name      | `dsh-plugin-whale-mate`                                                                    | works once the package is published to the registry the profile uses |
| GitHub repository URL | `https://github.com/mymde/deepseek-mate.git#v0.6.3` or `github:mymde/deepseek-mate#v0.6.3` | recommended; this repository currently ships this way                |
| absolute local path   | `/absolute/path/to/deepseek-mate` or a `.tgz`                                              | offline installs and development                                     |

This project is not published on npm yet, so use the GitHub URL (or a local path) in the dialog. Pin the tag (`#v0.6.3`) so that reinstalling is reproducible.

### DeepSeek Harness Web (`dsh web`)

```sh
# from GitHub, pinned to the release tag
dsh plugin --profile web add github:mymde/deepseek-mate#v0.6.3

# or a local directory / tarball
dsh plugin --profile web add /absolute/path/to/deepseek-mate
dsh plugin --profile web add /absolute/path/to/dsh-plugin-whale-mate-0.6.3.tgz
```

Restart `dsh web` and open the page. 希可儿 sits on the top edge of the chat input box.

### DeepSeek Harness Desktop (the official app)

The Desktop app uses its own `desktop` profile, so `--profile web` does not reach it. Either:

1. In the app: **插件 (Plugins) → 添加插件 (Add plugin)**, then enter the repository URL:
   `https://github.com/mymde/deepseek-mate.git#v0.6.3`
   (a package name or an absolute path to an unpacked plugin folder also works); or
2. With the app's own `dsh` command (**Application menu → Manage dsh Command…**): quit Desktop completely, run
   `dsh plugin --profile desktop add github:mymde/deepseek-mate#v0.6.3`, then reopen the app.

### Upgrading and removing

The plugin manager refuses to install over an existing package:

1. Quit Harness completely.
2. Remove the old plugin entry in **插件**.
3. Add the new version, then restart.

**Settings → 希可儿桌宠 → 版本 · 诊断信息** shows which version is actually running (page and host), so you can confirm an upgrade took effect.

## Using her

- **Sidebar** — the 🐋 希可儿 button shows or hides her; showing her again always puts her back on the input box.
- **Right-click** — a radial wheel with the actions/expressions you picked in Settings (up to 6), the **窗口模式 / 桌面模式** switch, and **隐藏**.
- **Settings → 希可儿桌宠** — model, mode, size (160–640 px), right-click wheel contents, recall button, diagnostics.
- **Size** is stored per browser (localStorage). Desktop mode uses the same size.

## Desktop mode

Inside the page she can never leave the Harness window. In desktop mode the plugin opens a transparent, always-on-top, click-through window over the desktop, and she moves there:

- enabling desktop mode seats her on the **top edge of the Harness window** automatically, and she rides along when you move it;
- she can be dragged anywhere on the screen; only her visible pixels take the mouse, everything else clicks through to the apps below;
- minimising or hiding Harness to the tray hides the overlay; restoring Harness restores her perch;
- if the window touches the screen top (including maximised windows), the seat moves inward enough to keep her head visible;
- replies, thinking, errors and the `pet_*` tools still reach her on the desktop.

Turn it on from her right-click wheel (到桌面上去) or **Settings → 希可儿桌宠 → 桌面模式**; turn it off from her desktop menu (回到 Harness 窗口里) or the same settings block. The choice is remembered.

### Runtime resolution

The overlay is an Electron window. The runtime is resolved in this order:

1. `electron` in the plugin config (or `DSH_WHALE_MATE_ELECTRON`) — path to an Electron executable you already have;
2. the Harness host itself, when it runs in an Electron main process;
3. otherwise a one-time download of **Electron 44.10.2** for your OS (≈150 MB on Windows) from the npmmirror mirror (GitHub as fallback), verified against the release's `SHASUMS256.txt`, unpacked into `~/.dsh-whale-mate/runtime/` (`DSH_WHALE_MATE_HOME` moves it). Nothing is downloaded until you switch desktop mode on.

Desktop mode only works on the machine that runs Harness: the control routes accept loopback requests only and sit behind Harness's login fence. Remote or display-less hosts show the reason in the settings block. `desktop: false` in the plugin config removes desktop mode entirely. On Linux the overlay runs Chromium without its sandbox (an unpacked runtime cannot have a setuid helper); it only loads the plugin's own files from a token-protected loopback URL.

### Configuration

```yaml
- id: whale-mate
  config:
    desktop: true # false: no desktop mode
    electron: C:/tools/electron/electron.exe # optional: use this runtime, skip the download
```

## Models

### Bundled model

| id                         | Model          | Notes                                                                                                                                                                            |
| -------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deepseek-reset` (default) | DeepSeek Reset | **If you use this model, credit bilibili @hihihihi202** (https://space.bilibili.com/3546568969947566). The original author allows modification; **commercial use is forbidden**. |

**Settings → 希可儿桌宠** shows the current model's author and credit notice, read from the VRM metadata.

The earlier VRoid-template character (`whale-maid.vrm`, 18.7 MB) is **not** shipped since 0.6.2 — the package is 9.1 MB instead of 21.6 MB. Its CC0 base is documented in [`ASSET_LICENSES.md`](ASSET_LICENSES.md); you can still use any VRM you own through the `model` setting.

### Using your own VRM

Set `model` to an absolute path to a `.vrm` file on the Harness host (VRM 0.x and 1.0 are supported):

```yaml
- id: whale-mate
  config:
    model: /path/to/your-avatar.vrm
    modelName: My Character # display name on the settings page (optional)
```

Or use the environment variable `DSH_WHALE_MATE_MODEL=/path/to/x.vrm`. Restart `dsh web` for the change to take effect. Model files are only served to logged-in users of this machine's Harness; they are not uploaded anywhere.

### Repairing exported models

Models exported from Blender often have problems. `scripts/repair-vrm.py` fixes them and writes a new file; the original is never modified.

| Option                              | Fixes                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--rest-from-bind`                  | The skeleton's rest pose doesn't match the mesh. Rebuilds the rest pose from the skin's inverse bind matrices.                                                       |
| `--face +x`                         | The character faces the wrong way. Rotates the mesh and skeleton so the character faces +Z, as VRM 1.0 requires.                                                     |
| `--unlit-emission`                  | The colour lives entirely in emission (black base colour) and looks washed out in three.js. Converts these materials to unlit, with colours tone-mapped through AgX. |
| `--expressions map.json`            | Morph targets aren't bound to VRM expressions (no blinking, expressions or lip sync). Binds them by name.                                                            |
| `--patch-materials` / `--add-image` | Puts back textures the export lost (face, hair, irises).                                                                                                             |
| `--nudge` / `--thicken`             | Fixes z-fighting between coplanar layers (iris vs. eye white), and hairline mouth contours too thin to see at pet size.                                              |
| Always on                           | Drops constant vertex-colour sets, drops morph normals on unlit meshes, stores morph targets as sparse accessors. Usually shrinks the file several times over.       |

### Rebuilding the default model

`scripts/build-deepseek-reset.sh DeepSeek_Reset_4K_Lite.blend` (Blender 5.2 + VRM Add-on 4.10) turns the character to face the camera, bakes the HoYoverse/Genshin toon materials into textures and converts them to MToon, binds 13 standard expressions plus `jito` / `wink` / `tehe`, writes the credit metadata, and slims the file with `repair-vrm.py`. The result is about 13 MB. `scripts/tune-mtoon.py` adjusts MToon outlines and shading without rebuilding.

## Configuration

Plugin config lives in the profile's `cordis.patch.yml`:

```yaml
- id: whale-mate
  config:
    desktop: true
    electron: null
    model: null
    modelName: null
    tools: true
```

| Key         | Type    | Default | Meaning                                                         |
| ----------- | ------- | ------- | --------------------------------------------------------------- |
| `desktop`   | boolean | `true`  | `false` disables desktop mode and its routes entirely.          |
| `electron`  | string  | —       | Absolute path to an Electron executable; skips the download.    |
| `model`     | string  | —       | Built-in id (`deepseek-reset`) or an absolute path to a `.vrm`. |
| `modelName` | string  | —       | Display name for the custom model in Settings.                  |
| `tools`     | boolean | `true`  | `false` does not register the `pet_*` agent tools.              |

Environment variables:

| Variable                  | Effect                                                |
| ------------------------- | ----------------------------------------------------- |
| `DSH_WHALE_MATE_MODEL`    | Same as `model`, used when the config value is empty. |
| `DSH_WHALE_MATE_ELECTRON` | Same as `electron`.                                   |
| `DSH_WHALE_MATE_HOME`     | Where the downloaded desktop runtime is unpacked.     |

## Agent tools

The agent can control her through three tools (registered only when `tools` is not `false`):

| Tool             | What it does                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pet_say`        | Says a line in the bubble (`text`, optional `expression`). Keep it under 60 characters.                                                                                                             |
| `pet_expression` | Sets her expression for `seconds` (1–30, default 4): `neutral`, `happy`, `angry`, `sad`, `relaxed`, `surprised`, `blink`.                                                                           |
| `pet_action`     | Performs an action: `wave`, `nod`, `shake`, `cheer`, `bow`, `stretch`, `shy`, `dance`, `jump`, `sit`, `stand`, `walk`, `sleep`, `wake`, `home`, plus every motion bundled in `public/motions.json`. |

The tools only acknowledge the call; the browser overlay watches the session stream and performs the action, so there is no extra host↔browser channel.

## How it works

- **Host side (`lib/index.js`)**
  - serves the `public/` engine and model under `/whale-mate/` behind Harness's own login fence (unauthenticated requests get a 401);
  - registers the three `pet_*` tools (they only acknowledge);
  - mounts the desktop-mode routes and forwards validated commands to the overlay.
- **Desktop overlay (`lib/desktop.js`, `desktop/`)**
  - `lib/desktop.js` finds or downloads the runtime, starts `desktop/app.cjs` with a Node IPC channel (or runs the overlay in-process), and relays page → overlay messages through `POST /whale-mate/desktop/send` after validating them;
  - `desktop/main.cjs` opens one transparent window over the work area of the display Harness is on, serves `overlay.html`, `pet.js` and the model from a random loopback port, toggles click-through from the pet's per-pixel hit test (Windows/macOS) or sets an input shape around her (Linux), and polls the OS cursor;
  - on the official Windows Desktop, `desktop/harness-window.cjs` uses Koffi to read only the window of the shell PID that launched the official Host (DWM visible-frame bounds, physical pixels converted to Electron DIP, polled at 50 ms). No other application is a perch;
  - on Web / non-Windows the page reports `window.screenX/Y`, size and visibility every 200 ms; this fallback has no native tracking guarantees.
- **Browser side (`client/client.js`)** — a hand-written DSH client module (no build step at install time). It loads `public/pet.js` and follows the session in the main view through the `sessions` service; live text, running state and `tool/call` events drive the pet directly.
- **Engine (`src/pet/`, bundled to `public/pet.js` with three.js and three-vrm)**
  - overlay: a transparent `position:fixed` layer with a per-pixel hit test;
  - pose system: locomotion, gesture layers, look-at and root motion blended and smoothed onto every bone;
  - physics: 70 spring bones added at runtime for hair, skirt and tail;
  - face: emotion blending, random blinking, and lip sync driven by the text.

## Development

```sh
npm install
npm run build        # src/pet -> public/pet.js (also copies the model if missing)
npm test             # host routes, native tracking, seat geometry, FFI (Linux needs a C compiler)

npm run lint         # ESLint (flat config)
npm run format        # Prettier
npm run format:check  # verify formatting without writing

node scripts/check-pet.mjs           # screenshots on a simulated page (test/harness.html)
node scripts/pose-gallery.mjs        # front/side screenshots of each pose
node scripts/mock-llm.mjs 18790      # OpenAI-compatible mock model for end-to-end testing
node scripts/check-dsh.mjs '<dsh url with ?token=>'   # end-to-end test in a real Harness
node scripts/check-clip.mjs          # regression: no perch where her head would be cut off
```

Desktop-mode checks (Linux + Xvfb; `WHALE_MATE_ELECTRON_FLAGS="--use-gl=angle --use-angle=swiftshader"` for software GL):

```sh
xvfb-run -s "-screen 0 1600x900x24" node scripts/check-desktop.mjs <electron> [outDir]
DISPLAY=:77 node scripts/check-dsh-desktop.mjs '<dsh url with ?token=>' [outDir]
```

The screenshot and end-to-end scripts load `playwright-core` and a Chrome/Chromium binary. Install them separately (`npm i -D playwright-core`) or point `PLAYWRIGHT_CORE` at an installed module and `CHROME_PATH` at your browser; nothing is downloaded automatically.

Developed against DeepSeek Harness `0.2.1-rc.5` (Linux, headless Chrome + SwiftShader). Windows Win32 tracking still benefits from real-machine acceptance runs.

### Project layout

```
client/            DSH client module (browser half, no build step)
desktop/           Electron overlay: main process, preload, seat geometry, Win32 window reader, vendored koffi
lib/               Host half: routes, model resolution, agent tools, desktop runtime manager/downloader
locale/            en / zh UI strings
public/            runtime assets: pet.js bundle, VRM model, motions.json, thumbnails, notices
scripts/           build, screenshots, end-to-end checks, VRM repair/rebuild helpers
src/pet/           pet engine source (Three.js + three-vrm), bundled into public/pet.js
test/              node:test suites and HTML fixtures
```

## Troubleshooting

| Symptom                                                         | What to check                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| She never appears                                               | Is the plugin enabled in **插件**? Is she hidden (sidebar 🐋 / Settings recall)? Check **版本 · 诊断信息** for the page and host version.                   |
| The settings page is empty                                      | The host side failed to load; look at the Harness log for `whale-mate:` messages.                                                                           |
| Desktop mode says the runtime could not be downloaded           | Set `electron` (or `DSH_WHALE_MATE_ELECTRON`) to an Electron executable, or install the offline Windows runtime included in the release bundle, then retry. |
| Desktop window exits immediately (`Cannot find module 'koffi'`) | Fixed in 0.5.10 by vendoring `desktop/vendor/koffi/`; make sure the installed package contains it (the npm/GitHub package does).                            |
| Window tracking unavailable                                     | Windows native tracking needs the official Desktop Host; other launchers fall back to page coordinates.                                                     |
| Model looks wrong / has black spikes                            | Use a repaired VRM (`scripts/repair-vrm.py`) and check it is VRM 0.x/1.0 with MToon materials.                                                              |

## Limits

- Spring-bone physics is only added for models with separate hair/skirt/tail bone chains (VRoid style). A model whose hair is a single mesh skinned to the head (like DeepSeek Reset) has no hair sway.
- The long skirt has no cloth simulation. Sitting relies on the "seated" morph and spring bones, so there is a little clipping under extreme poses.
- She only follows live events of the session in the main view; tool calls in background sessions don't reach her.
- One pet per browser tab. Settings (size, show/hide, seat position) are stored in that browser's localStorage.
- Windows Win32 calls, mixed-DPI physical monitors and focus/click-through still benefit from a real-machine acceptance run.
- Native tracking is scoped to the official Windows Desktop Host entry and its parent shell process. Koffi 3.1.0 ships prebuilt Windows x64/ia32 binaries; Windows ARM64 is not validated.

## License

- **Code**: MIT — see [`LICENSE`](LICENSE).
- **`deepseek-reset.vrm`**: by bilibili [@hihihihi202](https://space.bilibili.com/3546568969947566). Free to modify and redistribute with credit; **no commercial use**. See [`ASSET_LICENSES.md`](ASSET_LICENSES.md).
- **Third-party motion/expression data**: clips converted from GI-Engine / Mate-Engine (AGIA by Clean Curve Studio; Shiny) are **not** MIT and are not licensed for redistribution by this project. They remain under their original terms; copyright stays with the original authors. Quaternius clips are CC0. See [`public/animation-notices/`](public/animation-notices/) and [`ASSET_LICENSES.md`](ASSET_LICENSES.md).
- **Dependencies**: three.js and three-vrm are MIT; Electron and koffi are MIT.

## Acknowledgements

This project stands on a lot of other people's work. Thank you.

### Projects and libraries

| Project                                                                                          | Author / source                                 | Used for                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------- |
| **DeepSeek Harness (DSH)**                                                                       | DeepSeek                                        | Host platform, plugin APIs, web server, session events         |
| **Cordis**                                                                                       | DeepSeek / cordis                               | Plugin and loader runtime                                      |
| [three.js](https://threejs.org/)                                                                 | mrdoob and contributors (MIT)                   | 3D rendering                                                   |
| [@pixiv/three-vrm](https://github.com/pixiv/three-vrm)                                           | pixiv Inc. (MIT)                                | VRM loading, MToon, expressions, spring bones                  |
| [Electron](https://www.electronjs.org/)                                                          | OpenJS Foundation (MIT)                         | Desktop overlay window (downloaded, not bundled)               |
| [koffi](https://koffi.dev/)                                                                      | Niels Martignène (MIT)                          | Native Win32 window queries on Windows                         |
| [esbuild](https://esbuild.github.io/)                                                            | Evan Wallace (MIT)                              | Bundling `src/pet` into `public/pet.js`                        |
| [GI-Engine](https://github.com/Nekoluna-dot/GI-Engine)                                           | Nekoluna-dot; AGIA assets by Clean Curve Studio | AGIA FBX idle / walk / wave motions (converted locally)        |
| [Mate-Engine](https://github.com/Shiny-Engine)                                                   | Shiny                                           | Additional motion and expression sources                       |
| [Quaternius Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | Quaternius (CC0)                                | 10 full-skeleton locomotion / idle clips                       |
| [VRoid Studio](https://vroid.com/)                                                               | pixiv Inc.                                      | CC0 `AvatarSample_4` base for the earlier whale-maid character |
| [Blender](https://www.blender.org/) + [VRM Add-on](https://vrm-addon-for-blender.info/)          | Blender Foundation / SATO Yusuke                | Model export and material conversion pipeline                  |

### Models and artwork

- **DeepSeek Reset** (`public/deepseek-reset.vrm`) — original character by **bilibili @hihihihi202**. Re-exported from `DeepSeek_Reset_4K_Lite.blend` with orientation fixes, MToon baking, expression binding and metadata. The author allows modification and redistribution with credit; commercial use is forbidden.
- **希可儿 (whale-maid)** — built on VRoid Studio's CC0 `AvatarSample_4` (Victoria Rubin) with a new maid outfit, long hair, fin ears and tail; the character design follows reference art supplied for this project. Not shipped in 0.6.x.
- **Motion and expression data** — AGIA (Clean Curve Studio), GI-Engine, Mate-Engine and Quaternius; see the licence section above and [`ASSET_LICENSES.md`](ASSET_LICENSES.md).

### Thanks

- To the DeepSeek Harness team for the plugin system and the `pet_*` tool pattern this project builds on.
- To everyone who filed issues, tested desktop mode and contributed translations.

---

[中文文档](README.zh-CN.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)
