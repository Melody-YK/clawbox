# ClawBox

ClawBox 是一个运行在设备上的配网页与本地控制面板。它先开启 `ClawBox-Setup` 热点供手机配网，拿到家庭 Wi‑Fi 凭据后切换到局域网，通过本机 Web 服务代理本地 `OpenClaw` gateway。

## 当前主链路

1. 设备启动后开启热点 `ClawBox-Setup`
2. 手机连接热点并打开 `http://192.168.4.1/setup`
3. 提交目标 Wi‑Fi 后，设备关闭热点并通过 `NetworkManager + nmcli` 接入局域网
4. 设备通过 DHCP 自动获取 IPv4 地址
5. 优先通过 `http://clawbox-<suffix>.local/` 访问设备
6. 如果客户端不支持 `.local`，改用 OLED 屏幕显示的 IPv4 地址访问

`clawbox.home.arpa` 仅作为可选本地 DNS 别名，不是默认自动发现入口。

## 网络与访问

- 热点模式固定地址：`192.168.4.1`
- 运行模式：DHCP 自动获取地址，不做设备侧静态 IP
- 默认自动发现：Avahi/mDNS，入口为 `http://clawbox-<suffix>.local/`
- IPv4 兜底：OLED 屏幕持续显示当前 IPv4
- 可选本地 DNS：如果交付环境已配置本地 DNS，可额外使用 `clawbox.home.arpa`

## 运行结构

- `src/app/setup/page.tsx`
  提供热点配网页
- `src/components/WifiStep.tsx`
  提交 Wi‑Fi 凭据
- `src/components/DoneStep.tsx`
  显示系统面板、当前访问入口和重置/更新操作
- `src/lib/network.ts`
  调用 `nmcli` 进行扫描、切网、DHCP 等待和热点回退
- `src/lib/system-info.ts`
  汇总系统状态、当前 IPv4、mDNS 主机名和访问入口
- `production-server.js`
  对外监听 Web 服务，并代理本地 `127.0.0.1:18789` 的 OpenClaw gateway

## API 概览

- `POST /setup-api/wifi/scan`
  触发后台 Wi‑Fi 扫描
- `GET /setup-api/wifi/scan`
  轮询扫描结果
- `POST /setup-api/wifi/connect`
  提交 Wi‑Fi 凭据并异步切网；返回 `mdnsHost` 和 `nextUrlHint`
- `GET /setup-api/wifi/status`
  返回稳定字段：`mode`、`connected`、`ssid`、`ipv4`、`gateway`、`hostname`、`mdnsHost`、`accessUrl`
- `GET /setup-api/system/info`
  返回系统状态和当前访问入口
- `GET /setup-api/setup/status`
  返回当前是否已完成配网/完成初始化

## 本地开发

```bash
bun install
bun run dev
```

生产构建：

```bash
bun run build
node production-server.js
```

测试与检查：

```bash
bun run test
bun run lint
```

## 设备安装

在目标 Linux 设备上执行：

```bash
sudo bash install.sh
```

安装脚本会完成以下事项：

- 安装 `network-manager`、`avahi-daemon`、Node.js、Bun、OLED 依赖
- 保存 Wi‑Fi 接口配置
- 生成稳定设备主机名 `clawbox-<suffix>`
- 安装 systemd 服务
- 安装 Avahi `_http._tcp` 服务广播

安装完成后：

- 先连接 `ClawBox-Setup`
- 打开 `http://192.168.4.1/setup`
- 配网成功后，优先访问 `http://clawbox-<suffix>.local/`
- 如 `.local` 不可解析，则使用 OLED 上显示的 IPv4

## 验收顺序

到手测试请按 [docs/plan-a-verification.md](docs/plan-a-verification.md) 执行。
