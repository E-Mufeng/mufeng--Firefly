# Firefly R2 图床 + Worker Routes 代理生产部署手册

> 适用项目：Firefly 个人博客
> 博客域名：`6261025.xyz`、`www.6261025.xyz`
> 图床代理：`static.6261025.xyz`
> 部署模式：Cloudflare Zone 内 Worker Routes，不绑定 Worker 自定义域名

## ① 整体架构说明

```text
GitHub 源码仓库
    │ push
    ▼
GitHub Actions（pnpm build + wrangler deploy）
    │
    ▼
Cloudflare Worker：博客站点 + R2 图床代理 Worker
    │
    ├── 6261025.xyz → 博客 Worker
    └── static.6261025.xyz/* → R2 图床 Worker（Worker Routes）
            │
            ▼
        R2 Bucket：blog-mufeng
```

安全边界：

- R2 桶不开启公开访问。
- Worker 通过 R2 binding 访问存储，Worker 源码不出现密钥。
- 生产 CORS 不使用 `*`。
- 图床访问必须经过 `static.6261025.xyz` 的 Worker Route。

## ② 固定全局参数

| 参数 | 值 |
| --- | --- |
| 博客主域名 | `6261025.xyz` |
| Cloudflare Account ID | `50d121d16a613af840b76a91de2b33c2` |
| R2 Bucket 名称 | `blog-mufeng` |
| S3 API Endpoint | `https://50d121d16a613af840b76a91de2b33c2.r2.cloudflarestorage.com/blog-mufeng` |
| Region | 留空 |

## ②.1 创建 R2 桶并上传资源

1. Cloudflare Dashboard -> R2 -> Create bucket，名称 `blog-mufeng`，保持 Public Access 关闭。
2. 本地设置 S3 环境变量：

```powershell
$env:AWS_ACCESS_KEY_ID = "{{R2_ACCESS_KEY_ID}}"
$env:AWS_SECRET_ACCESS_KEY = "{{R2_SECRET_ACCESS_KEY}}"
$env:AWS_ENDPOINT_URL = "https://50d121d16a613af840b76a91de2b33c2.r2.cloudflarestorage.com"
```

3. 上传背景视频：

```powershell
aws s3 cp "C:\Users\chenm\Desktop\背景视频\【哲风壁纸】古月方源-古风-国风_1920x1080.mp4" "s3://blog-mufeng/videos/wallpaper-fangyuan.mp4" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "C:\Users\chenm\Desktop\背景视频\【哲风壁纸】夜景-月光-枫树_3840x2160.mp4" "s3://blog-mufeng/videos/wallpaper-moon-maple.mp4" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "C:\Users\chenm\Desktop\背景视频\【哲风壁纸】coser-cosplay.mp4" "s3://blog-mufeng/videos/wallpaper-coser.mp4" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "C:\Users\chenm\Desktop\背景视频\【哲风壁纸】云雾-城市-夜晚_2560x1440.mp4" "s3://blog-mufeng/videos/wallpaper-cloud-city.mp4" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "C:\Users\chenm\Desktop\背景视频\【哲风壁纸】五条悟-咒术回战.mp4" "s3://blog-mufeng/videos/wallpaper-gojo.mp4" --endpoint-url $env:AWS_ENDPOINT_URL
```

4. 上传图片：

```powershell
aws s3 cp "D:\blog\mufeng--Firefly\src\assets\images\avatar.png" "s3://blog-mufeng/images/avatar.png" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "D:\blog\mufeng--Firefly\src\assets\images\DesktopWallpaper\mufeng-gojo.png" "s3://blog-mufeng/wallpapers/mufeng-gojo.png" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "D:\blog\mufeng--Firefly\src\assets\images\DesktopWallpaper\mufeng-3d.png" "s3://blog-mufeng/wallpapers/mufeng-3d.png" --endpoint-url $env:AWS_ENDPOINT_URL
aws s3 cp "D:\blog\mufeng--Firefly\src\assets\images\DesktopWallpaper\mufeng-bedroom.png" "s3://blog-mufeng/wallpapers/mufeng-bedroom.png" --endpoint-url $env:AWS_ENDPOINT_URL
```

