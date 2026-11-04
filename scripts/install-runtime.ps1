$ErrorActionPreference = 'Stop'
$name = 'electron-v44.10.2-win32-x64.zip'
$expected = '7af18e85a1537b832924ae3b0e5146602f2f4f4b0c77c74e4ae0dc251ca338f9'
$stage = $null
$backup = $null
$target = $null
try {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
        throw 'This runtime package is for Windows x64 only.'
    }
    $archive = Join-Path $PSScriptRoot $name
    if (!(Test-Path -LiteralPath $archive -PathType Leaf)) {
        throw 'Extract the ENTIRE offline bundle first, then run install-runtime.cmd.'
    }
    Write-Host 'Checking official Electron SHA-256...'
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw 'SHA-256 mismatch. The archive is incomplete or damaged. Please download the offline bundle again.'
    }
    $root = $env:DSH_WHALE_MATE_HOME
    if (!$root) { $root = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh-whale-mate' }
    $runtime = Join-Path $root 'runtime'
    $target = Join-Path $runtime 'electron-v44.10.2-win32-x64'
    $marker = Join-Path $target '.complete'
    $exe = Join-Path $target 'electron.exe'
    if ((Test-Path -LiteralPath $marker) -and (Test-Path -LiteralPath $exe)) {
        Write-Host "Runtime already installed: $target"
        exit 0
    }
    [IO.Directory]::CreateDirectory($runtime) | Out-Null
    $stage = Join-Path $runtime ('offline-' + [Guid]::NewGuid().ToString('N'))
    Write-Host 'Extracting runtime (no network or administrator rights required)...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
    if (!(Test-Path -LiteralPath (Join-Path $stage 'electron.exe') -PathType Leaf)) {
        throw 'electron.exe missing from extracted archive.'
    }
    [IO.File]::WriteAllText((Join-Path $stage '.complete'), "$name $expected`n", [Text.Encoding]::ASCII)
    if (Test-Path -LiteralPath $target) {
        $backup = $target + '.backup-' + [Guid]::NewGuid().ToString('N')
        [IO.Directory]::Move($target, $backup)
    }
    [IO.Directory]::Move($stage, $target)
    $stage = $null
    Write-Host "Installed: $target"
    if ($backup) { Write-Host "Previous incomplete installation preserved at: $backup" }
    Write-Host 'Open DeepSeek Harness, then enable Whale Mate desktop mode.'
    Write-Host 'Plugin 0.5.3 and 0.5.4 both recognize this runtime. No further runtime download is needed.'
    exit 0
} catch {
    Write-Host ("INSTALL FAILED: " + $_.Exception.Message) -ForegroundColor Red
    if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    if ($backup -and !(Test-Path -LiteralPath $target)) {
        try { [IO.Directory]::Move($backup, $target) } catch { Write-Host "Previous installation remains at: $backup" }
    }
    Write-Host 'Close Harness completely (including its tray icon) before retrying.'
    exit 1
}
