# Probe: does a child blocked on an undrained stdout pipe explain the first probe's
# "process still alive seconds after it released the resource" reading?
# ASCII only; results -> UTF-8 log.
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'pipe-probe-log.txt'
$script = Join-Path $env:TEMP 'pipe-probe-child.ps1'
$ready = Join-Path $env:TEMP 'pipe-probe-ready.txt'
$line = New-Object System.Collections.Generic.List[string]

function New-Child([int]$holdMs, [bool]$redirect, [string]$outPath) {
    $code = @"
Set-Content -Path '$ready' -Value 'up' -Encoding ascii
Start-Sleep -Milliseconds $holdMs
Write-Output ('child says: ' + ('x' * 200))
"@
    Set-Content -Path $script -Value $code -Encoding ascii
    Remove-Item $ready -ErrorAction SilentlyContinue
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $redirect
    if ($redirect -and $outPath) {
        # .NET has no direct "file" redirect here; use the drained path instead (see below)
    }
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($redirect) { $p.BeginOutputReadLine() }   # <-- the fix: drain the pipe
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path $ready)) {
        if ($sw.Elapsed.TotalSeconds -gt 10) { throw 'child not ready' }
        Start-Sleep -Milliseconds 20
    }
    return $p
}

# Case 1: stdout captured but NOT drained (RedirectStandardOutput = true, no BeginOutputReadLine)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$code = @"
Set-Content -Path '$ready' -Value 'up' -Encoding ascii
Start-Sleep -Milliseconds 200
[Console]::Out.Write(('y' * 200000))
"@
Set-Content -Path $script -Value $code -Encoding ascii
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
Remove-Item $ready -ErrorAction SilentlyContinue
$p1 = [System.Diagnostics.Process]::Start($psi)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while (-not (Test-Path $ready)) { Start-Sleep -Milliseconds 20 }
$sw.Restart()
$exited = $p1.WaitForExit(8000)
$line.Add(("case 1 undrained pipe, 200KB write : WaitForExit(8000) returned={0} after {1:N2}s (intended life 0.2s)" -f $exited, $sw.Elapsed.TotalSeconds))
$p1.Kill()

# Case 2: same write, but the pipe IS drained
$v = New-Child -holdMs 200 -redirect $true -outPath $null
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
$exited2 = $v.WaitForExit(8000)
$line.Add(("case 2 drained pipe, same 200KB write : WaitForExit(8000) returned={0} after {1:N2}s" -f $exited2, $sw2.Elapsed.TotalSeconds))

$line | Out-File -FilePath $log -Encoding utf8
"probe done -> $log"