说明：视频只上传 R2，不放入博客 `public/assets/videos`，避免触发 Workers 静态资源 25 MiB 单文件限制。

## ③ 修订后的 wrangler.toml

文件：`cloudflare/r2-worker-proxy/wrangler.toml`

```toml
name = "mufeng-r2-proxy"
main = "worker.js"
compatibility_date = "2026-08-21"
workers_dev = true

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "blog-mufeng"

[[routes]]
pattern = "static.6261025.xyz/*"
zone_name = "6261025.xyz"

[vars]
ALLOWED_ORIGINS = "https://6261025.xyz,https://www.6261025.xyz,https://memos.6261025.xyz,https://demo.6261025.xyz,http://localhost:4321,http://127.0.0.1:4321"
ALLOWED_REFERERS = "6261025.xyz,www.6261025.xyz,memos.6261025.xyz,demo.6261025.xyz,static.6261025.xyz,localhost,127.0.0.1"
CACHE_CONTROL = "public, max-age=86400"
REQUIRE_REFERER = "false"
FORCE_HTTPS = "true"
```

变更说明：

- `bucket_name` 从 `博客-mufeng` 改为 `blog-mufeng`。
- 新增 `[[routes]]`，使用 `static.6261025.xyz/*`。
- 移除 Worker 自定义域名绑定相关说明，不再使用 `custom_domain = true`。

## ④ Worker Routes 创建完整操作步骤

### 4.1 添加 DNS 记录

1. Cloudflare Dashboard -> `6261025.xyz` -> DNS -> Records。
2. 添加 AAAA 记录：
   - Type：`AAAA`
   - Name：`static`
   - Content：`100::`
   - Proxy status：已代理（橙色云）
   - TTL：Auto
3. 添加 A 记录：
   - Type：`A`
   - Name：`static`
   - Content：`192.0.2.1`
   - Proxy status：已代理（橙色云）
   - TTL：Auto
4. 保存。

说明：`100::` 是 Cloudflare Worker Route 常用的占位解析，实际流量由 Worker 接管，避免直接暴露源站。

### 4.2 创建 Worker 并绑定 R2

1. Workers & Pages -> Create Worker -> 名称 `mufeng-r2-proxy`。
2. 粘贴 `worker.js` 全部内容。
3. Settings -> Variables，按 `wrangler.toml` 的 `[vars]` 配置。
4. Settings -> Bindings -> R2 Bucket：
   - Variable name：`R2_BUCKET`
   - Bucket：`blog-mufeng`
5. Deploy。

### 4.3 添加 Worker Route

方式一：Dashboard

1. Workers & Pages -> `mufeng-r2-proxy` -> Settings -> Triggers -> Routes。
2. Add Route。
3. Pattern：`static.6261025.xyz/*`
4. Zone：`6261025.xyz`
5. Worker：`mufeng-r2-proxy`
6. Save。

方式二：Wrangler CLI

```powershell
cd D:\blog\mufeng--Firefly
npx wrangler deploy --config cloudflare\r2-worker-proxy\wrangler.toml
```

`wrangler.toml` 中的 `[[routes]]` 会自动创建/更新路由。

注意：博客主域名 `6261025.xyz/*` 和 `www.6261025.xyz/*` 路由配置在根目录 [wrangler.toml](../../wrangler.toml)，不要写进本 Worker 配置。

一键部署脚本（登录 Cloudflare 后执行）：

```powershell
cd D:\blog\mufeng--Firefly
.\cloudflare\deploy-firefly.ps1
```

跳过重新构建：

```powershell
.\cloudflare\deploy-firefly.ps1 -SkipBuild
```

### 4.4 强制 HTTPS

