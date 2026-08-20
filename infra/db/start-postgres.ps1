# 启动本地 PostgreSQL 16（免管理员、免服务注册）
# 安装位置：%LOCALAPPDATA%\PostgreSQL\pgsql（EDB 官方二进制包）
$ErrorActionPreference = 'Stop'
$pg = Join-Path $env:LOCALAPPDATA 'PostgreSQL\pgsql'

if (-not (Test-Path "$pg\bin\pg_ctl.exe")) {
    Write-Error "未找到 PostgreSQL：$pg"
    exit 1
}

& "$pg\bin\pg_isready.exe" -h 127.0.0.1 -p 5432 -q
if ($LASTEXITCODE -eq 0) {
    Write-Host 'PostgreSQL 已在运行（127.0.0.1:5432）'
    exit 0
}

& "$pg\bin\pg_ctl.exe" -D "$pg\data" -l "$pg\server.log" -w start
Write-Host 'PostgreSQL 已启动。默认库：postgres / fap（超级用户 postgres）'
