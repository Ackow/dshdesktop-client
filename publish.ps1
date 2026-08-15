# publish.ps1 — 一键发布官方 dshdesktop-client 插件到公共 npm。
#
# 用途：把本仓库（@dshd/dshdesktop-client）发布为公开包，
#       之后 DSH Desktop 首次启动会自动 dsh plugin add 它，设置按钮上方即出现市场按钮。
#
# 重要：发布统一走【官方 registry https://registry.npmjs.org/】。
# 警告：若你的 npm 账号开了 2FA，普通 token / 密码发布会报 E403 "Two-factor authentication ...
#        required"。必须用【granular access token 且勾选了 "Bypass 2fa for this token"】，
#       否则 403。用 NPM_TOKEN 环境变量提供该 token（不要写进本文件 / 不要用明文密码）。
#
# 前置：本机 node/npm；已 npm login 过或设了 NPM_TOKEN。
# 运行一（用已登录会话）：.\publish.ps1
# 运行二（带 bypass-2fa 的 granular token）：$env:NPM_TOKEN = "npm_xxxx"; .\publish.ps1
$ErrorActionPreference = 'Stop'

$OfficialRegistry = 'https://registry.npmjs.org/'

$pkgDir = Split-Path -Parent $MyInvocation.MyCommand.Path   # 仓库根 = 插件包根

if (-not (Test-Path (Join-Path $pkgDir 'package.json'))) {
    throw "未找到插件包: $pkgDir"
}

Write-Host "==> 进入插件目录: $pkgDir"
Push-Location $pkgDir
try {
    Write-Host "==> 设置发布 registry 为官方: $OfficialRegistry"
    # 仅本次会话生效，不影响你原有的镜像配置
    $env:npm_config_registry = $OfficialRegistry

    # 可选：用 NPM_TOKEN 提供 bypass-2fa 的 granular access token
    if ($env:NPM_TOKEN) {
        Write-Host "==> 检测到 NPM_TOKEN，配置官方 registry auth token..."
        & npm config set //registry.npmjs.org/:_authToken $env:NPM_TOKEN
        if ($LASTEXITCODE -ne 0) { throw "设置 NPM_TOKEN 到 npm 失败" }
    }

    Write-Host "==> 检查官方 registry 登录状态..."
    $who = & npm whoami --registry $OfficialRegistry 2>&1
    if ($LASTEXITCODE -ne 0 -or -not $who) {
        Write-Host "   未登录官方 registry。请先登录（会打开交互提示）："
        Write-Host "   npm login --registry $OfficialRegistry"
        Write-Host "   （若账号开了 2FA，请改用 granular token 并设 NPM_TOKEN 环境变量，勿用密码）"
        throw "需要先在官方 registry 登录"
    }
    Write-Host "   已登录: $who"

    Write-Host "==> 发布到官方 registry（scoped 公开包）..."
    & npm publish --registry $OfficialRegistry --access public
    if ($LASTEXITCODE -ne 0) { throw "npm publish 失败" }

    Write-Host ""
    Write-Host "==> 发布成功！下一步："
    Write-Host "   1) 重启 DSH Desktop"
    Write-Host "      - 首次启动会自动执行: dsh plugin --profile web add @dshd/dshdesktop-client"
    Write-Host "   2) 或手动装一次: dsh plugin --profile web add @dshd/dshdesktop-client"
    Write-Host "   3) 重启 dsh web 后，侧栏「设置」按钮上方会出现「插件市场」按钮"
}
finally {
    Pop-Location
    Remove-Item Env:npm_config_registry -ErrorAction SilentlyContinue
}