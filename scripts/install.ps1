param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$resolvedVault = (Resolve-Path -LiteralPath $VaultPath).ProviderPath
if (-not (Test-Path -LiteralPath $resolvedVault -PathType Container)) {
    throw 'VaultPath must identify an existing vault directory.'
}
$configPath = Join-Path $resolvedVault '.obsidian'
if (-not (Test-Path -LiteralPath $configPath -PathType Container)) {
    throw 'This directory does not contain .obsidian. Open it as an Obsidian vault first.'
}
$pluginPath = [IO.Path]::GetFullPath((Join-Path $configPath 'plugins\ai-contributions'))
if (-not $pluginPath.StartsWith($resolvedVault.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Plugin destination must be inside the selected vault.'
}

# Refuse links or junctions along the destination to keep writes in this vault.
foreach ($directory in @($resolvedVault, $configPath, (Join-Path $configPath 'plugins'), $pluginPath)) {
    if (Test-Path -LiteralPath $directory) {
        $item = Get-Item -LiteralPath $directory -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Destination contains a link or junction: $directory"
        }
    }
}

$sourcePath = Join-Path $projectPath 'dist\ai-contributions'
$files = @('main.js', 'manifest.json', 'styles.css', 'LICENSE')
foreach ($file in $files) {
    $sourceFile = Join-Path $sourcePath $file
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Missing release file: $sourceFile. Run npm run package first."
    }
    $destination = Join-Path $pluginPath $file
    if (Test-Path -LiteralPath $destination) {
        $item = Get-Item -LiteralPath $destination -Force
        if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Destination is not an ordinary file: $destination"
        }
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $sourcePath 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.id -ne 'ai-contributions') { throw 'Unexpected plugin ID in the release manifest.' }

Write-Output "Install AI Contributions $($manifest.version) into:"
Write-Output $pluginPath
foreach ($file in $files) { Write-Output "  $file" }
if (-not $Apply) {
    Write-Output 'Preview only. Add -Apply to install. Existing plugin files will be backed up.'
    return
}

$existing = @($files | Where-Object { Test-Path -LiteralPath (Join-Path $pluginPath $_) -PathType Leaf })
if ($existing.Count -gt 0) {
    $backupRoot = Join-Path $configPath 'plugin-backups'
    if (Test-Path -LiteralPath $backupRoot) {
        if (((Get-Item -LiteralPath $backupRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Backup destination is a link or junction: $backupRoot"
        }
    }
    $backupPath = Join-Path $backupRoot ("ai-contributions-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $backupPath | Out-Null
    foreach ($file in $existing) {
        Copy-Item -LiteralPath (Join-Path $pluginPath $file) -Destination (Join-Path $backupPath $file)
    }
    Write-Output "Previous plugin files backed up to: $backupPath"
}
New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $sourcePath $file) -Destination (Join-Path $pluginPath $file) -Force
}
Write-Output 'Installed. Reload Obsidian and enable AI Contributions under Settings > Community plugins.'
