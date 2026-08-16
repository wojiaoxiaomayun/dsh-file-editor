# =============================================================================
# dsh-file-explorer 安装脚本（Windows PowerShell）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Profile desktop] [-DryRun]
# 参数：
#   -Profile   目标 profile 名（默认 desktop）
#   -DryRun    只打印操作，不修改
#
# 通过 bundle 通道挂载本地开发包：
#   1. profile package.json：dependencies 加 link，dsh.profile.bundles 加包名
#   2. profile 目录 pnpm install
#   3. 重启 DSH
# =============================================================================
param(
  [string]$Profile = 'desktop',
  [switch]$DryRun
)

$DSH_HOME = if ($env:DSH_HOME) { $env:DSH_HOME } elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' } else { Join-Path $HOME '.dsh' }
$PROFILE_DIR = Join-Path $DSH_HOME "profiles\$Profile"
$PLUGIN_DIR = Split-Path $PSScriptRoot -Parent

function Say([string]$m) { Write-Host "[install] $m" -ForegroundColor Green }
function Die([string]$m) { Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $PROFILE_DIR)) { Die "找不到 profile 目录：$PROFILE_DIR" }
if (-not (Test-Path (Join-Path $PLUGIN_DIR 'lib\index.js'))) { Die "请先构建插件（pnpm build）" }

$pkgJsonPath = Join-Path $PROFILE_DIR 'package.json'
$pkgJson = Get-Content -Raw $pkgJsonPath | ConvertFrom-Json

Say "目标：$PROFILE_DIR（插件：$PLUGIN_DIR）"

if ($DryRun) {
  Say '[dry-run] 1. 在 profile package.json 的 dependencies 加 dsh-file-explorer link'
  Say "[dry-run] 2. 在 dsh.profile.bundles 追加 dsh-file-explorer"
  Say '[dry-run] 3. 在 profile 目录执行 pnpm install'
  Say '[dry-run] 4. 重启 DSH（host 半生效）'
  exit 0
}

# 1. dependencies link
if (-not $pkgJson.dependencies) { $pkgJson | Add-Member -NotePropertyName dependencies -NotePropertyValue @{} }
$pkgJson.dependencies | Add-Member -NotePropertyName 'dsh-file-explorer' -NotePropertyValue ("link:" + ($PLUGIN_DIR -replace '\\','/')) -Force

# 2. bundles
if (-not $pkgJson.dsh.profile.bundles) { $pkgJson.dsh.profile.bundles = @() }
if ($pkgJson.dsh.profile.bundles -notcontains 'dsh-file-explorer') {
  $pkgJson.dsh.profile.bundles = @($pkgJson.dsh.profile.bundles + @('dsh-file-explorer'))
}

$pkgJson | ConvertTo-Json -Depth 10 | Set-Content $pkgJsonPath -Encoding UTF8
Say 'profile package.json 已更新（dependencies link + bundles）'

# 3. install
Push-Location $PROFILE_DIR
try {
  pnpm install
  if ($LASTEXITCODE -ne 0) { Die 'pnpm install 失败' }
} finally {
  Pop-Location
}
Say '依赖已安装'

# 4. 校验
$check = dsh --profile $Profile --dump-config 2>&1 | Select-String -Pattern 'dsh-file-explorer'
if ($check) {
  Say "组合校验通过：dsh-file-explorer 已进入配置树"
} else {
  Say '警告：dsh --dump-config 未看到 dsh-file-explorer（profile 名不对或未生效？）'
}

Say '完成。下一步：重启 DSH 使 host 半生效。'
