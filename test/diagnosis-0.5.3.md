# 0.5.3 启动问题定位

现场反馈：Windows 点击「到桌面上去」后菜单关闭，角色继续留在页面。当前没有用户电脑的运行日志，不能确认现场根因。

真实浏览器复现（加载实际 0.5.2 客户端与实际角色菜单，Host 返回可控下载状态）：

```json
{"requestSent":true,"menuClosed":true,"runtimeDownloading":true,"feedbackElements":0,"petSuspended":false}
```

已确认：旧版右键开启无即时反馈，下载进度与启动报错仅能在设置中看到。缺失的自定义 Electron 文件也会导致 start 静默返回。尚未证明用户电脑命中了哪一种。

0.5.3 修正反馈与诊断；真实菜单点击验证：下载进度显示、HTTP 500 启动错误显示且不被后续状态轮询覆盖、失败后页面角色保留，3/3 通过。单元测试 16/16 通过。没有修改原生窗口跟踪实现，没有声称解决所有 Windows 启动故障。

下一步需要用户点击后的设置诊断：download、running、ready、lastExit、tracking，以及前后端版本。0.5.3 额外记录最近 start 请求和相关进程 PID。
