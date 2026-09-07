#Requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'This bootstrap supports Windows x64 only. The pilot pins a Windows Dafny toolchain.'
}

$workspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$toolsRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.tools'))
$lock = Get-Content -LiteralPath (Join-Path $workspace 'toolchain.json') -Raw | ConvertFrom-Json
if ($lock.schemaVersion -ne 1 -or $lock.dafny.platform -ne 'win-x64') {
    throw 'Unsupported toolchain lock format or platform.'
}

function Get-ToolsPath([string] $RelativePath) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $workspace $RelativePath))
    if (-not $absolute.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw "Toolchain path escapes workspace .tools: $RelativePath"
    }
    return $absolute
}

function Assert-Sha256([string] $Path, [string] $Expected) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Missing toolchain file: $Path"
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $Expected) {
        throw "SHA256 mismatch for $Path. Expected $Expected; got $actual."
    }
}

function Assert-ToolchainTree([string] $Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "Missing toolchain directory: $Root"
    }
    # Reject junctions/symlinks rather than hashing outside the pinned directory.
    $entries = @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
    if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) {
        throw 'The toolchain must not contain symbolic links or junctions.'
    }
    $paths = [string[]]@($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        $_.FullName.Substring($Root.Length + 1).Replace('\', '/')
    })
    if ($paths.Length -ne $lock.dafny.integrity.fileCount) {
        throw "Toolchain integrity mismatch: expected $($lock.dafny.integrity.fileCount) files; got $($paths.Length)."
    }
    [Array]::Sort($paths, [StringComparer]::Ordinal)
    $manifest = New-Object System.Text.StringBuilder
    foreach ($relative in $paths) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $Root $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
        [void]$manifest.Append($relative).Append("`t").Append($hash).Append("`n")
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = ([BitConverter]::ToString($sha.ComputeHash(
                    [Text.Encoding]::UTF8.GetBytes($manifest.ToString())))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
    if ($digest -cne $lock.dafny.integrity.treeSha256) {
        throw "Toolchain integrity mismatch: expected $($lock.dafny.integrity.treeSha256); got $digest."
    }
}

$install = Get-ToolsPath $lock.dafny.installDirectory
$archive = Get-ToolsPath $lock.dafny.archive.path
$executable = Get-ToolsPath $lock.dafny.executable.path
$solver = Get-ToolsPath $lock.dafny.solver.path
$integrityRoot = Get-ToolsPath $lock.dafny.integrity.root

if (Test-Path -LiteralPath $install) {
    # A mismatched existing installation fails closed and is preserved for inspection.
    Assert-ToolchainTree $integrityRoot
    Assert-Sha256 $executable $lock.dafny.executable.sha256
    Assert-Sha256 $solver $lock.dafny.solver.sha256
    Write-Host "Pinned Dafny $($lock.dafny.version) is already installed and all files match."
} else {
    New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
        $download = Get-ToolsPath ('.tools/download-' + [Guid]::NewGuid().ToString('N') + '.zip')
        Write-Host "Downloading pinned Dafny $($lock.dafny.version) from GitHub..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $lock.dafny.archive.url -OutFile $download
        Assert-Sha256 $download $lock.dafny.archive.sha256
        Move-Item -LiteralPath $download -Destination $archive
    }
    Assert-Sha256 $archive $lock.dafny.archive.sha256
    $staging = Get-ToolsPath ('.tools/extract-' + [Guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    Assert-ToolchainTree (Join-Path $staging 'dafny')
    # Both absolute directory paths were checked by Get-ToolsPath; no recursive deletion.
    Move-Item -LiteralPath $staging -Destination $install
    Assert-Sha256 $executable $lock.dafny.executable.sha256
    Assert-Sha256 $solver $lock.dafny.solver.sha256
    Write-Host "Installed checksum-verified Dafny $($lock.dafny.version) inside .tools."
}

$version = (& $executable --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -cne $lock.dafny.versionOutput) {
    throw "Dafny version mismatch or launch failure: $version"
}
Write-Output $executable
