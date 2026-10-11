# =====================================================
# GhostQuest — One-Command Windows Installer (install.ps1)
# Downloads GhostQuest, copies path to clipboard, and
# launches Brave / Chrome / Edge with the extension!
# =====================================================

$ErrorActionPreference = "Stop"
$RepoZip = "https://github.com/Nawasfadili/GhostQuest/archive/refs/heads/main.zip"
$InstallDir = Join-Path $env:USERPROFILE "GhostQuest"
$TempZip = Join-Path $env:TEMP "GhostQuest-main.zip"
$TempExtract = Join-Path $env:TEMP "GhostQuest-extract"

Write-Host ""
Write-Host "  👻 GhostQuest — Automatic Installer" -ForegroundColor Magenta
Write-Host "  ===================================" -ForegroundColor DarkGray

Write-Host "  [1/4] Downloading GhostQuest from GitHub..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $RepoZip -OutFile $TempZip -UseBasicParsing

Write-Host "  [2/4] Extracting extension to $InstallDir..." -ForegroundColor Cyan
if (Test-Path $TempExtract) { Remove-Item $TempExtract -Recurse -Force }
Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force

if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
Move-Item -Path (Join-Path $TempExtract "GhostQuest-main") -Destination $InstallDir -Force
Remove-Item $TempZip -Force -ErrorAction SilentlyContinue
Remove-Item $TempExtract -Recurse -Force -ErrorAction SilentlyContinue

# Copy install path to clipboard for instant Ctrl+V if needed
Set-Clipboard -Value $InstallDir
Write-Host "  [3/4] Extension path copied to clipboard: $InstallDir" -ForegroundColor Green

# Detect Chromium browsers (Brave, Chrome, Edge)
$Browsers = @(
  @{ Name = "Brave";  Path = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"; ExtUrl = "brave://extensions" },
  @{ Name = "Brave";  Path = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"; ExtUrl = "brave://extensions" },
  @{ Name = "Chrome"; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe";              ExtUrl = "chrome://extensions" },
  @{ Name = "Chrome"; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe";              ExtUrl = "chrome://extensions" },
  @{ Name = "Edge";   Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe";      ExtUrl = "edge://extensions" }
)

$FoundBrowser = $null
foreach ($b in $Browsers) {
  if (Test-Path $b.Path) {
    $FoundBrowser = $b
    break
  }
}

Write-Host "  [4/4] Launching browser..." -ForegroundColor Cyan
if ($FoundBrowser) {
  Start-Process -FilePath $FoundBrowser.Path -ArgumentList "--load-extension=`"$InstallDir`"", "https://discord.com/quest-home"
  Write-Host ""
  Write-Host "  ✅ GhostQuest installed to: $InstallDir" -ForegroundColor Green
  Write-Host "  👉 If your browser was already open:" -ForegroundColor Yellow
  Write-Host "     1. Go to $($FoundBrowser.ExtUrl) and enable Developer mode" -ForegroundColor White
  Write-Host "     2. Click 'Load unpacked', press Ctrl+V (path is already copied!), and hit Enter!" -ForegroundColor White
} else {
  Write-Host "  ✅ GhostQuest installed to: $InstallDir (copied to clipboard!)" -ForegroundColor Green
  Write-Host "  Open chrome://extensions -> Load unpacked -> press Ctrl+V!" -ForegroundColor Yellow
}
Write-Host ""