Zone `6261025.xyz` -> SSL/TLS -> Edge Certificates -> Always Use HTTPS 开启。

Worker 内 `FORCE_HTTPS=true` 会额外把 HTTP 请求 301 到 HTTPS。

## ⑤ R2 桶 CORS 配置

测试环境：`cors-test.json`

```json
[
	{
		"AllowedOrigins": [
			"http://localhost:4321",
			"http://127.0.0.1:4321",
			"https://preview.6261025.xyz"
		],
		"AllowedMethods": ["GET", "HEAD", "OPTIONS"],
		"AllowedHeaders": ["Range", "Content-Type"],
		"ExposeHeaders": [
			"ETag",
			"Content-Length",
			"Accept-Ranges",
			"Content-Range",
			"Cache-Control"
		],
		"MaxAgeSeconds": 3600
	}
]
```

生产环境：`cors-prod.json`

```json
[
	{
		"AllowedOrigins": [
			"https://6261025.xyz",
			"https://www.6261025.xyz",
			"https://memos.6261025.xyz",
			"https://demo.6261025.xyz"
		],
		"AllowedMethods": ["GET", "HEAD", "OPTIONS"],
		"AllowedHeaders": ["Range", "Content-Type"],
		"ExposeHeaders": [
			"ETag",
			"Content-Length",
			"Accept-Ranges",
			"Content-Range",
			"Cache-Control"
		],
		"MaxAgeSeconds": 3600
	}
]
```

说明：如果暂不使用 Memos/Demo，可只保留 `https://6261025.xyz` 和 `https://www.6261025.xyz`。禁止使用 `*`。

> 实际状态：视频和图片已通过 S3 API 上传到 `blog-mufeng`，但当前 R2 Access Key 无 CORS 管理权限，`PutBucketCors` 返回 AccessDenied。CORS 需要在 Cloudflare Dashboard 的 R2 Bucket -> Settings -> CORS Policy 手动粘贴，或提供更高权限的 Cloudflare API Token。

## ⑥ 防盗链、缓存、断点续传配置

Worker 已实现：

- Referer 白名单：`ALLOWED_REFERERS`
- 严格 Referer：`REQUIRE_REFERER=true` 后拒绝空 Referer
- Cache-Control：`CACHE_CONTROL`
- ETag 协商缓存
- MIME 自动识别
- Range 请求：`bytes=start-end`、`bytes=start-`、`bytes=-suffix`
- `X-Content-Type-Options: nosniff`

## ⑦ GitHub 自动构建联动 Cloudflare

文件：`.github/workflows/deploy-firefly.yml`

```yaml
name: Deploy Firefly Blog

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy-blog:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.22.0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22.23.0
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Deploy blog Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-r2-proxy:
    runs-on: ubuntu-latest
    needs: deploy-blog
    defaults:
      run:
        working-directory: cloudflare/r2-worker-proxy
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy R2 proxy Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

GitHub Secrets 配置：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token，权限包含 Workers Scripts Edit、Workers Routes Edit、R2 只读。
- `CLOUDFLARE_ACCOUNT_ID`：`50d121d16a613af840b76a91de2b33c2`

若仍使用 Cloudflare Pages 原生 Git 集成，则不需要 GitHub Actions；二选一即可。

## ⑧ 博客前端接入 R2 图床与 Giscus

R2 图床：

```ts
const R2_BASE = "https://static.6261025.xyz";

