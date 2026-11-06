[CmdletBinding()]
param(
    [string[]] $Name
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repositoryRoot "references/manifest.json"
$destinationRoot = Join-Path $repositoryRoot ".reference-src"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

$selected = @($manifest.repositories | Where-Object {
    if ($Name.Count -gt 0) {
        $Name -contains $_.name
    }
    else {
        $_.defaultFetch -eq $true
    }
})

if ($Name.Count -gt 0) {
    $missing = @($Name | Where-Object { $_ -notin @($manifest.repositories.name) })
    if ($missing.Count -gt 0) {
        throw "Unknown reference name(s): $($missing -join ', ')"
    }
}
New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null

foreach ($entry in $selected) {
    $destination = Join-Path $destinationRoot $entry.name
    if (Test-Path -LiteralPath $destination) {
        $actualOrigin = git -C $destination remote get-url origin
        $actualRevision = git -C $destination rev-parse HEAD
        if ($LASTEXITCODE -ne 0) {
            throw "Existing reference is not a readable Git checkout: $destination"
        }
        if ($actualOrigin -ne $entry.repository) {
            throw "Origin mismatch for $($entry.name): $actualOrigin"
        }
        if ($entry.revision -match '^[0-9a-f]{40}$' -and $actualRevision -ne $entry.revision) {
            throw "Revision mismatch for $($entry.name): $actualRevision"
        }
        Write-Host "Verified $($entry.name) at $actualRevision"
        continue
    }

    git clone --filter=blob:none --no-checkout $entry.repository $destination
    if ($LASTEXITCODE -ne 0) {
        throw "Clone failed for $($entry.name)"
    }
    git -C $destination checkout --detach $entry.revision
    if ($LASTEXITCODE -ne 0) {
        throw "Checkout failed for $($entry.name) at $($entry.revision)"
    }
    $actualRevision = git -C $destination rev-parse HEAD
    Write-Host "Fetched $($entry.name) at $actualRevision"
}
