# Smart School SaaS — Phase 1 local setup for Windows 11 (Docker path)
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Require($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $cmd — $hint" -ForegroundColor Red; exit 1
  }
}

Require "node"   "Install Node.js LTS 20+ from nodejs.org"
Require "docker" "Install Docker Desktop (WSL 2 backend) and start it"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example (local dev values only)"
}

Write-Host "Starting PostgreSQL (docker compose)..."
docker compose up -d db

Write-Host "Waiting for PostgreSQL to become healthy..."
for ($i = 0; $i -lt 30; $i++) {
  $state = docker inspect -f "{{.State.Health.Status}}" school-saas-db 2>$null
  if ($state -eq "healthy") { break }
  Start-Sleep -Seconds 2
}
if ($state -ne "healthy") { Write-Host "Database did not become healthy." -ForegroundColor Red; exit 1 }

Write-Host "Installing dependencies..."
npm install

Write-Host "Validating Prisma schema..."
npx prisma format
npx prisma validate

Write-Host "Generating Prisma Client..."
npx prisma generate

Write-Host "Applying migrations (creates 'init' on first run)..."
npx prisma migrate dev --name init

Write-Host "Phase 1 local setup complete." -ForegroundColor Green
