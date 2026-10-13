# Emoji Exporter 1.0.0 — Android 真机待验证版

从 Discord 已加载的服务器缓存导出 PNG / GIF / ZIP。适用于提供 **Vendetta 兼容 API** 的 Revenge、Vendetta，以及加载此类内核的 RevengeXposed。RevengeXposed 是加载器，不能仅凭它的名字判断插件格式。没有冒充已经在 Android 14–16 实机运行成功。

## 网络地址安装

在 Revenge 设置 → 插件 → `+` 粘贴下面的目录网址，安装并启用：

```
https://raw.githubusercontent.com/sonouemuimi/server-tag-info/main/emoji-exporter/dist/emoji-exporter/
```

打开 Emoji Exporter 的插件设置即可选择服务器。无需运行 Termux。源码和构建位于仓库独立的 `emoji-exporter/` 目录，不修改其他插件。

下面的本地安装方式仅用于开发调试。

### 手机上用 Termux 临时安装

1. 将交付的 `Emoji-Exporter-1.0.0.zip` 下载到手机 Download 目录。
2. 打开 Termux 执行：

```sh
termux-setup-storage
pkg install python unzip
mkdir -p "$HOME/emoji-exporter-package"
unzip -o "$HOME/storage/downloads/Emoji-Exporter-1.0.0.zip" -d "$HOME/emoji-exporter-package"
cd "$HOME/emoji-exporter-package/emoji-exporter"
python serve.py
```

如果下载目录或文件名不同，调整 unzip 那一行。保持 Termux 运行，在 Revenge 设置 → 插件 → `+` 粘贴：

```
http://127.0.0.1:8765/emoji-exporter/
```

该地址仅在同一手机的本地服务运行期间有效。服务只监听本机，只提供 `dist/` 构建目录；不会暴露 Termux 的其他文件。安装并启用后打开插件设置。安装、更新时保持服务运行；部分内核每次启动检查来源，关闭服务可能显示更新失败。长期使用建议自行托管到 HTTPS。

此本地 HTTP 安装方式仍需目标客户端验证：如果内核禁止明文 HTTP，需要 HTTPS 托管；不要为此关闭系统安全设置。

### 自行托管到 HTTPS

将 `dist/emoji-exporter/` 中的 manifest.json 与 index.js 放在同一公开静态目录，用目录 URL 安装（网址最后保留 `/`）。例如 GitHub Pages。**不能把 Library 下载链接或源码 ZIP 链接填进插件 URL 框**。

本版是稳定的设置页入口，未向原生表情选择器插入按钮。ZIP 是源码和构建文件的交付容器，**不是 Revenge Next 原生 ZIP 插件格式**。只支持 Next 的内核请勿直接导入。不会修改 ServerTagInfo 或其他插件。

## 使用

1. 正常打开目标服务器的原生表情面板，让 Discord 自己加载表情。
2. 打开 Emoji Exporter 设置，选择服务器。
3. 查看“已加载”数量。插件不保证缓存完整，始终显示“完整性未验证”。数量不符时回到原生表情面板，再点“重新读取缓存”。刷新仅重新读内存。
4. 搜索名称、全选、清空、仅选静态/动态，或逐项勾选。全选和格式筛选作用于完整的已加载列表，不受搜索过滤影响。
5. 点击“预览”加载该表情缩略图（同时只保留一张预览，避免大量 GIF 动画占内存），或“下载单张”保存原图。不会自动预取图片。
6. 点击导出选中 / 全部已加载，查看处理进度、已保存数量和失败数量。可取消；失败项需手动重试，没有自动重试。
7. 完成后可复制保存路径；若检测到 RNShare，则提供系统文件分享按钮，由你选择保存应用。

## 保存位置与重要限制

已验证开源定义的 Discord NativeFileModule / RTNFileManager / DCDFileManager 提供 `writeFile('documents', path, base64, 'base64')`，没有可跨版本保证的 SAF “另存为”接口。因此本版**没有直接调用 Android 系统文件选择器**。

实际路径由原生接口返回，显示在结果卡片；每次任务使用独立子目录 `emoji-exporter/<任务编号>/`，防止覆盖前次文件。

- 如果客户端有 `RNShare.open`，可点击系统分享；这条适配需真机验证，不能保证 Discord 附带 RNShare。
- 如果没有分享桥接，界面会提前提示。文件仅写入 Discord 私有目录，**不会声称保存到了 Download**。有 root 时，用 MT 等文件管理器打开结果中显示的绝对路径，将 ZIP 复制到 Download。非 root 且无分享桥接的设备，本版不能完成将文件交付到公共存储的最后一步。
- 不申请全部文件访问权限、不增加 Android 权限、不自动发送文件或消息。
- 服务器图标采用占位标记；本版不为服务器图标额外联网。

