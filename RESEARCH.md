# 研究记录

研究日期：2026-10-04。以下为实际拉取阅读的源码和确定的边界。

## 插件列表

读取 https://plugins-list.pages.dev/ 和它加载的 `/plugins-data.json`，列表包含 166 项。
其中没有发现描述为“读取私人 Server Tag 对应服务器本地信息”的现成插件。
`Show Tag` 的描述是显示用户名 discriminator，不是 Server Tag。
选用 `Song Spotlight`、`ReviewDB` 的资料页 Patch 方式作为 API 依据；用服务器信息插件核对 `GuildStore.getGuild`。
没有使用 GuildLurk 的加入/访问机制。

## 已确认的现有 Revenge API

仓库：https://github.com/revenge-mod/revenge-bundle

阅读版本：`1b1d297416594087769987908e5fc09af36b7e6e`

- `src/core/vendetta/plugins.ts`：URL 安装读取 `manifest.json`，再读取 `main` JS；评估形式为 `vendetta => { return <plugin JS> }`。生命周期是 `onLoad`/`onUnload`，设置组件是 `settings`。
- `src/core/vendetta/api.tsx`：确认 `metro.common.React`/`ReactNative`、`FluxDispatcher`、clipboard、patcher、Store 查找器都暴露给插件。
- `src/lib/api/patcher.ts`：现有 API 的顺序是 `instead(methodName, parent, callback)`，callback 收到 `(args, originalFunction)`。
- `src/metro/internals/modules.ts`：实际模块记录结构为 `isInitialized`、`publicModule.exports`、`__filePath`；通用 finders 可 require 模块。因此本插件不使用全量 findAll，而只枚举已初始化模块。

交付 JS 是能返回生命周期对象的自执行表达式，符合实际加载器。manifest 内 `hash` 为最终 JS 的 SHA-256，`main` 为 `index.js`。

## 现有移动端插件依据

### Song Spotlight

https://github.com/nexpid/RevengePlugins

阅读版本：`e10e86ef79e7e3cb777c38ecaa9b8f63abe50abc`

- `src/plugins/song-spotlight/src/stuff/patcher.ts`：资料页组件 `UserProfileBio`、`UserProfileAboutMeCard`、`SimplifiedUserProfileAboutMeCard` 和 `YouAboutMeCard`；Patch 导出的 `default` 函数。
- `src/stuff/components/ActionSheet.tsx`：`ActionSheet`、`openLazy(Promise<{default: Component}>, key, props)`、`hideActionSheet()` 的用法。

### ReviewDB

https://github.com/janisslsm/vdplugins

阅读版本：`1931ec73d438b8d8732c7a9c005c30efa4525a62`

- `plugins/ReviewDB/src/patches/patchProfile.ts`：可 Patch React memo 对象的 `type`，资料页 `userId`/`user.id` 的获取和 React 子节点扩展。
- `plugins/ReviewDB/src/components/ActionSheet.tsx`：移动端 Bottom Sheet API。

### ServerInfo / BetterInbox

https://github.com/fshinz/Revenge-Plugins

阅读版本：`857e861a79f08db37dcda476d99c58a97c847e0c`

- `plugins/ServerInfo/src/components/ServerInfoView.tsx`：通过 `findByStoreName('GuildStore')` 定位，`getGuild(guildId)` 读取已有服务器。
- `plugins/BetterInbox/src/notifications.ts`：同样使用 `GuildStore.getGuild`。

本插件只观察 secondary Guild Store 已有 getter 的原调用，不自行调用 `getGuildProfile`/`getGuildPreview`，不引入上述插件中的网络功能。

## Discord 标签字段

官方源码：https://github.com/discord/discord-api-docs/blob/main/developers/resources/user.mdx

阅读版本：`c43598daadbefb8afaba48ca74824a15180a8219`

确认 API User 上为 `primary_guild`，其对象有：

- `identity_guild_id`：可空 snowflake。
- `identity_enabled`：可空布尔值，用户隐藏标签时可为 false。
- `tag`：可空字符串。
- `badge`：可空图片 hash。

该官方结构没有服务器名称。没有名称的正常结果必须由插件显式显示。
Android 运行时可能经过 User model 转换；插件以实际对象上存在的键识别 snake_case / camelCase，并打印字段路径和实际键列表；不写死 `user.primary_guild` 这一条访问路径。

**不能据此宣称 Android 当前 User model 的具体键名已经静态验证。** 本任务未取得用户 APK/bundle、实机调试器或运行数据。因此 Server Tag 组件最终名称及原生消息标题事件不能确认；运行期模块匹配和日志负责在安装后验证。

## Revenge Next 格式

官方模板：https://github.com/revenge-mod/revenge-plugin-template

阅读版本：`d47f792150f4dcc4f47aace6227f8b8c52aa84de`

JS-only 插件 ZIP 根目录包含 `manifest.json` 和 `index.js`，manifest `format: 1`，`dist.script: 'index.js'`，声明 `revenge.api` 和 `discord` 依赖。

API 仓库：https://github.com/revenge-mod/revenge-bundle-next

阅读版本：`481056836bb9682b82945e58d7f2e672ffcf9717`

- `lib/plugins/src/_internal/external-plugins.ts`：JS 的返回值 `.default` 是 `plugin({...})` 生命周期配置。
- `lib/plugins/src/apis/react.ts`：React / ReactNative 位于 `api.unscoped.react`。
- `lib/plugins/src/apis/modules.ts`：提供初始化模块查找器和 module subscription。
- `lib/modules/src/finders/filters/constants.ts`：可限制 `FilterScopes.Initialized`；本插件设 `initialize: false`。
- `lib/modules/src/metro/subscriptions/index.ts`：`onAnyModuleInitialized((id, exports) => ...)`。
- `lib/patcher/src/hooks/instead.ts`：Next 使用 `instead(parent, key, callback)`，与 legacy 的参数顺序不同。

两种适配分别构建，没有混用 manifest 或 Patcher 参数顺序。依赖范围遵照当前模板，尚未在 Next Android 实测。

## 测试结论

14 项模拟集成测试：官方及动态结构、字符串 ID、GuildStore 优先、错 ID/错名称防护、会话缓存、未提供名称、已导出 cache、原点击保留、无 identity 时不接管、晚加载资料页、禁用/重启、两套真实 loader 表达式格式。

这些测试不等于 Android 真机兼容性验证，也没有反向验证 Discord 私有模块的 getter 内部实现。插件没有额外请求的 HTTP/WS 能力，只读取/观察当前客户端对象。
