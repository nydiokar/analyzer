# Build and Start Script
# Builds both backend and frontend, then starts them in separate terminal windows

Write-Host "Building and starting services..." -ForegroundColor Cyan
Write-Host ""

# Get the script directory (project root)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check if pnpm is available
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: pnpm is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Install pnpm: corepack enable && corepack prepare pnpm@latest --activate" -ForegroundColor Yellow
    exit 1
}

# Step 1: Build Backend
Write-Host "Building backend..." -ForegroundColor Yellow
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Backend built successfully" -ForegroundColor Green
Write-Host ""

# Step 2: Build Frontend
Write-Host "Building frontend..." -ForegroundColor Yellow
Set-Location dashboard
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Frontend built successfully" -ForegroundColor Green
Write-Host ""

# Return to root
Set-Location $scriptDir

# Step 3: Start Backend in new terminal
Write-Host "Starting backend with PM2..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDir'; Write-Host 'Starting Backend API...' -ForegroundColor Cyan; pnpm run pm2:start:backend; Write-Host '`nBackend started. Use `pm2 logs` to view logs.' -ForegroundColor Green; pm2 logs"
Write-Host "Backend terminal opened" -ForegroundColor Green
Write-Host ""

# Step 4: Start Frontend in new terminal
Write-Host "Starting frontend..." -ForegroundColor Yellow
$frontendDir = Join-Path $scriptDir "dashboard"
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

