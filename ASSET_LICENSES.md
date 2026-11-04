# 素材来源与使用说明

[English](ASSET_LICENSES.en.md)

## DeepSeek Reset 模型（`deepseek-reset.vrm`，默认角色）

- **使用本模型请注明 B站 @hihihihi202**：https://space.bilibili.com/3546568969947566
- 原作者允许修改，**禁止商用**。本插件免费开源，不收取任何费用；转载、二次分发请保留本段说明。
- 本插件中的版本由 `DeepSeek_Reset_4K_Lite.blend` 重新导出：朝向修正、HoYoverse/Genshin 卡通材质烘焙为 MToon、表情绑定到原有形态键、去除重复描边网格。导出脚本见 `scripts/blender/export-deepseek-reset.py`。
- VRM 元数据已写入：作者 hihihihi202 (bilibili)、个人非营利、需署名、允许修改与再分发。

## 希可儿模型（`whale-maid.vrm`，可选）

### 基础模型

- Victoria Rubin / VRoid Studio β AvatarSample_4，pixiv Inc.
- 模型下载镜像：https://github.com/madjin/vrm-samples/blob/master/vroid/beta/Victoria_Rubin.vrm
- 官方许可：https://vroid.pixiv.help/hc/en-us/articles/360014900233
- 官方将此基础模型标为 CC0；下载文件内 VRM meta.licenseName 亦为 CC0。
- 当前角色保留其面部、表情、人体、骨架及部分头发；新增深蓝女仆服、围裙、头饰、长发、鳍耳、鲸尾。

## 参考图及衍生角色

参考图来自本次用户上传，仅用于本次原型制作。其角色和图像权利不因底模为 CC0 而转为 CC0。若对外发行，应按参考图权利人的授权范围使用。

## 代码依赖

预览器使用 Three.js 0.169.0、@pixiv/three-vrm 3.3.3，均使用 MIT 许可证；许可证保存在 vendor 目录。
桌面模式使用 Electron（MIT）。插件本身不包含 Electron，只在用户开启桌面模式时从官方发布（或其镜像 npmmirror）下载，并按 SHASUMS256.txt 校验。构建需要 Blender 4.2.3 和 VRM Add-on 4.10.3。

## 当前范围

这是模板改造原型。VRM 包含骨骼和表情，动作由预览页面实时驱动，在 DeepSeek Harness 插件中本地运行；不包含 Unity 工程、额外的对话服务或独立桌宠安装包。长裙暂不支持坐下和大步行走；尾鳍与长发末端使用简化弹簧，未完成完整碰撞配置。

## 0.5.5 本地试用动作（`public/motions.json`）

- 来源：Nekoluna-dot/GI-Engine，commit `7544dab99f1d1509a2e61ed995b13f4ae4f4145e`。
- 实际资源：`AGIA_Idle_generic_01.fbx`、`AGIA_Other_walking_01.fbx`、`AGIA_Other_waving_arm_01.fbx`，以及各自 `.meta` 中的 Humanoid 映射与参考骨架。
- AGIA 原作者：Clean Curve Studio（Anime Girl Idle Animations）。资源产品采用 Unity Asset Store EULA，不是 MIT / CC0 素材：https://assetstore.unity.com/packages/3d/animations/anime-girl-idle-animations-free-150406 。此链接用于确认资源系列及作者，不能证明当前全部文件属于免费版。
- GI-Engine / Mate-Engine 的资产说明还要求 Shiny 署名、非商业使用，并限制素材单独再分发。原文保留于 `public/animation-notices/GI-Engine-LICENSE.md`。
- 转换在本地个人工作区完成；本项目仓库按维护者决定公开托管了转换结果。转换不改变原素材授权；**不将此动作数据声明为 MIT，也不为其授予任何再分发许可**。版权归原作者；权利人提出要求时，维护者会立即从仓库和发布包中移除相应片段。商业使用或单独再分发前，请先取得原作者授权。
- 插件骨骼播放器与转换脚本由本项目实现，不复制 GI-Engine / Mate-Engine 引擎源码。未包含 FBX 模型、贴图、音乐、原神动作或 Unity 工程。
- 转换方式：根据 `.meta` 的真实参考骨架，将采样后的全局旋转差转换成人形局部四元数；51 个骨骼通道，包含手指，30 fps；保留来源文件 SHA-256。不是把 Unity muscle 数值直接当欧拉角。
- 限制：行走 FBX 存在多个动画层，当前 Three.js FBXLoader 仅读取首层；本地预览已能看到步态，但不宣称与 Unity 所有层完全一致。此次尚未移植 Mate-Engine 的 Humanoid `.anim`，也未实现通用 `.vmd` 腿部 IK 求解。

