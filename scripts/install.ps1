# dream installer (Windows PowerShell)
#   .\scripts\install.ps1             build CLI + link + install the Claude Code plugin
#   .\scripts\install.ps1 -NoPlugin   build CLI + link only
param([switch]$NoPlugin)
$ErrorActionPreference = "Stop"
$RepoDir = Resolve-Path (Join-Path $PSScriptRoot "..")

function Say($msg)  { Write-Host "[dream] $msg" -ForegroundColor White }
function Fail($msg) { Write-Host "[dream] $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "node is required (v20+): https://nodejs.org" }
if (-not (Get-Command npm  -ErrorAction SilentlyContinue)) { Fail "npm is required (ships with node)" }
$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Fail "node v20+ required (found $(node -v))" }

Say "installing dependencies..."
npm install --prefix $RepoDir --silent
Say "building..."
npm run --prefix $RepoDir --silent build
Say "linking the dream CLI onto your PATH..."
Push-Location $RepoDir; npm link --silent; Pop-Location
if (-not (Get-Command dream -ErrorAction SilentlyContinue)) { Fail "npm link finished but 'dream' is not on PATH - check your npm prefix" }
Say "CLI ready: $((Get-Command dream).Source)"

if ($NoPlugin) { Say "skipping plugin install (-NoPlugin). Done."; exit 0 }

if (Get-Command claude -ErrorAction SilentlyContinue) {
    Say "registering the fiorastudio marketplace with Claude Code..."
    claude plugin marketplace add $RepoDir 2>$null; if ($LASTEXITCODE -ne 0) { claude plugin marketplace update fiorastudio | Out-Null }
    Say "installing the plugin..."
    claude plugin install dream@fiorastudio | Out-Null
    Say "plugin installed."
} else {
    Say "Claude Code CLI not found - install the plugin manually inside Claude Code:"
    Say "  /plugin marketplace add $RepoDir"
    Say "  /plugin install dream@fiorastudio"
}

Say ""
Say "dream is installed. Next, in any project you want dreamed:"
Say "  1. open Claude Code there and run /dream:setup"
Say "  2. or: dream init --project <path>; dream run --project <path> --dry-run"
Say "Uninstall any time: $RepoDir\scripts\uninstall.ps1"
