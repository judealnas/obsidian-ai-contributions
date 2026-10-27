param(
    [string]$RepositoryName = 'obsidian-ai-contributions'
)

$ErrorActionPreference = 'Stop'
if ($RepositoryName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw 'RepositoryName must be an ordinary GitHub repository name.'
}
$projectPath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectPath
try {
    # Use the existing GitHub CLI login without reading or displaying credentials.
    $owner = gh api user --jq .login
    if ($LASTEXITCODE -ne 0 -or -not $owner) {
        throw 'GitHub authentication failed. Run gh auth login, then retry.'
    }
    $owner = $owner.Trim()
    if (-not (Test-Path -LiteralPath (Join-Path $projectPath '.git'))) {
        git init -b main
        if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the local repository.' }
    }
    $remotes = @(git remote)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Git remotes.' }
    if ($remotes -contains 'origin') {
        throw 'An origin remote already exists. Inspect it before publishing again.'
    }

    # Explicit source paths exclude build tools, dependencies, caches, and ZIPs.
    git add -- .gitignore LICENSE README.md esbuild.config.mjs manifest.json package.json package-lock.json scripts src styles.css tests tsconfig.json versions.json
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the plugin source.' }
    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw 'Fix the reported whitespace errors before publishing.' }
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) {
        git commit -m 'Create AI Contributions Obsidian plugin'
        if ($LASTEXITCODE -ne 0) { throw 'Could not commit the plugin source.' }
    } elseif ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect staged changes.'
    }
    gh repo create $RepositoryName --public --source $projectPath --remote origin --push --description 'Accept or reject AI callouts directly inside Obsidian notes.'
    if ($LASTEXITCODE -ne 0) { throw 'GitHub repository creation or push failed. No existing repository was overwritten.' }
    $published = gh repo view "$owner/$RepositoryName" --json url,isPrivate
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the published repository.' }
    $repository = $published | ConvertFrom-Json
    if ($repository.isPrivate) { throw 'Repository visibility is unexpectedly private.' }
    Write-Output "Published public repository: $($repository.url)"
} finally {
    Pop-Location
}