## ZIP 与内存

通常生成 `服务器名称_emojis.zip`，内有 `服务器名称/表情名称_ID.png` 或 `.gif` 和 `manifest.json`。重复名称以 ID 区分；文件名过滤路径字符，服务器与表情 ID 始终用字符串。

manifest 只含服务器名称/ID、时间、表情名称/ID、文件名、animated、分包和缓存完整性标记，不含认证信息。每个分包只列出实际存入该包的表情。

没有可靠的原生 append/ZIP 流写接口，所以采用有界打包：**每包最多 8 MiB 图片或 500 张**，超过后生成 `_part2.zip` 等独立可解压文件。单张超过 2 MiB 会报错，不强行载入。此上限控制图片数据，不代表整个进程峰值仅 8 MiB；ZIP 复制、base64 和原生桥接都会暂占额外内存。

取消保留已落盘文件，丢弃未写入的当前分包；因此“已处理”可能大于“已保存”。下载失败可直接重试；写盘失败会显示明确错误，需要重新选择并导出。重试只生成失败项的新文件，不修改旧 ZIP。保存记录仅保留在当前设置页会话中；文件持续留在原生返回的位置，可自行删除。

## 数据与网络边界

只读 `GuildStore` 已知且非 unavailable 的服务器；优先 `EmojiStore.getGuilds()[id].emojis`，兼容候选 Store 的 `getGuildEmoji(id)` 及 GuildStore 对象已有的 `emojis`。这些后备 getter 在客户端现场检测，未假定一定存在。缺少明确 boolean `animated` 的记录会跳过，不能靠名称或 URL 猜测。

唯一图片传输代码为独立 XHR：官方 CDN `/emojis/<真实ID>.png|gif`，GET、`withCredentials=false`、不设账号认证头、不使用 Discord REST 模块。无 Token、Cookie、localStorage 读取、账号 API、WebSocket、自机器人、遥测、第三方服务、定期后台任务或消息发送。连接顺序执行（并发 1），30 秒超时，遇 429 停止剩余请求，由用户稍后手动重试。

检查返回 PNG/GIF 文件头并保留原始字节，不截图、不重编码、不猜特殊格式。如果 CDN 返回 HTML、WebP 等不符格式则报错。检查最终响应 URL；底层 RN 网络实现可能自动处理 HTTP 跳转，本版无法控制它的底层行为，实际无认证头/无 Cookie 请求行为仍须在目标 RN 版本验证。

禁用插件会中止当前 XHR、清空页面内存和本插件监听器。本版不注册 Discord 聊天/表情选择器 Hook，不改消息发送逻辑。第三方客户端插件依然可能受到 Discord 平台规则约束，不承诺绝对无风险。

## 更新

将新构建替换到同一托管目录后，使用 Revenge 插件更新功能或重载（取决于内核设置）。本地安装需先启动本地服务。构建时生成 SHA-256 hash，供加载器检测更新。不要重复安装两个地址。

开发者修改 `src/` 后：

```
npm run build
npm test
```

Node.js 18+，没有 npm 依赖，无需 `npm install`。提交源码和 `dist/emoji-exporter/` 两个构建文件，保持安装网址不变。项目自己的 CI 仅测试，不自动发布其他插件。

## 测试状态

本地 Node 测试 13 项通过：严格元数据、ID 精度、去重/跨服务器过滤、Unicode/安全文件名、Base64、独立 Python 解包/CRC、GIF 字节保留、XHR 参数/超时/取消、格式/HTTP/尺寸错误、ZIP 分包、写入错误、429 停止、Store/原生桥接模拟、Vendetta 表达式加载/卸载。

**未完成**：Android 14/15/16 真机、实际 Discord Store 形状/完整性、实际 CDN 返回与客户端网络栈、原生写盘、RNShare、浅深色视觉布局、Revenge Next、原生表情分组入口。模拟测试通过不等于上述验证通过。

## 故障反馈

插件设置里“复制兼容性诊断”只复制 Store/方法是否可用、文件桥接能力、数据来源名，不复制表情列表、服务器名称或账号资料。连同 Discord 版本、Revenge 内核版本、出现错误的步骤反馈，可用于精确适配。不要提交 Token 或账号凭证。

详细研究依据见 `RESEARCH.md`。