const avatarUrl = `${R2_BASE}/images/avatar.png`;
const gojoWallpaper = `${R2_BASE}/wallpapers/mufeng-gojo.png`;
const videoUrl = `${R2_BASE}/videos/wallpaper-fangyuan.mp4`;
```

Firefly 背景配置：

```ts
desktop: [
  "https://static.6261025.xyz/wallpapers/mufeng-gojo.png",
  "https://static.6261025.xyz/wallpapers/mufeng-3d.png",
  "https://static.6261025.xyz/wallpapers/mufeng-bedroom.png",
],
playerUrl: [
  "https://static.6261025.xyz/videos/wallpaper-coser.mp4",
  "https://static.6261025.xyz/videos/wallpaper-cloud-city.mp4",
  "https://static.6261025.xyz/videos/wallpaper-fangyuan.mp4",
  "https://static.6261025.xyz/videos/wallpaper-gojo.mp4",
  "https://static.6261025.xyz/videos/wallpaper-moon-maple.mp4",
],
```

Giscus 已配置：

- `repo: E-Mufeng/mufeng--Firefly`
- `repoId: R_kgDOT-_cig`
- `category: General`
- `categoryId: DIC_kwDOT-_cis4DD3xD`
- `mapping: pathname`

## ⑨ 全链路联调测试

### 9.1 图床资源

```bash
curl -I "https://static.6261025.xyz/images/avatar.png"
curl -H "Origin: https://6261025.xyz" -I "https://static.6261025.xyz/images/avatar.png"
curl -H "Range: bytes=0-99" -I "https://static.6261025.xyz/videos/wallpaper-fangyuan.mp4"
```

预期：

- 200、正确 Content-Type、ETag、Cache-Control。
- CORS 返回 `Access-Control-Allow-Origin: https://6261025.xyz`。
- Range 返回 206 和 `Content-Range`。

### 9.2 浏览器完整渲染

1. 访问 `https://6261025.xyz`。
2. 检查首页、欢迎文章、关于页、友链页正常。
3. 打开文章评论区，确认 Giscus 正常加载并显示 GitHub 登录入口。
4. 控制台查看 Network：
   - 背景图片来自 `static.6261025.xyz`
   - 背景视频可拖动进度条，状态为 206
   - 无 CORS/404/403 报错

## ⑩ 上线验收清单

- [ ] `static.6261025.xyz` DNS 为 AAAA `100::` 且橙色云已开启
- [ ] Worker Route `static.6261025.xyz/*` 指向 `mufeng-r2-proxy`
- [ ] R2 桶未开启 Public Access
- [ ] 生产 CORS 无 `*`
- [ ] `worker.js` 通过 `node --check`
- [ ] GitHub Actions 两个 Job 均成功
- [ ] 博客首页、文章、Giscus 正常
- [ ] R2 图片/视频/PDF 均可在线访问
- [ ] 视频支持 Range 断点续传

## ⑪ 故障排查

| 现象 | 排查方向 |
| --- | --- |
| `static` 无法访问 | DNS 是否代理，Worker Route 是否保存，证书是否签发 |
| 404 | R2 对象 key 与 URL 路径不一致 |
| 403 | CORS/Referer 不在白名单 |
| 502 | R2 binding 未绑定或桶名不一致 |
| 视频无法拖动 | Range 被剥离，检查是否返回 206 |
| Giscus 不显示 | giscus app 是否安装，仓库 Discussions 是否开启 |
| GitHub Actions 失败 | 检查 `CLOUDFLARE_API_TOKEN` 权限和 `CLOUDFLARE_ACCOUNT_ID` |

## ⑫ 密钥轮换与运维规范

- S3 密钥只放本地环境变量，不进入仓库。
- Worker 使用 R2 binding，不读取 S3 密钥；轮换 S3 密钥不影响线上。
- 轮换步骤：Cloudflare R2 -> Manage R2 API Tokens -> 新建 Access Key -> 更新本地环境变量 -> 删除旧 Key。
- 定期检查 R2 用量、请求量和异常 Referer。
- 修改 CORS 后立即用 OPTIONS 请求验证。
- Worker 更新先部署到 workers.dev 验证，再确认 Route 生效。

## 修改日志

- 2026-08-21：Bucket 改为 `blog-mufeng`。
- 2026-08-21：新增 Worker Routes 模式，移除自定义域名绑定方案。
- 2026-08-21：新增 GitHub Actions 自动构建部署 workflow。
- 2026-08-21：README 重构为 Worker Routes 部署手册。
