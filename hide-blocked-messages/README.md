# Hide Blocked Messages — 无占位测试修复版

适用于普通 Revenge / Revenge Xposed 的 Vendetta 兼容插件接口，版本 `1.0.0-test1`。
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

修改开关后强行停止并重开 Discord。被过滤掉的历史消息需要重新加载才能恢复。
插件不删除 Discord 服务器上的消息。正文中的手工引用、截图、普通 @ 提及不属于自动回复预览，不会据此删除正常消息。

## 改动

- 用 `instead(dispatch)` 真正阻止已识别的屏蔽消息事件进入客户端处理流程；不再仅改动 `channelId`。
- 历史消息先记录作者 ID，再过滤，因此同一页中回复目标的先后顺序不影响识别。
- 支持 `referenced_message` / `referencedMessage`、`message_reference` / `messageReference`，并用已见到的作者 ID 或本地 MessageStore 补充引用信息。
- 对带 `toArray()` 的缓存消息集合提供过滤视图；保持原始消息缓存和原始消息对象不被改写。
- 不再清空 `message.content`、不修改 `RowManager`、不生成英文占位提示，也不分发伪造启动消息。
- 关闭插件时撤销 Hook 并清空会话内作者索引。作者索引最多保存 10,000 项，不写入磁盘、不记录消息正文、不上传数据。

## 已验证与限制

`node test-plugin.cjs` 覆盖实时消息、历史分页、缓存列表、部分更新、两种引用字段、未知引用、冻结记录、原始对象不变、开关和卸载恢复、缺少接口等模拟场景。
这些是本地模拟集成测试，**没有在 Discord 344.13 / 用户手机上完成实测**，所以标为 test1。

- 如果 Discord 的列表绕过 `getMessages().toArray()`，缓存渲染可能还有未覆盖的路径，需要根据设备反馈继续适配。
- 引用作者和被引用消息都不在客户端缓存时，不能可靠判断是否被屏蔽；不会把所有未知/已删除引用误判为屏蔽消息。
- 插件启用前已经生成的 UI 行，需要退出频道或重启客户端重新加载。
- 改变用户屏蔽状态后，重新进入频道；列表下次读取时会按当前关系过滤。
- 不承诺隐藏成员列表、表情反应、搜索结果、正在输入状态和系统通知等所有入口。
- 不要与旧隐藏插件同时开启，尤其旧插件会改写共享消息对象和生成占位行。

遇到问题请提供 Discord / Revenge 版本、对应开关、是实时新消息还是重新进入频道后的历史消息，以及截图。无需提供账号 Token 或完整消息数据库。

## 回退

关闭此插件，重新开启原插件，然后强行停止并重新打开 Discord。可正常卸载此插件。

## 源码与校验

`index.js` 本身就是可读源码和可安装产物；修改后运行 `python3 build.py` 更新 manifest 的 SHA-256，再运行 `node test-plugin.cjs`。

原项目：<https://github.com/shipwr3ckd/revengeplugin/tree/master/plugins/HideBlockedAndIgnoredMessages>
原作者：Zykrah、シグマ siguma。原仓库使用 CC0-1.0；本目录沿用 CC0-1.0，见 LICENSE。
这是独立测试修复版，并非原作者或 Revenge 官方发布。
