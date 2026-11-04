# 0.5.2 验证记录

- 对照官方源码：8bd073392eef6f54e921a093b95076248eb08cbb。未修改官方源码。
- `npm test`：15/15，包括真实 Koffi 调用 C ABI 夹具，验证回调、DWORD 输出、UTF-16、带负坐标的 RECT。夹具不等同 Windows DLL。
- `check-harness-window.cjs`：11/11。真实 Electron 窗口、真实 WebGL 模型；Linux 仅替换原生窗口读取器，窗口移动/隐藏/恢复/销毁均由真实 BrowserWindow 执行。未启动完整官方桌面应用。
- `check-spawn.mjs`：5/5。继承 RunAsNode 时能启动独立 Electron；第一次位置报告默认坐窗；隐藏、恢复、停止通过。
- `npm run build` 和 JS 语法检查通过；npm pack 包含新增 tracker 和 seat 模块，Koffi 为锁定版本的运行时依赖。

限制及未通过的扩展验证：

- Windows 原生 DLL、官方桌面完整安装、多显示器混合 DPI、系统合成和点击穿透尚未实机验收。
- Linux 的叠加层 PNG 有透明 alpha、坐姿可见；当前 Xvfb/xcompmgr 的全桌面截图背景为黑色，不能当作完整视觉效果证据。
- 原有长时间鼠标拖拽脚本 `check-desktop.mjs` 在本环境通过启动、默认坐窗和光标命中检查后超过 120 秒，未宣称其整套拖拽验证通过。此次新增进程及窗口状态回归已分别通过。
