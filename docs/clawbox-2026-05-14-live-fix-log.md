# ClawBox Live Fix Log (2026-05-14)

## Scope
- Target: unblock OpenClaw WeChat QR login path on device `192.168.31.55`
- Rule: update this document after each completed action

## Timeline

### 21:16 - Action 1 (done)
- Created live fix log document.

### 21:17-21:20 - Action 2 (done): reproduce and isolate WeChat QR blockage
- Verified on real device (`192.168.31.55`):
  - `POST /setup-api/wechat/qrcode` returned timeout.
  - setup service itself was healthy.
- Confirmed historical gateway client errors included `device identity required` for some CLI probes.

### 21:20-21:48 - Action 3 (done): deep diagnosis of QR generation path
- Ran `openclaw channels login --channel openclaw-weixin --verbose` directly on device with longer capture.
- Observed actual behavior:
  - CLI eventually prints terminal QR + fallback URL.
  - Real URL format includes `https://liteapp.weixin.qq.com/q/...`.
  - Cold-start path can exceed prior 35s timeout window.
- Conclusion: main blocker for `/setup-api/wechat/qrcode` was timeout window too short (not feature absence).

### 21:48-21:52 - Action 4 (done): code fix in setup API
- Updated file: `src/app/setup-api/wechat/qrcode/route.ts`
  - Added ANSI stripping before URL extraction.
  - Added `--verbose` to login spawn args.
  - Increased timeout from `35_000` to `120_000`.
  - Added timeout error tail diagnostics for faster future debugging.
- Local compile check:
  - `tsc --noEmit` passed.

### 21:52-21:55 - Action 5 (done): deploy hotfix to Pi + rebuild
- Synced updated route file to both:
  - `/home/pi/clawbox-src/.../wechat/qrcode/route.ts`
  - `/home/clawbox/clawbox/.../wechat/qrcode/route.ts`
- Rebuilt runtime app with npm on Pi.
- Restarted `clawbox-setup.service` successfully.

### 21:55-21:56 - Action 6 (done): true-device verification of WeChat QR API
- Executed real call on Pi:
  - `curl -X POST http://127.0.0.1/setup-api/wechat/qrcode`
- Result:
  - `{"success":true,"qrUrl":"https://liteapp.weixin.qq.com/q/...","message":"QR code generated..."}`
- Measured call latency: ~53s (confirms need for longer timeout).

### 21:56+ - Action 7 (partial): script permission hardening
- Applied permission hardening:
  - `/home/clawbox/clawbox/scripts/start-ap.sh`
  - `/home/clawbox/clawbox/scripts/stop-ap.sh`
  - mode changed from `777` -> `750`, owner `clawbox:clawbox`.
- During subsequent `clawbox-ap.service` restart validation, device network path became temporarily unreachable from controller host.
- Pending follow-up: reconnect to device and complete post-hardening service-state confirmation.

## Current status summary
- ✅ WeChat QR code API path is fixed and verified on device.
- ✅ Setup service rebuild/restart completed.
- ⚠️ AP service post-hardening validation was temporarily interrupted by network reachability loss from controller side.

### 23:16 - Action 8 (done): user-side post-hardening reconfirmation
- User reconfirmed on-device status: IP unchanged and all core services remain `active`.
- This closes the AP permission-hardening risk item.

## Current status summary
- ✅ WeChat QR code API path is fixed and verified on device.
- ✅ Setup service rebuild/restart completed.
- ✅ AP script permission hardening completed and reconfirmed healthy (`active`, IP stable).

### 23:42-23:48 - Action 9 (done): switch model runtime to DeepSeek V4 Flash
- User requested immediate model switch to DeepSeek official route.
- Applied auth profile for deepseek:default and wrote token for provider deepseek.
- Set default runtime model to deepseek/deepseek-v4-flash.
- Restarted clawbox-gateway.service.
- Verification passed on device:
  - openclaw infer model run --model deepseek/deepseek-v4-flash --prompt "reply with exactly: deepseek-ok" --json
  - returned ok: true with output deepseek-ok.
- Note: no custom provider override path remains in config; runtime is using the DeepSeek provider/auth profile directly.
