# 6261025.xyz 访问异常排查报告与修复方案

> 排查时间：2026-08-21
> 结论：DNS 和 SSL 正常，Cloudflare 返回 404，根因是主域名没有 Worker Route，且博客 Worker 尚未部署。

## 一、证据

### DNS

```text
6261025.xyz A       -> 104.21.3.20, 172.67.130.12
6261025.xyz AAAA    -> 2606:4700:3034::ac43:820c, 2606:4700:3037::6815:314
6261025.xyz NS      -> dan.ns.cloudflare.com, holly.ns.cloudflare.com
```

结论：域名已托管到 Cloudflare，A/AAAA/NS 解析正常。

### HTTPS

```text
curl -I https://6261025.xyz
HTTP/1.1 404 Not Found
Server: cloudflare
cf-cache-status: DYNAMIC
```

结论：Cloudflare 边缘可达，证书正常，但没有任何 Worker/Pages 处理该域名，因此返回 404。

### 本地仓库

- 当前分支为 `master`，但 `.github/workflows/deploy-firefly.yml` 原来只监听 `main`，GitHub Actions 不会触发。
- 根目录 `wrangler.toml` 原来没有 `6261025.xyz/*` 路由。
- 本地 `wrangler` 未登录，无法直接部署。
- 首次 `wrangler deploy --dry-run` 失败：`dist/assets/videos/*.mp4` 超过 Workers 单文件 25 MiB 上限。

## 二、根因

1. 主域名没有 Worker Route，Cloudflare 找不到处理者。
2. 博客 Worker 未部署，或部署后未绑定 `6261025.xyz/*`。
3. GitHub Actions 触发分支与仓库实际分支不一致。
4. 视频被放入 `public/assets/videos` 并进入 `dist`，导致 Worker 静态资源部署失败。

## 三、已执行修复

- 根目录 [wrangler.toml](D:/blog/mufeng--Firefly/wrangler.toml) 新增：

```toml
[[routes]]
pattern = "6261025.xyz/*"
zone_name = "6261025.xyz"

[[routes]]
pattern = "www.6261025.xyz/*"
zone_name = "6261025.xyz"
```

- [deploy-firefly.yml](D:/blog/mufeng--Firefly/.github/workflows/deploy-firefly.yml) 触发分支改为 `master, main`。
- [backgroundWallpaper.ts](D:/blog/mufeng--Firefly/src/config/backgroundWallpaper.ts) 的视频地址改为 `https://static.6261025.xyz/videos/...`。
- 已从 `public/assets/videos` 移除本地视频，视频只上传 R2。
- `pnpm build` 成功，`wrangler deploy --dry-run` 通过。

## 四、剩余部署操作

### 1. 创建并上传 R2

按 [cloudflare/r2-worker-proxy/README.md](D:/blog/mufeng--Firefly/cloudflare/r2-worker-proxy/README.md) 创建 `blog-mufeng`，上传视频和图片。

### 2. 部署 R2 代理 Worker

```powershell
cd D:\blog\mufeng--Firefly\cloudflare\r2-worker-proxy
npx wrangler login
npx wrangler deploy
```

确认 Route：`static.6261025.xyz/*`。

### 3. 部署博客 Worker

```powershell
cd D:\blog\mufeng--Firefly
pnpm build
npx wrangler login
npx wrangler deploy
```

确认 Route：`6261025.xyz/*`、`www.6261025.xyz/*`。

### 4. 配置 GitHub Actions

仓库 Settings -> Secrets and variables -> Actions：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID=50d121d16a613af840b76a91de2b33c2`

推送到 `master` 后自动构建部署。

## 五、上线验证

```bash
curl -I https://6261025.xyz
curl -I https://www.6261025.xyz
curl -I https://static.6261025.xyz/images/avatar.png
```

预期：

- 主域名和 www 返回 200/HTML。
- 图床返回 200 和正确 Content-Type。
- 视频支持 `Range`，返回 206。

## 六、实际部署结果（2026-08-22）

- 博客 Worker `firefly` 已部署，路由：
  - `6261025.xyz/*`
  - `www.6261025.xyz/*`
- R2 代理 Worker `mufeng-r2-proxy` 已部署，路由：
  - `static.6261025.xyz/*`
- DNS 已添加：
  - `www` A `192.0.2.1` + AAAA `100::`，均代理
  - `static` A `192.0.2.1` + AAAA `100::`，均代理
- 验证结果：
  - `https://6261025.xyz` 返回 200
  - `https://www.6261025.xyz` 路由验证返回 200
  - `https://static.6261025.xyz/images/avatar.png` 返回 200
  - `https://static.6261025.xyz/videos/wallpaper-gojo.mp4` Range 请求返回 206
  - 文章页 HTML 已包含 Giscus widget 和 R2 视频地址

## 七、修改日志

- 2026-08-21：新增主域名/ www Worker Routes。
- 2026-08-21：GitHub Actions 触发分支改为 `master, main`。
- 2026-08-21：视频改为 R2 外部地址，避免 Worker 静态资源超限。
