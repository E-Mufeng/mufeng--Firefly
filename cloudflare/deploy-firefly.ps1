param(
	[switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
	$env:CLOUDFLARE_ACCOUNT_ID = "50d121d16a613af840b76a91de2b33c2"
}

if ($env:CLOUDFLARE_API_TOKEN) {
	Write-Host "==> Using CLOUDFLARE_API_TOKEN"
} else {
	Write-Host "==> Checking Cloudflare login"
	npx wrangler whoami | Out-Null
	if ($LASTEXITCODE -ne 0) {
		Write-Error "Not logged in. Set CLOUDFLARE_API_TOKEN or run: npx wrangler login"
		exit 1
	}
}

if (-not $SkipBuild) {
	Write-Host "==> Building Firefly blog"
	pnpm build
	if ($LASTEXITCODE -ne 0) {
		exit 1
	}
}

Write-Host "==> Deploying blog Worker (6261025.xyz / www.6261025.xyz)"
npx wrangler deploy --config wrangler.toml
if ($LASTEXITCODE -ne 0) {
	exit 1
}

Write-Host "==> Deploying R2 proxy Worker (static.6261025.xyz)"
npx wrangler deploy --config "$root\cloudflare\r2-worker-proxy\wrangler.toml"
if ($LASTEXITCODE -ne 0) {
	exit 1
}

Write-Host "==> Deploy complete. See cloudflare/r2-worker-proxy/README.md for verification."
