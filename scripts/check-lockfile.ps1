$root = 'C:\Users\msi 22\.mavis\workspace\animbook'
$lockfile = Join-Path $root 'package-lock.json'
if (-not (Test-Path $lockfile)) {
    Write-Output 'LOCKFILE_MISSING'
    exit 0
}
$raw = [System.IO.File]::ReadAllText($lockfile)
try {
    $doc = [System.Text.Json.JsonDocument]::Parse($raw)
} catch {
    Write-Output ("PARSE_ERROR={0}" -f $_.Exception.Message)
    exit 0
}
$root2 = $doc.RootElement
Write-Output ("lock-version={0}" -f $root2.GetProperty('lockfileVersion').GetInt32())
$packages = $root2.GetProperty('packages')
$total = 0
$missing = @()
foreach ($p in $packages.EnumerateObject()) {
    $total += 1
    $rel = $p.Name
    if ($rel -eq '' -or $rel -eq 'apps/api' -or $rel -eq 'apps/web' -or $rel -eq 'packages/domain') { continue }
    if (-not $rel.StartsWith('node_modules/')) { continue }
    $pathRel = $rel.Substring('node_modules/'.Length)
    $fsPath = Join-Path (Join-Path $root 'node_modules') $pathRel
    if (-not (Test-Path -LiteralPath $fsPath)) {
        $missing += $pathRel
    }
}
Write-Output ("total-pkg-keys={0}" -f $total)
Write-Output ("missing-pkg-count={0}" -f $missing.Count)
foreach ($m in ($missing | Select-Object -First 25)) {
    Write-Output ("missing={0}" -f $m)
}