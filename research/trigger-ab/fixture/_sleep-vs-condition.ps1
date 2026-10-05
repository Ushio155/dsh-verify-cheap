# Probe: fixed Start-Sleep vs condition polling + timeout.
# Mirrors cleanup-accelerators.ps1:24 (Start-Sleep -Milliseconds 800) - the wait after
# killing processes / stopping a service, before the script touches the hosts file and cert stores.
#
# Victim = a child powershell that holds a named mutex for a known duration, then releases it.
# The mutex is the stand-in for "the resource the script assumes is free after 800 ms"
# (hosts file lock, cert store, port, ...). All output is ASCII and goes to a UTF-8 log
# (the console codepage mangles CJK). Child stdout/stderr are file-redirected so the
# child can never block on an undrained stdio pipe.
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'sleep-probe-log.txt'
$readyFile = Join-Path $env:TEMP 'sleep-probe-ready.txt'
$victimScript = Join-Path $env:TEMP 'sleep-probe-victim.ps1'
$victimOut = Join-Path $env:TEMP 'sleep-probe-victim.out'
$mutexName = 'Local\dsh-sleep-probe'
$line = New-Object System.Collections.Generic.List[string]

function Test-ResourceFree {
    $m = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $got = $m.WaitOne(0)
        if ($got) { $m.ReleaseMutex() }   # only the owning thread may release
        return $got
    } finally { $m.Dispose() }
}

function New-Victim([int]$holdMs) {
    $code = @"
`$m = New-Object System.Threading.Mutex(`$false, '$mutexName')
`$m.WaitOne() | Out-Null
Set-Content -Path '$readyFile' -Value 'holding' -Encoding ascii
Start-Sleep -Milliseconds $holdMs
`$m.ReleaseMutex()
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
    # drain the pipes in the background: a full pipe would block the child
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()
    # start measuring only once the child really holds the resource (kills startup jitter)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path $readyFile)) {
        if ($sw.Elapsed.TotalSeconds -gt 10) { throw 'victim never became ready' }
        Start-Sleep -Milliseconds 20
    }
    return $p
}

function Wait-UntilFree([int]$timeoutMs) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-ResourceFree)) {
        if ($sw.Elapsed.TotalMilliseconds -gt $timeoutMs) { return $null }
        Start-Sleep -Milliseconds 25
    }
    return $sw.Elapsed.TotalSeconds
}

$holdMs = 3000

# --- Case A: fixed delay (the script's shape) ---------------------------
$v = New-Victim -holdMs $holdMs
Start-Sleep -Milliseconds 800
$freeAt800 = Test-ResourceFree
$aliveAt800 = -not $v.HasExited
$extraA = Wait-UntilFree -timeoutMs 15000
$line.Add(("A fixed 800ms : at the 800ms mark resource-free={0} process-alive={1}" -f $freeAt800, $aliveAt800))
$line.Add(("                the script proceeds here; the resource only frees {0:N2}s later" -f $extraA))
$line.Add(("                => real need was {0:N2}s, fixed wait was 0.80s (short by {1:N2}s)" -f (0.8 + $extraA), $extraA))
$v.WaitForExit(15000) | Out-Null

# --- Case B: condition polling + timeout, same 3s victim ----------------
$v2 = New-Victim -holdMs $holdMs
$condB = Wait-UntilFree -timeoutMs 15000
$line.Add(("B poll+timeout: released after {0:N2}s, measured from the sentinel (wait set by the condition)" -f $condB))
$v2.WaitForExit(15000) | Out-Null

# --- Case C: resource frees fast -> what the fixed 800ms wastes ---------
$v3 = New-Victim -holdMs 120
$condC = Wait-UntilFree -timeoutMs 15000
$line.Add(("C fast victim : condition met after {0:N0}ms; the fixed 800ms would waste {1:N0}ms" -f ($condC * 1000), (800 - $condC * 1000)))
$v3.WaitForExit(15000) | Out-Null

$line | Out-File -FilePath $log -Encoding utf8
"probe done -> $log"
