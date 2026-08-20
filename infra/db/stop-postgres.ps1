# 停止本地 PostgreSQL 16
$ErrorActionPreference = 'Stop'
$pg = Join-Path $env:LOCALAPPDATA 'PostgreSQL\pgsql'

& "$pg\bin\pg_ctl.exe" -D "$pg\data" -m fast -w stop
Write-Host 'PostgreSQL 已停止'
