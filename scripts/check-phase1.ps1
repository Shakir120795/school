# Re-run Phase 1 validation checks on Windows 11 (no changes to data).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
npx prisma format --check
npx prisma validate
npx prisma generate
npx prisma migrate status
Write-Host "All Phase 1 checks passed." -ForegroundColor Green
