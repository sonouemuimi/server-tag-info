# 研究依据与适配边界

研究日期：2026-10-13。以下均为实际读取的开源代码；未把网页上的桌面 Discord Store 列表当作 Android 真机结论。

1. Vendetta 插件格式与安装网址：
   https://github.com/vendetta-mod/plugin-template
   模板 build.mjs 输出 IIFE 表达式、manifest.json、SHA-256 hash。
2. Vendetta 兼容加载器：
   https://github.com/revenge-mod/revenge-bundle/blob/main/src/core/vendetta/plugins.ts
   加载器以 `vendetta => { return <source> }` 执行表达式；插件返回生命周期与 settings。此项目构建器直接生成同等表达式，不依赖 npm 打包器。
3. Discord 原生文件接口：
   https://github.com/revenge-mod/revenge-bundle/blob/main/src/lib/api/native/modules/types.ts
   https://github.com/revenge-mod/revenge-bundle/blob/main/src/lib/api/native/modules/index.ts
   检查 NativeFileModule、RTNFileManager、DCDFileManager 与 TurboModule 代理。原生接口定义有 base64 写入和路径返回，没有确认通用 SAF / append / ZIP 方法，因此没有捏造这些调用。
4. Android 本地表情 Store 实例：
   https://github.com/aliernfrog/vd-plugins/blob/main/plugins/Stealmoji/modules.ts
   https://github.com/aliernfrog/vd-plugins/blob/main/plugins/Stealmoji/ui/components/AddToServerRow.tsx
   使用 findByStoreName('EmojiStore')，以及 EmojiStore.getGuilds()[guild.id]?.emojis。这是主要读缓存适配的依据。本项目不复制其表情上传/克隆功能或源代码。
5. 文件操作参考：
   https://github.com/maisymoe/strife/blob/main/plugins/MigrationStation/src/lib/files.ts
   存在 downloadMediaAsset(data URI) 的用例，但这不足以证明任意 ZIP 的 SAF 保存行为。本版未将图片下载函数伪装成 ZIP 保存接口。
6. RNShare：
   https://react-native-share.github.io/react-native-share/docs/share-open
   仅在原生 RNShare.open 能力存在时使用文件 URI。不能假定 Discord 附带该模块；缺失时提前显示私有目录限制。
7. 最新 Revenge 原生模板：
   https://github.com/revenge-mod/revenge-plugin-template
   与传统 Vendetta 格式不同，包含 format/id/dependencies/dist 字段与可选 plugin.jar。本次交付明确为 Vendetta 兼容版，不给传统 JS 包贴上 Next 兼容标签。

## 结论

能开发缓存读取、预览、下载、ZIP 和兼容性 UI，并对纯逻辑做自动化验证。不能在没有手机或目标 Discord bundle 的情况下确认“当前客户端完整缓存”或全部原生文件行为。插件现场检测失败时关闭相关操作，不退回 Token / REST 补全方案。

## 真机验收清单（尚未执行）

- 在目标 Discord + Revenge 内核安装，打开插件设置无崩溃。
- 打开含静态与动态表情的服务器表情面板后，对照已加载数量。
- 未加载、 unavailable、离开服务器、缺少 animated 的情况不能猜测完整性。
- 抓包确认仅主动操作时请求官方 CDN，且无账号认证头和 Cookie。
- 单张 PNG、动画 GIF 保存后能打开；ZIP 解压后动画保留。
- 多选、搜索、全选、取消、断网、HTTP 429、存储不足反馈清晰。
- 对超过 8 MiB 的集合验证分包及进程内存；取消后不再继续网络请求。
- 实测原生返回路径与 RNShare（如有）；没有分享桥接时走 root 文件管理器。
- 禁用、重新启用、退出设置页、重启 Discord 后聊天和表情发送正常。
