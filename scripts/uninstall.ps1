# dream uninstaller (Windows PowerShell)
#   .\scripts\uninstall.ps1         remove the plugin + unlink the CLI
#   .\scripts\uninstall.ps1 -Purge  also delete ~\.dream (watermarks, run reports, badges)
param([switch]$Purge)
$ErrorActionPreference = "SilentlyContinue"

function Say($msg) { Write-Host "[dream] $msg" -ForegroundColor White }

if (Get-Command claude -ErrorAction SilentlyContinue) {
    Say "removing the Claude Code plugin..."
    claude plugin uninstall dream@fiorastudio | Out-Null
    claude plugin marketplace remove fiorastudio | Out-Null
} else {
    Say "Claude Code CLI not found - if installed, remove manually: /plugin uninstall dream@fiorastudio"
}

Say "unlinking the dream CLI..."
npm rm --global --silent dream | Out-Null

if ($Purge) {
    Say "purging ~\.dream (state, run reports, badges)..."
    Remove-Item -Recurse -Force (Join-Path $HOME ".dream")
} else {
    Say "kept ~\.dream (watermarks/run history). Purge with: uninstall.ps1 -Purge"
}

Say "note: per-project .dream\config.json files and memory stores are never touched."
Say "note: if you wired 'dream statusline' into ~\.claude\settings.json, remove that entry yourself."
Say "done."
