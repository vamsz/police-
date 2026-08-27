# Starts the local PostgreSQL cluster this project uses.
#
# The project runs against a dedicated, password-free cluster on port 5433 that
# lives entirely in your user profile, so it never collides with (or depends on)
# the system PostgreSQL install on 5432. This script brings it up. The data
# survives reboots; only the server process needs restarting.

$ErrorActionPreference = 'Stop'

$PgBin  = 'C:\Program Files\PostgreSQL\17\bin'
$PgData = Join-Path $env:LOCALAPPDATA 'rally-pg\data'
$LogFile = Join-Path $env:LOCALAPPDATA 'rally-pg\server.log'
$Port = 5433

if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
  Write-Host "No cluster found at $PgData."
  Write-Host "Create it once with:"
  Write-Host "  & '$PgBin\initdb.exe' -D '$PgData' -U postgres --auth-local=trust --auth-host=trust -E UTF8"
  exit 1
}

# pg_ctl status returns 0 when the server is already running.
& "$PgBin\pg_ctl.exe" -D $PgData status *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Database already running on port $Port."
  exit 0
}

& "$PgBin\pg_ctl.exe" -D $PgData -l $LogFile -o "-p $Port -c listen_addresses=127.0.0.1" -w start
Write-Host "Database started on port $Port. Log: $LogFile"
