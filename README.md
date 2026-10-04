# ServerTagInfo 1.0.1

Android Discord 的 Revenge / Revenge Xposed 插件。只查看客户端已经持有的 Server Tag 信息，不请求私人服务器资料。

## GitHub 网址安装（普通 Revenge）

在 **Revenge → 插件 → +** 粘贴下面的网址，安装并启用，然后重启 Discord：

```text
https://raw.githubusercontent.com/sonouemuimi/server-tag-info/main/
```

通过这个 GitHub 地址安装后，可以开启插件自动更新。无需运行 Termux 或本地服务。

源码修改后运行 `python3 build.py`，将源代码与重新生成的 `manifest.json`、`index.js` 一起提交。Revenge 根据 manifest 中的 JS hash 检测更新。

## 安装包

- 普通 Revenge / Revenge Xposed：按上面的 Raw 网址安装。仓库根目录的 `manifest.json` 和 `index.js` 是完整插件。
- Revenge Next：下载 `ServerTagInfo-Next-1.0.1.zip`，通过支持 ZIP 的插件安装入口导入。普通 Revenge 的网址安装界面不能导入这个 ZIP。
- `ServerTagInfo-Source-1.0.1.zip`：完整源码和构建文件备份。
- Revenge Xposed 是加载器；使用哪种格式取决于它加载的 JS 内核。

## 使用

- 匹配到 Server Tag 组件时，点击标签打开本地信息。弹窗内保留 **打开 Discord 原服务器资料** 按钮，只有点击这个按钮才执行原点击行为。
- 识别到相应资料页组件时，会增加 **查看服务器标签本地信息** 按钮。
- 如果当前版本的标签组件没有匹配，打开插件设置，输入**目标用户 ID**，点击 **读取已缓存用户的服务器标签**。先正常打开该用户资料可让 Discord 自行加载数据；插件不主动获取用户资料。
- 插件设置中可 **刷新模块匹配**、**复制调试日志**、**清空会话缓存和日志**。

显示：服务器名称、标签、服务器 ID、图标/徽章哈希、标签启用状态、数据来源，以及实际持有的简介、成员数和功能。缺失名称显示 **客户端未提供**，不会当成异常。

## 数据边界

1. 当前 `GuildStore.getGuild(id)`。
2. 已初始化模块和服务器 Store 中已存在的 guild 数据容器。
3. 本插件在本次会话内观察到的 Discord 缓存读取结果。
4. 当前用户/资料对象中已有的、ID 与目标一致的服务器对象。

服务器 ID 始终使用字符串。不同服务器、用户名、标签文字不能作为名称猜测来源。只观察 Discord 原本执行的缓存 getter 和 Flux dispatch，不改变它们的结果，不主动调用 profile fetch，也不 force-require 未加载模块。

不使用第三方查询 API、私人资料接口或 REST 请求。不会调用 `fetch`、XHR、Discord HTTP API 或 WebSocket。缓存和调试日志仅存在内存中，禁用插件后清空；退出账号时也会清空会话数据。不会永久保存离开服务器后的历史资料。

**图标说明**：哈希不等于已经取得图片。只有数据对象直接提供 `file://`、`content://` 或 `data:image/` 本地图片地址时才显示缩略图；普通 CDN 图标哈希显示为文字，插件不会为此下载图片。这样 Android 图片缓存标志失效时也不会产生额外网络请求。

## 调试

需要至少保存以下日志：

```text
[ServerTagInfo] coverage = ...
[ServerTagInfo] identity schema = ...
[ServerTagInfo] hook installed = ...
[ServerTagInfo] tag clicked
[ServerTagInfo] identity_guild_id = ...
[ServerTagInfo] guild cache result = ...
[ServerTagInfo] guild name = ...
[ServerTagInfo] cache stages = ...
[ServerTagInfo] cache surface = ...
[ServerTagInfo] guild resolution = ...
```

`tag hooks=0` 表示尚未识别到标签组件；不是“服务器一定没有名称”。可等待打开用户资料后，去插件设置刷新匹配。`guild cache result` 为 miss 而名称为空，是正常的“客户端未提供”。

日志只记录匹配结构、目标标签服务器 ID、名称和来源，不会输出账号 token、消息正文或完整用户资料。发回日志时也请带 Discord 版本、Revenge 内核版本，并说明点击标签是否有变化。

## 验证范围与限制

已核对 Revenge 实际加载器、官方 Next 模板、现有资料页/ActionSheet 插件和 Discord 官方 `primary_guild` 结构；详情见 `RESEARCH.md`。已经通过 19 项 Node 模拟集成测试。

用户已在 Discord **344.13 (344013)**、Revenge **1b1d297-main** 测试 1.0.0：资料页入口和标签点击可打开信息，GuildStore 中的名称能读取；未命中缓存的标签显示“客户端未提供”。运行日志确认 UserStore 的路径为 `UserStore.getUser.primaryGuild`，字段为 `identityGuildId`、`identityEnabled`、`tag`、`badge`。1.0.1 根据这些日志收紧组件匹配，并增加缓存诊断，更新版本仍需设备复测。纯原生消息标题或改名后的组件可能无法直接 Hook，已提供资料页和插件设置入口。

没有名称时无法恢复服务端未发来的信息；不会伪造数据。旧会话缓存可能有旧名称，界面显示数据来源。Secondary Store 的私有闭包缓存没有公开数据时无法读到，不会反射或调用未验证的请求接口。

## 源码与构建

零构建依赖：Python 3 打包，Node.js 运行验证。

```bash
python3 build.py
node test.js
```

- `core.js`：字段识别、本地 guild 解析、React UI、组件 Hook、日志。
- `legacy.js`：现有 Revenge / Vendetta 兼容 API 适配。
- `next.js`：Revenge Next API 适配。
- `manifest.json` 和 `index.js`：可以通过 URL 安装的普通 Revenge 插件。
- `ServerTagInfo-Next-1.0.1.zip`：Next 格式安装包，根目录是 manifest 和 JS。

本插件为独立实现，不是 Revenge 官方插件。

## 1.0.1 更新

- 只匹配标签点击组件，排除 guild_tag 工具函数、动作和徽章绘制函数，避免 1.0.0 的 68 个宽泛 Hook。
- 支持 Map、带下划线的 guild 容器及直接以 ID 索引的导出 cache；仍要求缓存对象内有一致的服务器 ID。
- 缺少名称时记录各缓存阶段的命中情况，以及主要 Store 的方法/容器键名；不会额外调用未知 getter。`cache stages` 的 miss 只表示当前可读取来源未命中，不证明客户端所有私有缓存均为空。