## 0.5.6 动作库扩展来源

- Mate-Engine（Shiny），commit `2c5ea6b8f4cf5e1773a0816b46d9267cda5174d4`；GI-Engine commit 与上节相同。
- 包含 AGIA 的 14 个 FBX 片段转换结果，以及两个仓库按 SHA-256 去重后的 9 个表情曲线转换结果。每项的原路径、原文件哈希与重复来源保存在 `public/motions.json` 的 `clips` / `catalog` 中。
- Mate-Engine 原许可证副本：`public/animation-notices/Mate-Engine-LICENSE.md`。上节 AGIA、Shiny 与 GI-Engine 的素材条款同样适用；转换后的动画与表情不改标为 MIT。
- 目录中的待转换资源只保留文件名、哈希和状态，未把它们打包为动画数据。UI 不显示授权说明，原始声明保留在包内供统一整理。

## 0.5.7 新增 Quaternius 动作

- 作者：Quaternius / Gonzalo Furnier。素材系列：Universal Animation Library（Standard，CC0）。官方来源：https://quaternius.itch.io/universal-animation-library 。
- 获取方式：官方页面在本服务器返回 HTTP 403，因此使用公开 glTF 镜像 `J-Ponzo/gltf-universal-animation-library`，固定 commit `e24c23cf2a1323488a3faa226ea7ea21f644b73e`（镜像说明为 2025-06-10 Standard 版本）。没有使用付费 Pro 或 Source 版。镜像地址：https://github.com/J-Ponzo/gltf-universal-animation-library/tree/e24c23cf2a1323488a3faa226ea7ea21f644b73e 。
- 许可副本：`public/animation-notices/Quaternius-CC0.txt`。
- 从同一 glTF 中选取 10 段：Idle_Loop、Idle_Talking_Loop、Dance_Loop、Interact、PickUp_Table、Sitting_Idle_Loop、Sitting_Talking_Loop、Crouch_Idle_Loop、Walk_Formal_Loop、Walk_Loop。
- 来源 SHA-256 是原始 glTF 字节后顺序拼接外部 buffer 字节的摘要；每段另记录原 clip 名称，不能把它们视为 10 个独立源文件。按原始皮肤 joint 列表核对映射，利用作者 A_TPose 转换 52 个人形骨骼，包含手指。采样为 30 fps；省略水平根位移，坐姿由插件窗沿定位控制骨盆高度。
- 新素材作为替代动作使用，不声称恢复了 Mate-Engine / GI-Engine 缺失的主体轨迹。本次未打包 VRoid 官方七动作包或增加软件依赖。

## koffi 3.1.0（desktop/vendor/koffi）

- 来源：npm 包 `koffi` 3.1.0（JS 加载器）和 `@koromix/koffi-win32-x64` 3.1.0（`koffi.node` 预编译二进制），https://koffi.dev ，作者 Niels Martignène。
- 许可：MIT，全文见 `desktop/vendor/koffi/LICENSE.txt`。
- 用途：仅在 Windows 桌面模式下读取窗口位置（不读标题或内容）。
