# Hide Blocked Messages — 无占位测试修复版

适用于普通 Revenge / Revenge Xposed 的 Vendetta 兼容插件接口，版本 `1.0.0-test3`。
针对原 HideBlockedAndIgnoredMessages 留下 `[Filtered message. Check plugin settings.]` 的问题重写过滤逻辑。

## 安装

先关闭原来的 **HideBlockedAndIgnoredMessages**（或其他隐藏屏蔽消息插件），再到 Revenge → 插件 → + 添加：

```text
https://raw.githubusercontent.com/sonouemuimi/server-tag-info/main/hide-blocked-messages/
```

安装启用后，**强行停止 Discord 并重新打开**，清除原插件已经生成的占位行。
不需要修改手机文件、不需要安装 Python。这个目录是独立插件，旧插件可以保留为关闭状态用于回退。
两者存储独立，旧插件的开关不会自动转移。

## 开关

| 开关 | 默认 | 行为 |
|---|---|---|
| 隐藏被屏蔽用户的消息 | 开 | 过滤被屏蔽用户的消息，不生成自定义占位提示 |
| 隐藏被忽略用户的消息 | 开 | Discord 有 `isIgnored` 接口时生效 |
| 同时隐藏其他人回复他们的整条消息 | 开 | 回复目标已确认被屏蔽/忽略时，隐藏整条回复 |
| 保留回复时隐藏被屏蔽者的引用 | 开 | 上一项关闭时，只去掉自动回复引用，保留回复正文、附件等 |

修改开关、改变屏蔽状态或更新版本后，**强行停止并重新打开 Discord**，让消息重新从服务器加载。
插件不会删除服务器上的消息。正文中的手工引用、截图和普通 @ 提及不属于自动回复预览。

## test3：保留成员资料，同时覆盖直接读取消息缓存的列表

手机反馈：test2 的昵称颜色不再掉，但仍显示“1 条被屏蔽信息”。test2 只处理 `getMessages().toArray()`，无法覆盖绕过这个接口的读取路径；目前没有手机运行时日志，不能确定具体绕过方式。

test3 增加 **MessageStore 专属事件处理**：

- 对 `LOAD_MESSAGES_SUCCESS`、`MESSAGE_CREATE`、`MESSAGE_UPDATE`，只过滤交给 MessageStore 的那一份数据。
- 不 Hook 全局 `dispatch`，不修改共享事件对象；成员资料等其他 Store 仍接收完整原始事件，包括隐藏消息里的昵称、身份组等资料。
- 被屏蔽/忽略消息不再写入该消息缓存，直接读取缓存的列表也不会拿到这些消息来生成屏蔽占位。
- 保留回复时，给 MessageStore 传去引用后的消息副本；原始引用仍保留在其他 Store 收到的事件中。
- 原有集合读取过滤作为已缓存消息的补充；不修改 RowManager，不生成英文占位，也不派发伪造消息事件。
- 同时处理已缓存的 Flux 有序处理器及依赖缓存重建后的处理器。必要入口缺失时撤销补丁并明确报错，避免只显示已启用却没有核心过滤。

事件入口参考同一移动端插件仓库的 `customVoiceMessages/src/patches/messagePatches.ts`：
<https://github.com/shipwr3ckd/revengeplugin/blob/master/plugins/customVoiceMessages/src/patches/messagePatches.ts>
只借鉴定位方式；本插件不会直接改写共享事件里的消息内容。

## 已验证与限制

`node test-plugin.cjs` 通过 **25 项模拟集成测试**。包含绕过 `toArray` 直接读缓存、历史/实时屏蔽消息、忽略消息、回复副本隔离、成员资料完整传递、Flux 缓存重建、卸载恢复和一个模拟 NoDelete 全局删除拦截共存场景。
这些测试没有使用真实 Discord Android 消息列表；**test3 尚需手机实测**。NoDelete 测试是行为模拟，不代表所有版本组合都已验证。

- test3 会改变 MessageStore 中的本地缓存；其他读取这个缓存的功能也可能看不到被过滤消息。成员资料 Store 接收的事件保持完整。
- 关闭插件会撤销 Hook，但不会自动补回已过滤的消息；必须重新加载历史。修改屏蔽状态/开关后也需要重新加载。
- 更新后必须强行停止并重开，清除 test2 已经留下的消息缓存和 UI 行。
- 插件只针对上述三个已知消息事件；未知加载路径、搜索、成员列表、表情反应、正在输入和通知不在已验证范围内。
- 对已有缓存的原地编辑、屏蔽状态变化，补充读取过滤不一定覆盖所有界面；重新加载频道后再验证。
- 引用作者和目标消息都不在缓存或会话作者索引时，无法可靠判定，不会把未知/已删除引用一律当成屏蔽消息。
- 不要与原 HideBlockedAndIgnoredMessages 同时开启。
- 会话作者索引最多 10,000 项，不写盘；关闭插件时清理索引并撤销所有 Hook。

遇到问题请提供截图、插件版本/开关及 Discord / Revenge 版本；如有报错，复制报错文字即可，无需账号 Token 或完整消息数据库。

## 回退

关闭此插件，重新开启原插件，然后强行停止并重新打开 Discord。可正常卸载此插件。

## 源码与校验

`index.js` 本身就是可读源码和可安装产物；修改后运行 `python3 build.py` 更新 manifest 的 SHA-256，再运行 `node test-plugin.cjs`。

原项目：<https://github.com/shipwr3ckd/revengeplugin/tree/master/plugins/HideBlockedAndIgnoredMessages>
原作者：Zykrah、シグマ siguma。原仓库使用 CC0-1.0；本目录沿用 CC0-1.0，见 LICENSE。
这是独立测试修复版，并非原作者或 Revenge 官方发布。
