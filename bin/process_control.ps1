param([int]$processId, [string]$action)

$source = @"
using System;
using System.Runtime.InteropServices;
public class Win32Proc {
    [DllImport("ntdll.dll")]
    public static extern uint NtSuspendProcess(IntPtr processHandle);
    [DllImport("ntdll.dll")]
    public static extern uint NtResumeProcess(IntPtr processHandle);
}
"@

try {
    Add-Type -TypeDefinition $source -ErrorAction SilentlyContinue
} catch {}

$p = [System.Diagnostics.Process]::GetProcessById($processId)
if ($action -eq "suspend") {
    [Win32Proc]::NtSuspendProcess($p.Handle) | Out-Null
    Write-Output "SUSPENDED"
} elseif ($action -eq "resume") {
    [Win32Proc]::NtResumeProcess($p.Handle) | Out-Null
    Write-Output "RESUMED"
}
