# 希可儿 · deepseek-mate

[![CI](https://github.com/mymde/deepseek-mate/actions/workflows/ci.yml/badge.svg)](https://github.com/mymde/deepseek-mate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-whale-mate.svg)](https://www.npmjs.com/package/dsh-plugin-whale-mate)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**DeepSeek Harness 的 3D 桌宠插件。** 安装后希可儿出现在 Harness 网页里，坐在聊天输入框上沿：会呼吸、眨眼、用眼睛和头跟着鼠标，DeepSeek 思考时托腮，回复时跟着流式文字开口说话；切到桌面模式后还能坐到任意窗口顶边和任务栏上。

> **命名说明。** 项目/仓库名是 **deepseek-mate**，插件包名（安装标识）仍是 **`dsh-plugin-whale-mate`**，保持不变是为了不破坏已安装实例、配置键和本地存储的设置。角色名是**希可儿**。

[English](README.md) · [更新日志](CHANGELOG.md) · [素材许可](ASSET_LICENSES.md) · [贡献指南](CONTRIBUTING.md)

![希可儿](public/thumbs/avatar.png)

---

## 目录

- [她会做什么](#她会做什么)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [桌面模式](#桌面模式)
- [模型](#模型)
- [配置](#配置)
- [智能体工具](#智能体工具)
- [实现方式](#实现方式)
- [开发](#开发)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [许可](#许可)
- [致谢](#致谢)

## 她会做什么

| 场景                        | 表现                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 待机                        | 呼吸、眨眼、晃腿，眼睛和头跟着鼠标。偶尔伸懒腰、走动、坐到边上，或做个小动作。3 分钟没有互动会打瞌睡。               |
| 你发消息                    | 点头回应。                                                                                                           |
| DeepSeek 思考中             | 手托下巴，气泡显示「…」。                                                                                            |
| DeepSeek 回复               | 嘴型跟着流式文字动；气泡先显示回复的最新片段，结束后显示回复开头。                                                   |
| 请求失败                    | 难过、摇头，气泡里说明原因（例如「没有配置 API key」）。                                                             |
| 拖动她                      | 从抓取点垂下来随你摆动；松手会掉落或被抛出，落到下方卡片的顶边或窗口底部。窗口顶部太靠上、头会被切掉的表面会被跳过。 |
| 双击                        | 挥手打招呼。                                                                                                         |
| 点头部 / 在头上左右移动鼠标 | 摸头：眯眼微笑。                                                                                                     |
| 点身体                      | 被吓一跳。                                                                                                           |
| 右键                        | 圆形转盘：你收藏的动作和表情、窗口/桌面模式切换、隐藏。                                                              |
| 设置                        | **设置 → 希可儿桌宠**：形象、模式、大小、右键转盘内容、诊断信息。                                                    |

角色完全在本地运行：插件自带 Three.js / three-vrm 引擎和 VRM 形象，本身不调用任何大模型；气泡里的文字来自它所跟随的 Harness 会话。

## 环境要求

- **DeepSeek Harness**：官方桌面版（推荐）或 `dsh web`，版本 `0.2.1` 及以上。
- **系统**：Windows 10/11、macOS、Linux（X11）。桌面模式的窗口跟踪在 Windows 上最完整，详见[桌面模式](#桌面模式)。
- **Node.js 22+**：只有从源码构建或跑测试时需要。安装插件不需要工具链。
- 不需要 Unity、不需要 Blender、不需要单独的程序。桌面模式首次使用时会自行下载 Electron 运行时（也可以复用你已有的）。

## 安装

### 安装源

**添加插件** 输入框接受三种来源：

| 来源            | 示例                                                                                       | 说明                                  |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| npm 包名        | `dsh-plugin-whale-mate@0.6.3`                                                              | 已发布到 npm：`dsh-plugin-whale-mate` |
| GitHub 仓库地址 | `https://github.com/mymde/deepseek-mate.git#v0.6.3` 或 `github:mymde/deepseek-mate#v0.6.3` | 本仓库，固定到版本标签                |
| 本地绝对路径    | `/绝对路径/deepseek-mate` 或 `.tgz`                                                        | 离线安装与开发调试                    |

三种都能用。建议带上版本号或标签（`@0.6.3`、`#v0.6.3`），重复安装时结果可复现。

### DeepSeek Harness Web（`dsh web`）

```sh
# 从 npm 安装
dsh plugin --profile web add dsh-plugin-whale-mate@0.6.3

# 从 GitHub 安装，固定到版本标签
dsh plugin --profile web add github:mymde/deepseek-mate#v0.6.3

# 或本地目录 / 压缩包
dsh plugin --profile web add /绝对路径/deepseek-mate
dsh plugin --profile web add /绝对路径/dsh-plugin-whale-mate-0.6.3.tgz
```

重启 `dsh web` 并打开页面，希可儿会坐在输入框上沿。

### DeepSeek Harness 官方桌面版

桌面版使用自己的 `desktop` profile，`--profile web` 管不到它。两种方式：

1. 在应用里打开 **插件 → 添加插件**，填 `dsh-plugin-whale-mate@0.6.3`、仓库地址
   `https://github.com/mymde/deepseek-mate.git#v0.6.3`，或解压后插件目录的绝对路径；
2. 或者用应用自带的 `dsh` 命令（**应用菜单 → 管理 dsh 命令…**）：完全退出桌面版，执行
   `dsh plugin --profile desktop add dsh-plugin-whale-mate@0.6.3`（或 `github:` 形式），再重新打开应用。

### 升级与卸载

插件管理器不允许直接覆盖已安装的包：

1. 完全退出 Harness；
2. 在 **插件** 里移除旧插件；
3. 添加新版本并重启。

**设置 → 希可儿桌宠 → 版本 · 诊断信息** 会显示实际运行的版本（页面端和后台端），可以用来确认升级是否生效。

## 使用

- **侧边栏**：🐋 希可儿按钮显示/隐藏她；再次显示一定会回到输入框上。
- **右键**：圆形转盘，包含设置里选好的动作/表情（最多 6 个）、**窗口模式 / 桌面模式**切换和**隐藏**。
- **设置 → 希可儿桌宠**：形象、模式、大小（160–640 px）、右键转盘内容、叫她回来、诊断信息。
- **大小**按浏览器保存在 localStorage 里，桌面模式使用同一尺寸。

## 桌面模式

在页面里她永远出不了 Harness 窗口。桌面模式会打开一个透明、置顶、可点击穿透的桌面窗口，让她搬到桌面上：

- 开启桌面模式后自动坐到 **Harness 窗口顶边**，窗口移动时跟着走；
- 可以拖到屏幕任意位置；只有她可见的像素接收鼠标，其余部分点击穿透到下面的应用；
- Harness 最小化或隐藏到托盘时叠加层一起隐藏，恢复时回到原来的位置；
- 窗口贴着屏幕顶部（包括最大化）时，座位会向内收，保证头不被切掉；
- 回复、思考、错误和 `pet_*` 工具在桌面上同样生效。

从右键转盘（到桌面上去）或 **设置 → 希可儿桌宠 → 桌面模式** 开启；从桌面上的右键菜单（回到 Harness 窗口里）或同一处设置关闭。选择会被记住。

### 运行时来源

叠加层是一个 Electron 窗口，运行时按以下顺序选择：

1. 插件配置里的 `electron`（或 `DSH_WHALE_MATE_ELECTRON`）——你已有的 Electron 可执行文件路径；
2. Harness 后台本身运行在 Electron 主进程时，直接复用；
3. 否则首次使用时从 npmmirror 镜像（GitHub 备选）下载对应系统的 **Electron 44.10.2**（Windows 约 150 MB），用发布页的 `SHASUMS256.txt` 校验，解压到 `~/.dsh-whale-mate/runtime/`（可用 `DSH_WHALE_MATE_HOME` 改位置）。不开启桌面模式就不会下载任何东西。

桌面模式只在运行 Harness 的那台机器上有效：控制路由只接受回环请求，并且位于 Harness 的登录校验之后。远程或无显示的主机会在设置里显示原因。配置 `desktop: false` 会彻底关掉桌面模式。Linux 上叠加层以关闭 sandbox 的 Chromium 运行（解压出来的运行时没法带 setuid helper），并且只从带 token 的回环地址加载插件自己的文件。

### 配置示例

```yaml
- id: whale-mate
  config:
    desktop: true # false：不要桌面模式
    electron: C:/tools/electron/electron.exe # 可选：用这个运行时，跳过下载
```

## 模型

### 内置模型

| id                       | 模型           | 说明                                                                                                                 |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `deepseek-reset`（默认） | DeepSeek Reset | **使用本模型请注明 B站 @hihihihi202**（https://space.bilibili.com/3546568969947566）。原作者允许修改，**禁止商用**。 |

**设置 → 希可儿桌宠** 会显示当前模型的作者和署名要求（从 VRM 元数据读取）。

早期的 VRoid 模板形象（`whale-maid.vrm`，18.7 MB）从 0.6.2 起**不再随包发布**，安装包因此从 21.6 MB 降到 9.1 MB。它的 CC0 底模说明保留在 [`ASSET_LICENSES.md`](ASSET_LICENSES.md)；你仍然可以通过 `model` 配置使用自己拥有的任意 VRM。

### 使用自己的 VRM

把 `model` 设为 Harness 主机上一个 `.vrm` 文件的绝对路径（支持 VRM 0.x 和 1.0）：

```yaml
- id: whale-mate
  config:
    model: /path/to/your-avatar.vrm
    modelName: 我的角色 # 设置页显示名（可选）
```

也可以使用环境变量 `DSH_WHALE_MATE_MODEL=/path/to/x.vrm`。修改后重启 `dsh web` 生效。模型文件只提供给本机已登录的用户，不会上传到任何地方。

### 修复导出的模型

从 Blender 导出的模型常有下面这些问题。`scripts/repair-vrm.py` 会修好并写出新文件，绝不修改原文件。

| 选项                                | 修复内容                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--rest-from-bind`                  | 骨架 rest 姿态和网格对不上。按蒙皮逆绑定矩阵重建 rest 姿态。                                      |
| `--face +x`                         | 角色朝向错误。旋转网格和骨架，让角色朝向 +Z（VRM 1.0 的要求）。                                   |
| `--unlit-emission`                  | 颜色全在自发光里（基础色为黑），在 three.js 里发白。把这些材质转成 unlit，并用 AgX 映射保持观感。 |
| `--expressions map.json`            | 形态键没有绑到 VRM 表情（不会眨眼、做表情、对口型）。按名字绑定。                                 |
| `--patch-materials` / `--add-image` | 补回导出丢失的贴图（脸、头发、虹膜）。                                                            |
| `--nudge` / `--thicken`             | 修共面层的 z-fighting（虹膜和眼白），以及桌宠尺寸下细到看不见的嘴部线条。                         |
| 始终启用                            | 去掉恒定的顶点色、去掉 unlit 网格的形态法线、把形态键存成稀疏 accessor，通常能把文件缩小数倍。    |

### 从 `.blend` 重建默认模型

`scripts/build-deepseek-reset.sh DeepSeek_Reset_4K_Lite.blend`（Blender 5.2 + VRM Add-on 4.10）会：把角色转向镜头、把 HoYoverse/原神卡通材质烘焙成贴图并转成 MToon、绑定 13 个标准表情以及 `jito` / `wink` / `tehe`、写入署名元数据，并用 `repair-vrm.py` 瘦身。产物约 13 MB。`scripts/tune-mtoon.py` 可以在不重建的情况下调整 MToon 描边和明暗。

## 配置

插件配置写在 profile 的 `cordis.patch.yml` 里：

```yaml
- id: whale-mate
  config:
    desktop: true
    electron: null
    model: null
    modelName: null
    tools: true
```

| 键          | 类型    | 默认   | 含义                                              |
| ----------- | ------- | ------ | ------------------------------------------------- |
| `desktop`   | boolean | `true` | `false` 完全关闭桌面模式及其路由。                |
| `electron`  | string  | —      | Electron 可执行文件的绝对路径，跳过下载。         |
| `model`     | string  | —      | 内置 id（`deepseek-reset`）或 `.vrm` 的绝对路径。 |
| `modelName` | string  | —      | 自定义模型在设置页的显示名。                      |
| `tools`     | boolean | `true` | `false` 时不注册 `pet_*` 工具。                   |

环境变量：

| 变量                      | 作用                             |
| ------------------------- | -------------------------------- |
| `DSH_WHALE_MATE_MODEL`    | 等同于 `model`，配置为空时生效。 |
| `DSH_WHALE_MATE_ELECTRON` | 等同于 `electron`。              |
| `DSH_WHALE_MATE_HOME`     | 桌面运行时下载后的解压位置。     |

## 智能体工具

智能体可以通过三个工具控制她（`tools` 不为 `false` 时才注册）：

| 工具             | 作用                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pet_say`        | 在气泡里说一句话（`text`，可选 `expression`），建议 60 字以内。                                                                                                                   |
| `pet_expression` | 设置表情并保持 `seconds` 秒（1–30，默认 4）：`neutral`、`happy`、`angry`、`sad`、`relaxed`、`surprised`、`blink`。                                                                |
| `pet_action`     | 做一个动作：`wave`、`nod`、`shake`、`cheer`、`bow`、`stretch`、`shy`、`dance`、`jump`、`sit`、`stand`、`walk`、`sleep`、`wake`、`home`，以及 `public/motions.json` 里的全部动作。 |

这些工具只做确认；浏览器端的叠加层监听会话事件流并执行动作，所以不需要额外的后台↔浏览器通道。

## 实现方式

- **后台（`lib/index.js`）**
  - 在 `/whale-mate/` 下提供 `public/` 里的引擎和模型，位于 Harness 自己的登录校验之后（未登录请求返回 401）；
  - 注册三个 `pet_*` 工具（只做确认）；
  - 挂载桌面模式路由，并把校验过的命令转发给叠加层。
- **桌面叠加层（`lib/desktop.js`、`desktop/`）**
  - `lib/desktop.js` 负责找到或下载运行时，用 Node IPC 启动 `desktop/app.cjs`（或进程内运行叠加层），校验后通过 `POST /whale-mate/desktop/send` 把页面消息转给叠加层；
  - `desktop/main.cjs` 在 Harness 所在显示器的工作区上开一个透明窗口，从随机回环端口提供 `overlay.html`、`pet.js` 和模型；按她每个像素的命中测试切换点击穿透（Windows/macOS）或在她周围设置输入形状（Linux），并轮询系统光标；
  - Windows 官方桌面版上，`desktop/harness-window.cjs` 用 Koffi 只读取启动官方 Host 的 shell 进程的窗口（DWM 可见边框、物理像素转 Electron DIP、50 ms 轮询）。其他应用不会成为座位；
  - Web / 非 Windows 上由页面每 200 ms 上报 `window.screenX/Y`、尺寸和可见性，这个回退方案没有原生跟踪的保证。
- **浏览器端（`client/client.js`）**：手写的 DSH 客户端模块（安装时不需要构建），加载 `public/pet.js`，通过 `sessions` 服务跟随主视图会话，用实时文字、运行状态和 `tool/call` 事件直接驱动桌宠。
- **引擎（`src/pet/`，连同 three.js 和 three-vrm 打包成 `public/pet.js`）**
  - 叠加层：透明的 `position:fixed` 层，逐像素命中测试；
  - 姿态系统：移动状态、手势层、看向和根运动混合后平滑到每根骨骼；
  - 物理：运行时为头发、裙子和尾巴添加 70 根弹簧骨；
  - 面部：情绪混合、随机眨眼、按文字驱动的口型。

## 开发

```sh
npm install
npm run build        # src/pet -> public/pet.js（缺少模型时也会复制）
npm test             # 后台路由、原生跟踪、座位几何、FFI（Linux 需要 C 编译器）

npm run lint         # ESLint（flat config）
npm run format        # Prettier 格式化
npm run format:check  # 只检查格式，不写文件

node scripts/check-pet.mjs           # 在模拟页面（test/harness.html）上截图
node scripts/pose-gallery.mjs        # 每个姿势的正/侧面截图
node scripts/mock-llm.mjs 18790      # 端到端测试用的 OpenAI 兼容 mock 模型
node scripts/check-dsh.mjs '<带 ?token= 的 dsh 地址>'   # 在真实 Harness 里做端到端检查
node scripts/check-clip.mjs          # 回归：不会出现头被切掉的座位
```

桌面模式检查（Linux + Xvfb；软件渲染时设 `WHALE_MATE_ELECTRON_FLAGS="--use-gl=angle --use-angle=swiftshader"`）：

```sh
xvfb-run -s "-screen 0 1600x900x24" node scripts/check-desktop.mjs <electron> [outDir]
DISPLAY=:77 node scripts/check-dsh-desktop.mjs '<带 ?token= 的 dsh 地址>' [outDir]
```

截图和端到端脚本需要 `playwright-core` 和 Chrome/Chromium。请自行安装（`npm i -D playwright-core`），或用 `PLAYWRIGHT_CORE` 指向已安装的模块、用 `CHROME_PATH` 指向浏览器；脚本不会自动下载。

开发验证基于 DeepSeek Harness `0.2.1-rc.5`（Linux，无头 Chrome + SwiftShader）。Windows 的 Win32 跟踪仍建议在真机上做一次验收。

### 目录结构

```
client/            DSH 客户端模块（浏览器端，无需构建）
desktop/           Electron 叠加层：主进程、preload、座位几何、Win32 窗口读取、内置 koffi
lib/               后台：路由、模型解析、智能体工具、桌面运行时管理与下载
locale/            中英文界面文案
public/            运行时资源：pet.js 打包产物、VRM 模型、motions.json、缩略图、素材声明
scripts/           构建、截图、端到端检查、VRM 修复/重建脚本
src/pet/           桌宠引擎源码（Three.js + three-vrm），打包进 public/pet.js
test/              node:test 测试与 HTML 测试页
```

## 常见问题

| 现象                                                 | 排查                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 她一直不出现                                         | **插件** 里是否启用？是否被隐藏（侧边栏 🐋 / 设置里的「叫她回来」）？看 **版本 · 诊断信息** 里页面端和后台端的版本。 |
| 设置页是空的                                         | 后台加载失败；在 Harness 日志里找 `whale-mate:` 开头的消息。                                                         |
| 桌面模式提示运行时下载失败                           | 把 `electron`（或 `DSH_WHALE_MATE_ELECTRON`）指向已有的 Electron，或使用发布包里的 Windows 离线运行时，然后重试。    |
| 桌面窗口一启动就退出（`Cannot find module 'koffi'`） | 0.5.10 起已通过内置 `desktop/vendor/koffi/` 修复；确认安装包里有这个目录（npm/GitHub 包都带）。                      |
| 窗口跟踪不可用                                       | Windows 原生跟踪需要官方桌面版 Host；其他启动方式会退回页面坐标。                                                    |
| 模型显示异常 / 有黑色细刺                            | 用 `scripts/repair-vrm.py` 修复 VRM，并确认是 VRM 0.x/1.0、使用 MToon 材质。                                         |

## 已知限制

- 只有带独立头发/裙子/尾巴骨骼链的模型（VRoid 风格）才会自动添加弹簧骨物理。头发是单网格蒙在头上的模型（如 DeepSeek Reset）没有头发摆动。
- 长裙没有布料模拟。坐下依赖「坐姿」形态键和弹簧骨，极端姿势下会有轻微穿模。
- 她只跟随主视图会话的实时事件；后台会话里的工具调用不会传给她。
- 每个浏览器标签页一只桌宠。大小、显示/隐藏、座位位置等设置存在该浏览器的 localStorage 里。
- Windows 的 Win32 调用、混合 DPI 多显示器和焦点/点击穿透仍建议真机验收。
- 原生跟踪限定在官方 Windows 桌面版 Host 入口及其父 shell 进程。koffi 3.1.0 提供 Windows x64/ia32 预编译二进制，Windows ARM64 未验证。

## 许可

- **代码**：MIT，见 [`LICENSE`](LICENSE)。
- **`deepseek-reset.vrm`**：作者 B站 [@hihihihi202](https://space.bilibili.com/3546568969947566)。允许修改与再分发但**必须署名**，**禁止商用**。详见 [`ASSET_LICENSES.md`](ASSET_LICENSES.md)。
- **第三方动作/表情数据**：从 GI-Engine / Mate-Engine 转换的片段（AGIA，Clean Curve Studio；Shiny）**不属于 MIT**，本项目也未获得再分发授权，版权归原作者，按原条款使用；Quaternius 片段为 CC0。详见 [`public/animation-notices/`](public/animation-notices/) 与 [`ASSET_LICENSES.md`](ASSET_LICENSES.md)。
- **依赖**：three.js、three-vrm、Electron、koffi 均为 MIT。

## 致谢

这个项目站在很多人的工作上，感谢他们。

### 参考的项目与库

| 项目                                                                                             | 作者 / 来源                                    | 用途                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------- |
| **DeepSeek Harness（DSH）**                                                                      | DeepSeek                                       | 宿主平台、插件 API、Web 服务、会话事件       |
| **Cordis**                                                                                       | DeepSeek / cordis                              | 插件与加载器运行时                           |
| [three.js](https://threejs.org/)                                                                 | mrdoob 及贡献者（MIT）                         | 3D 渲染                                      |
| [@pixiv/three-vrm](https://github.com/pixiv/three-vrm)                                           | pixiv Inc.（MIT）                              | VRM 加载、MToon、表情、弹簧骨                |
| [Electron](https://www.electronjs.org/)                                                          | OpenJS Foundation（MIT）                       | 桌面叠加层窗口（按需下载，不随包分发）       |
| [koffi](https://koffi.dev/)                                                                      | Niels Martignène（MIT）                        | Windows 原生窗口查询                         |
| [esbuild](https://esbuild.github.io/)                                                            | Evan Wallace（MIT）                            | 把 `src/pet` 打包成 `public/pet.js`          |
| [GI-Engine](https://github.com/Nekoluna-dot/GI-Engine)                                           | Nekoluna-dot；AGIA 素材作者 Clean Curve Studio | AGIA 待机 / 行走 / 挥手 FBX 动作（本地转换） |
| [Mate-Engine](https://github.com/Shiny-Engine)                                                   | Shiny                                          | 追加动作与表情来源                           |
| [Quaternius Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | Quaternius（CC0）                              | 10 段完整骨骼的移动 / 待机动作               |
| [VRoid Studio](https://vroid.com/)                                                               | pixiv Inc.                                     | 早期鲸鱼女仆形象的 CC0 `AvatarSample_4` 底模 |
| [Blender](https://www.blender.org/) + [VRM Add-on](https://vrm-addon-for-blender.info/)          | Blender Foundation / SATO Yusuke               | 模型导出与材质转换流程                       |

### 使用的模型与美术

- **DeepSeek Reset**（`public/deepseek-reset.vrm`）——角色原作者 **B站 @hihihihi202**。由 `DeepSeek_Reset_4K_Lite.blend` 重新导出，做了朝向修正、MToon 烘焙、表情绑定和元数据写入。原作者允许修改与署名再分发，禁止商用。
- **希可儿（鲸鱼女仆）**——基于 VRoid Studio 的 CC0 `AvatarSample_4`（Victoria Rubin），新增深蓝女仆服、围裙、头饰、长发、鳍耳和鲸尾；角色设计依据本项目提供的参考图。0.6.x 不再随包发布。
- **动作与表情数据**——AGIA（Clean Curve Studio）、GI-Engine、Mate-Engine 与 Quaternius，详见上面的许可说明和 [`ASSET_LICENSES.md`](ASSET_LICENSES.md)。

### 特别感谢

- DeepSeek Harness 团队提供的插件系统，以及本项目沿用的 `pet_*` 工具模式。
- 所有提 issue、帮忙测试桌面模式和参与翻译的人。

---

[English](README.md) · [更新日志](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md)
