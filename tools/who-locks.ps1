<#
    Shows which processes hold a file open (Windows Restart Manager + exclusive-open probe).
    Use it when yarn build / yarn pkg dies with "EBUSY: unlink ... app.asar".

      powershell -NoProfile -ExecutionPolicy Bypass -File tools\who-locks.ps1 -Path "build\1.0.6\win-unpacked\resources\app.asar"

    STATE=FREE  : nobody holds it right now (a lock that already came and went)
    STATE=BUSY  : a handle exists; HOLDER lists the processes Restart Manager can see.
                  BUSY with no HOLDER means an anti-virus / kernel handle, or the lock
                  was released between the two probes.
    Keep this file ASCII: Windows PowerShell 5.1 decodes BOM-less scripts in the ANSI
    codepage, and non-ASCII bytes there break string parsing.
#>
param(
    [Parameter(Mandatory = $true)][string[]]$Path
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$src = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class LockProbe {
    const int CCH_RM_SESSION_KEY = 66;
    const int APP_TITLE_MAX_LEN = 256;
    const int APP_NAME_MAX_LEN = 128;
    const int ERROR_SUCCESS = 0;
    const int ERROR_MORE_DATA = 234;
    const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS {
        public int dwProcessId;
        public int dwLowDateTime;
        public int dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 1)]
    struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = APP_TITLE_MAX_LEN)]
        public string strAppTitle;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = APP_NAME_MAX_LEN)]
        public string strServiceDisplayName;
        public uint dwRestartReason;
        public uint dwAppRecovery;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);

    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
        uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo,
        [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    public static string ExclusiveOpen(string file) {
        try {
            using (FileStream fs = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            return "FREE";
        } catch (IOException) {
            return "BUSY";
        }
    }

    public static List<string[]> Holders(string file) {
        var result = new List<string[]>();
        uint session;
        var key = new StringBuilder(CCH_RM_SESSION_KEY);
        int rc = RmStartSession(out session, 0, key);
        if (rc != ERROR_SUCCESS) throw new Win32Exception(rc, "RmStartSession");
        try {
            rc = RmRegisterResources(session, 1, new string[] { file }, 0, null, 0, null);
            if (rc != ERROR_SUCCESS) throw new Win32Exception(rc, "RmRegisterResources");

            uint needed = 0, count = 0, reasons = 0;
            rc = RmGetList(session, out needed, ref count, null, ref reasons);
            if (rc == ERROR_SUCCESS || rc == ERROR_NOT_FOUND || needed == 0) return result;
            if (rc != ERROR_MORE_DATA) throw new Win32Exception(rc, "RmGetList");

            var infos = new RM_PROCESS_INFO[needed];
            count = needed;
            rc = RmGetList(session, out needed, ref count, infos, ref reasons);
            if (rc != ERROR_SUCCESS) throw new Win32Exception(rc, "RmGetList");
            for (int i = 0; i < count; i++)
                result.Add(new string[] {
                    infos[i].Process.dwProcessId.ToString(),
                    infos[i].strAppTitle ?? "",
                    infos[i].strServiceDisplayName ?? ""
                });
            return result;
        } finally { RmEndSession(session); }
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

foreach ($item in $Path) {
    $resolved = Resolve-Path -LiteralPath $item -ErrorAction SilentlyContinue
    if (-not $resolved) {
        Write-Output ("FILE  : {0}" -f $item)
        Write-Output "STATE : MISSING"
        Write-Output ""
        continue
    }
    $file = $resolved.Path
    $state = [LockProbe]::ExclusiveOpen($file)
    Write-Output ("FILE  : {0}" -f $file)
    Write-Output ("STATE : {0}" -f $state)
    try {
        $holders = [LockProbe]::Holders($file)
    } catch {
        Write-Output ("HOLDER: query failed - " + $_.Exception.Message)
        Write-Output ""
        continue
    }
    if ($holders.Count -eq 0) {
        if ($state -eq 'BUSY') {
            Write-Output "HOLDER: none visible to Restart Manager (anti-virus / kernel handle, or released between probes)"
        } else {
            Write-Output "HOLDER: none"
        }
        Write-Output ""
        continue
    }
    foreach ($h in $holders) {
        $procId = $h[0]
        $exe = ''
        try { $exe = (Get-Process -Id $procId -ErrorAction Stop).Path } catch { }
        Write-Output ("HOLDER: pid={0} name={1} service={2} exe={3}" -f $procId, $h[1], $h[2], $exe)
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -and $cmd.Length -gt 200) { $cmd = $cmd.Substring(0, 200) }
        if ($cmd) { Write-Output ("        cmd={0}" -f $cmd) }
    }
    Write-Output ""
}
