# Start Script
# Starts both backend and frontend without building (assumes they're already built)

Write-Host "Starting services..." -ForegroundColor Cyan
Write-Host ""

# Get the script directory (project root)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check if pnpm is available
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "pnpm is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Install pnpm: corepack enable && corepack prepare pnpm@latest --activate" -ForegroundColor Yellow
    exit 1
}

# Check if backend is built
if (-not (Test-Path "dist")) {
    Write-Host "Backend not built. Run build-and-start.ps1 first or run 'pnpm run build'" -ForegroundColor Yellow
    $buildBackend = Read-Host "Build backend now? (y/n)"
    if ($buildBackend -eq "y" -or $buildBackend -eq "Y") {
        Write-Host "Building backend..." -ForegroundColor Yellow
        pnpm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Backend build failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "Backend built successfully" -ForegroundColor Green
    } else {
        Write-Host "Cannot start backend without build. Exiting." -ForegroundColor Red
        exit 1
    }
}

# Check if frontend is built (optional for dev mode, but let's check .next folder)
$frontendDir = Join-Path $scriptDir "dashboard"
if (-not (Test-Path (Join-Path $frontendDir ".next"))) {
    Write-Host "Frontend not built, but running in dev mode (build not required)" -ForegroundColor Blue
}

# Start Backend in new terminal
Write-Host "Starting backend with PM2..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir'; Write-Host 'Starting Backend API...' -ForegroundColor Cyan; pnpm run pm2:start:backend; Write-Host '`nBackend started. Use `pm2 logs` to view logs.' -ForegroundColor Green; pm2 logs"
Write-Host "Backend terminal opened" -ForegroundColor Green
Write-Host ""

# Start Frontend in new terminal
Write-Host "Starting frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; Write-Host 'Starting Frontend (Next.js)...' -ForegroundColor Cyan; pnpm run dev"
Write-Host "Frontend terminal opened" -ForegroundColor Green
Write-Host ""   

Write-Host "All services are starting in separate terminals!" -ForegroundColor Green
Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "   - Backend: Check the PM2 terminal for backend logs" -ForegroundColor White
Write-Host "   - Frontend: Usually runs on http://localhost:3000" -ForegroundColor White
Write-Host "   - Backend API: Usually runs on http://localhost:3001" -ForegroundColor White
Write-Host ""
Write-Host "To stop services:" -ForegroundColor Yellow
Write-Host "   - Close the terminal windows, or" -ForegroundColor White
Write-Host "   - Run: pm2 stop all (for backend)" -ForegroundColor White

