# Probe: after Stop-Process -Force, how long does the victim keep its file handle?
# This is exactly the thing cleanup-accelerators.ps1:24 "waits for" with Start-Sleep -Milliseconds 800:
# the next thing the script does is WriteAllLines to C:\Windows\System32\drivers\etc\hosts.
# Victim opens a scratch file with FileShare.None, then holds it for a known time.
# ASCII only; results -> UTF-8 log (the console codepage mangles CJK).
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'sleep-probe-file-log.txt'
$readyFile = Join-Path $env:TEMP 'file-probe-ready.txt'
$lockFile = Join-Path $env:TEMP 'file-probe-locked.txt'
$victimScript = Join-Path $env:TEMP 'file-probe-victim.ps1'
$line = New-Object System.Collections.Generic.List[string]

function Test-LockFree {
    try {
        $fs = [System.IO.File]::Open($lockFile, 'OpenOrCreate', 'ReadWrite', 'None')
        $fs.Close()
        return $true
    } catch { return $false }
}

function New-Locker([int]$holdMs) {
    $code = @"
`$ErrorActionPreference = 'Stop'
`$fs = [System.IO.File]::Open('$lockFile', 'OpenOrCreate', 'ReadWrite', 'None')
Set-Content -Path '$readyFile' -Value 'locked' -Encoding ascii
Start-Sleep -Milliseconds $holdMs
`$fs.Close()
"@
    Set-Content -Path $victimScript -Value $code -Encoding ascii
    Remove-Item $readyFile -ErrorAction SilentlyContinue
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$victimScript`""
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.BeginOutputReadLine(); $p.BeginErrorReadLine()
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path $readyFile)) {
        if ($sw.Elapsed.TotalSeconds -gt 10) { throw 'victim never became ready' }
        Start-Sleep -Milliseconds 20
    }
    return $p
}

# Victim intends to hold for 5 s, but we kill it after 400 ms - the script's situation.
$v = New-Locker -holdMs 5000
Start-Sleep -Milliseconds 400
Stop-Process -Id $v.Id -Force
$killSw = [System.Diagnostics.Stopwatch]::StartNew()

Start-Sleep -Milliseconds 800
$freeAt800 = Test-LockFree
$line.Add(("after kill + Start-Sleep 800ms : lock-free={0}" -f $freeAt800))

$t = [System.Diagnostics.Stopwatch]::StartNew()
while (-not (Test-LockFree)) {
    if ($t.Elapsed.TotalSeconds -gt 20) { break }
    Start-Sleep -Milliseconds 25
}
$line.Add(("condition polled from the kill  : killed at t=0.40s, handle released at t={0:N2}s" -f ($killSw.Elapsed.TotalSeconds)))
$line.Add(("                                  i.e. polling waited {0:N2}s after the kill" -f $t.Elapsed.TotalSeconds))
$line.Add(("                                  the script's fixed 800ms was short by {0:N2}s" -f ($t.Elapsed.TotalSeconds - 0.8)))
$line | Out-File -FilePath $log -Encoding utf8
"probe done -> $log"
