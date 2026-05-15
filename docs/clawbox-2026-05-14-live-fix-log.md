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

---

## 2026-05-15 Follow-up: network drop root-cause fix + rollback hardening

### Action 10 (done): prove root-cause of repeated SSH drops during deployment
- Symptom observed: device became unreachable right after maintenance restarts.
- Root cause confirmed:
  - restarting `clawbox-ap` may switch device back to hotspot (`ClawBox-Setup`) and cut off current LAN path (`192.168.31.x`).
  - additionally, archive sync from Windows dropped executable bits on shell scripts, causing `203/EXEC permission denied` on systemd units.

### Action 11 (done): script permission recovery on Pi
- Re-applied script permissions on both source/runtime dirs:
  - `/home/pi/clawbox-src/scripts/*.sh`
  - `/home/clawbox/clawbox/scripts/*.sh`
- Applied mode/owner:
  - `chmod 750 ...`
  - `chown clawbox:clawbox ...`
- Critical scripts verified:
  - `start-ap.sh`
  - `stop-ap.sh`
  - `gateway-pre-start.sh`

### Action 12 (done): stabilize maintenance restart strategy (avoid AP restart)
- Disabled AP auto-start to avoid accidental network path flips during remote maintenance:
  - `systemctl disable clawbox-ap`
- Safe restart set used:
  - `systemctl restart clawbox-gateway clawbox-setup clawbox-oled`
  - (intentionally **not** restarting `clawbox-ap`)

### Action 13 (done): post-fix verification (real device)
- Service state:
  - `clawbox-gateway`: active
  - `clawbox-setup`: active
  - `clawbox-oled`: active
  - `clawbox-ap`: disabled (by design)
- HTTP/API checks:
  - `GET /` => `302` to `/setup`
  - `GET /setup` => `200`
  - `GET /setup-api/setup/status` => `200`
  - `GET /setup-api/wifi/status` => `200`
  - `GET /setup-api/system/info` => `200`
- Runtime model/auth checks:
  - `agents.defaults.model.primary = deepseek/deepseek-v4-flash`
  - `auth.profiles` includes `deepseek:default`

### Action 14 (done): local Git rollback baseline (Windows workspace)
- Initialized Git for local handover/recovery safety.
- Checkpoint commits:
  - `7a995c0` `chore: bootstrap local git baseline for clawbox takeover (2026-05-15)`
  - `e90b237` `chore: add git line-ending guard and rollback notes`
- Added files:
  - `.gitattributes` (force LF for `*.sh` etc.)
  - `docs/git-rollback-notes-2026-05-15.md`

## Operator runbook (how to use this fix)

### A) During remote maintenance (recommended sequence)
1. Do **not** restart AP first.
2. Only restart:
   - `clawbox-gateway`
   - `clawbox-setup`
   - `clawbox-oled`
3. Verify via:
   - `/`, `/setup`, `/setup-api/setup/status`, `/setup-api/wifi/status`, `/setup-api/system/info`

### B) If deploying from Windows archive/scp again
1. Extract code to both dirs:
   - `/home/pi/clawbox-src`
   - `/home/clawbox/clawbox`
2. Immediately restore script perms before any restart:
   - `chmod 750 /home/pi/clawbox-src/scripts/*.sh /home/clawbox/clawbox/scripts/*.sh`
   - `chown clawbox:clawbox /home/pi/clawbox-src/scripts/*.sh /home/clawbox/clawbox/scripts/*.sh`
3. Then run install/build and non-AP service restarts.

### C) When AP is actually needed (manual setup window only)
- Start manually:
  - `systemctl start clawbox-ap`
- After setup is complete and LAN path is confirmed, stop AP again if needed:
  - `systemctl stop clawbox-ap`

## Current status (2026-05-15)
- ✅ Recurrent remote-drop issue is mitigated via restart strategy + AP disable + script permission recovery.
- ✅ Device services/API are reachable in stable client mode.
- ⚠️ Remaining alignment item: setup status field `ai_model_provider` may still show historical value (`openrouter`) while runtime model is DeepSeek; can be handled as a separate consistency patch.
