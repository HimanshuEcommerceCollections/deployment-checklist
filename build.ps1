# PowerShell build script
npx prisma generate
if ($LASTEXITCODE -ne 0) { exit 1 }
npx next build
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "✓ Build completed successfully" -ForegroundColor Green
