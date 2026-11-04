# Contributing to deepseek-mate · 贡献指南

Thanks for helping! This project is a DeepSeek Harness plugin with a Three.js/three-vrm pet engine.

感谢参与！这是一个带 Three.js / three-vrm 桌宠引擎的 DeepSeek Harness 插件。

---

## English

### Before you start

- Read [`README.md`](README.md) and [`ASSET_LICENSES.md`](ASSET_LICENSES.en.md).
- For a bug, include: Harness version, OS, plugin version (**Settings → 希可儿桌宠 → 版本 · 诊断信息**), steps to reproduce, and the `whale-mate:` lines from the Harness log.
- For a feature, open an issue first so the design can be discussed.

### Development setup

```sh
npm install          # installs devDependencies (Node.js 22+)
npm run build        # src/pet -> public/pet.js
npm test             # node:test suites
npm run lint
npm run format:check
```

Build artefacts (`public/pet.js`, `client/client.js`) are committed so the plugin can be installed straight from GitHub; rebuild `public/pet.js` whenever you change `src/pet/`.

### Code style

- Formatting is enforced by Prettier (`.prettierrc.json`): no semicolons, single quotes, 120 columns, no trailing commas.
- Linting is enforced by ESLint (`eslint.config.js`). Run `npm run lint` before opening a PR.
- Editor defaults live in `.editorconfig` (UTF-8, LF, 2-space indent, final newline).
- Keep the host half (`lib/`) free of browser globals and the client half (`client/`) free of Node built-ins.
- Do not add runtime dependencies to `dependencies`. The package deliberately ships without `node_modules`; native code is vendored under `desktop/vendor/` and dev tooling stays in `devDependencies`.
- Prefer small, focused modules and named exports; keep the public surface of `lib/index.js` documented with JSDoc.

### Tests

- Add a `node:test` case for every host-side behaviour you change (routes, model resolution, desktop commands, runtime download).
- Desktop / Xvfb checks are Linux-only; note in the PR if you could not run them.
- Do not weaken existing assertions to make a change pass.

### Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, `chore:`.
- One logical change per PR; describe the user-visible effect and how you verified it.
- Update `CHANGELOG.md` for user-visible changes, and the READMEs when behaviour or configuration changes.
- Bilingual docs: when you change user-facing behaviour, update both `README.md` and `README.zh-CN.md`.

### Assets and licensing

- **Do not add** third-party models, motions, textures or music without a licence that permits redistribution.
- AGIA / GI-Engine / Mate-Engine motion data is **not** MIT and is not licensed for redistribution; keep changes to that data out of pull requests unless you have written permission from the rights holder.
- If you add an asset that may be redistributed, record its author, source URL, licence and required credit in [`ASSET_LICENSES.md`](ASSET_LICENSES.md) and [`ASSET_LICENSES.en.md`](ASSET_LICENSES.en.md).
- Never commit secrets, personal paths, API keys or model files you do not have rights to.

---

## 中文

### 开始之前

- 先读 [`README.zh-CN.md`](README.zh-CN.md) 和 [`ASSET_LICENSES.md`](ASSET_LICENSES.md)。
- 报 Bug 请附：Harness 版本、操作系统、插件版本（**设置 → 希可儿桌宠 → 版本 · 诊断信息**）、复现步骤，以及 Harness 日志里 `whale-mate:` 开头的行。
- 新功能请先开 issue 讨论设计，避免白做。

### 开发环境

```sh
npm install          # 安装 devDependencies（需要 Node.js 22+）
npm run build        # src/pet -> public/pet.js
npm test             # node:test 测试
npm run lint
npm run format:check
```

构建产物（`public/pet.js`、`client/client.js`）会提交进仓库，这样可以直接从 GitHub 安装；改过 `src/pet/` 就要重新构建 `public/pet.js`。

### 代码规范

- 格式由 Prettier 约束（`.prettierrc.json`）：不加分号、单引号、120 列、不加尾逗号。
- 静态检查由 ESLint 约束（`eslint.config.js`），提交 PR 前跑 `npm run lint`。
- 编辑器默认值在 `.editorconfig`（UTF-8、LF、2 空格缩进、文件末尾换行）。
- 后台代码（`lib/`）不要使用浏览器全局对象；浏览器代码（`client/`）不要使用 Node 内置模块。
- 不要在 `dependencies` 里加运行时依赖。这个包刻意不带 `node_modules`；原生代码放在 `desktop/vendor/`，开发工具放 `devDependencies`。
- 模块尽量小而聚焦，用具名导出；`lib/index.js` 的对外接口要有 JSDoc。

### 测试

- 改动后台行为（路由、模型解析、桌面命令、运行时下载）时，补一个 `node:test` 用例。
- 桌面 / Xvfb 检查只能在 Linux 跑；没跑请在 PR 里说明。
- 不要为了让改动通过而放宽已有断言。

### 提交与 PR

- 使用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`build:`、`chore:`。
- 一个 PR 只做一件事；写清用户可见的变化和你的验证方式。
- 用户可见的改动要更新 `CHANGELOG.md`；行为或配置变了要同时改两份 README。
- 双语文档：改用户可见行为时，`README.md` 和 `README.zh-CN.md` 都要更新。

### 素材与许可

- **不要**加入没有再分发许可的第三方模型、动作、贴图或音乐。
- AGIA / GI-Engine / Mate-Engine 的动作数据**不是** MIT，也没有再分发授权；除非拿到权利人书面许可，否则不要把这些数据放进 PR。
- 加入可再分发的素材时，在 [`ASSET_LICENSES.md`](ASSET_LICENSES.md) 和 [`ASSET_LICENSES.en.md`](ASSET_LICENSES.en.md) 里记录作者、来源 URL、许可和署名要求。
- 不要提交密钥、个人路径、API key，或你没有权利提交的模型文件。
