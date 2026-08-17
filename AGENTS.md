# ClawBox Channel Config Agent Guide

本文件适用于 `code_260728/src`，即当前仓库中的 ClawBox Next.js 设置向导和渠道配置服务。后续修改前先阅读本文件，并保留工作区中已有的用户改动。

## 项目边界

- Git 根目录是当前文件所在目录，应用源码位于 `code_260728/src`。
- 不使用整目录、整文件覆盖来迁移渠道功能；尤其不要直接覆盖 `components/DoneStep.tsx`、`components/ChannelSetupExtras.tsx`、`lib/i18n.ts` 或渠道公共库。
- 涉及渠道行为、网络、凭据、Gateway 重载或文件迁移时，先读取相关实现和测试，明确影响范围后再修改。
- 只有用户明确要求时才创建分支、提交或推送；不要擅自重置、回退或覆盖用户已有改动。
- Token、Secret、二维码、账号会话、设备数据、日志、缓存、`node_modules` 和 `.next` 不得提交到仓库。

## 当前渠道

页面当前包含 12 个渠道：

- 核心配置区：WeChat、WeCom、Telegram、WhatsApp、Feishu/Lark、LINE、QQ Bot。
- 扩展配置区：Discord、Zalo Bot、Zalo ClawBot、Zalo Personal、Signal。

主要入口如下：

| 渠道 | 配置与状态实现 |
| --- | --- |
| WeChat | `app/setup-api/wechat/*`、`lib/openclaw-config.ts` |
| WeCom | `app/setup-api/channels/wecom/*`、`lib/channels/wecom.ts`、`lib/channels-config.ts` |
| Telegram | `app/setup-api/channels/telegram/*`、`lib/channels/telegram.ts` |
| WhatsApp | `app/setup-api/channels/whatsapp/*`、`lib/channels/whatsapp.ts` |
| Feishu/Lark | `app/setup-api/channels/feishu/*`、`lib/channels/feishu.ts`、`lib/channels/feishu-qrcode.ts` |
| LINE | `app/setup-api/channels/line/*`、`lib/channels/line.ts`、`app/line/webhook/route.ts` |
| QQ Bot | `app/setup-api/channels/qqbot/*`、`lib/channels/qqbot.ts`、`lib/channels/qqbot-qr.ts` |
| 扩展渠道 | `components/ChannelSetupExtras.tsx`、对应 `app/setup-api/channels/*` 和 `lib/channels/*.ts` |

## WeCom 约定

当前实现采用企业微信智能机器人 WebSocket 配置，配置契约为：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "...",
      "secret": "..."
    }
  }
}
```

- 插件安装命令：`openclaw plugins install @wecom/wecom-openclaw-plugin`。
- `botId` 和 `secret` 通过白名单写入；`secret` 只能写入，不能由 GET 或状态响应返回明文，只能返回 `hasSecret`。
- 保存 WeCom 配置时必须强制 `connectionMode: "websocket"`，避免写入插件不识别的模式。
- 当前 UI 和接口没有实现 Agent、Webhook 或多账号配置，不要在文档或代码中假设这些能力已经可用。
- WeCom 状态必须通过共享的 `channel-status-cache.ts` 解析 `channelAccounts.wecom`，不能为该渠道单独启动状态 CLI。

## 配置与状态原则

渠道保存通常遵循：校验输入 -> 合并现有配置 -> 原子写入 -> 失效共享状态缓存 -> 尝试重载 Gateway -> 返回脱敏视图。

- `lib/channels-config.ts` 维护渠道字段白名单和密钥脱敏规则；新增字段必须同步更新对应类型、路由、UI 和测试。
- 密钥字段提交空字符串表示“不修改已保存值”，不能用空字符串覆盖已有 Secret。
- “已配置”“已启用”“Gateway 在线”“实际已连接”是不同状态，UI 不得用凭据存在代替实际连接状态。
- `lib/channels/channel-status-cache.ts` 使用 `openclaw channels status --probe --timeout 8000 --json`。
- 缓存包括 8 秒内存 TTL、最多 5 分钟的持久化文件缓存、并发 single-flight 和配置写入后的失效处理；修改时必须保留这些行为并更新 `tests/channel-status-cache.test.ts`。
- CLI 环境使用 `HOME=/home/clawbox`，并将 `OPENCLAW_HOME`、`OPENCLAW_STATE_DIR` 指向目标 OpenClaw 状态目录。不要恢复成 root 的 HOME，也不要把状态目录指向开发者个人目录。

## 前端修改要求

- `components/DoneStep.tsx` 负责核心渠道汇总和配置界面，`components/ChannelSetupExtras.tsx` 负责扩展渠道；新增渠道应放在正确的边界内。
- 中英文文案同步维护在 `lib/i18n.ts`，不能只修改一种语言，也不能把英文标签硬编码到中文配置页面。
- 保留现有二维码会话、刷新、取消、超时、Gateway/网络错误和脱敏提示。
- 复用已有状态点、表单、凭据指引和响应处理模式；不要为单次逻辑额外抽象公共层。
- 类型保持明确，避免新增无约束的 `any`；只在真实外部边界（JSON、Storage、URL、第三方 CLI 或浏览器 API）做必要的异常处理。

## 本地运行与验证

在 `code_260728/src` 执行：

```bash
npm ci
npm run dev -- -p 3106
npm test
npx tsc --noEmit
npm run build
npm run start -- -p 3106
```

- 本地预览通常使用 `http://127.0.0.1:3106/setup?preview=channels`；端口被占用时先确认进程的命令行和工作目录，再选择其他端口。
- 不要在同一个 `.next` 目录仍被 `next dev` 或 `next start` 使用时执行 `npm run build`；需要构建时先停止已确认属于本项目的服务，构建后重新启动并复测接口。
- 定向修改先运行对应测试，例如 `npm test -- tests/wecom-channel.test.ts tests/wecom-routes.test.ts`，再运行全量测试和构建。
- 至少验证页面路由、总渠道接口、相关渠道配置接口和状态接口；接口响应不能包含明文密钥。
- Linux 设备上的 `scripts/start-ap.sh`、`scripts/stop-ap.sh` 只在目标设备验证，不要在 Windows 本地执行会修改网络的命令。

## 提交前检查

```bash
git diff --check
git status --short
```

确认差异只包含本次任务相关的源码、测试和必要文档；不要提交运行日志、截图、缓存、构建产物或设备数据。
