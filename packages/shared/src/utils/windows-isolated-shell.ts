import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

const source = String.raw`
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class SelectionWindowsSandbox {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertStringSidToSid(string value, out IntPtr sid);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string value, uint revision, out IntPtr descriptor, out uint size);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr acl, out bool defaulted);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr acl, out bool defaulted);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint SetNamedSecurityInfo(string path, int objectType, uint securityInfo, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetNamedSecurityInfo(string path, int objectType, uint securityInfo, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr descriptor, uint revision, uint securityInfo, out IntPtr text, out uint length);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disableCount, IntPtr disableSids, uint privilegeCount, IntPtr privileges, uint restrictCount, SidAndAttributes[] restrictSids, out IntPtr restricted);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int impersonation, int tokenType, out IntPtr duplicate);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool GetTokenInformation(IntPtr token, int tokenClass, IntPtr information, uint length, out uint returned);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool SetTokenInformation(IntPtr token, int tokenClass, IntPtr information, uint length);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInformation process);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr value);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll")]
  static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetStdHandle(int handle);

  [StructLayout(LayoutKind.Sequential)]
  struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)]
  struct TokenMandatoryLabel { public SidAndAttributes Label; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct StartupInfo {
    public int cb; public string reserved; public string desktop; public string title;
    public int x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
    public short showWindow, cbReserved2; public IntPtr reserved2;
    public IntPtr input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInformation { public IntPtr Process, Thread; public int ProcessId, ThreadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimit { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public IntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

  static void Check(bool ok, string operation) {
    if (!ok) {
      var code = Marshal.GetLastWin32Error();
      throw new System.ComponentModel.Win32Exception(code, operation + " failed with Win32 error " + code);
    }
  }
  static void Error(uint error, string operation) {
    if (error != 0) throw new System.ComponentModel.Win32Exception((int)error, operation + " failed with Win32 error " + error);
  }
  static IntPtr Sid(string text) {
    IntPtr sid;
    Check(ConvertStringSidToSid(text, out sid), "ConvertStringSidToSid");
    return sid;
  }
  static string LogonSid(IntPtr token) {
    uint needed;
    GetTokenInformation(token, 28, IntPtr.Zero, 0, out needed);
    var memory = Marshal.AllocHGlobal((int)needed);
    try {
      Check(GetTokenInformation(token, 28, memory, needed, out needed), "GetTokenInformation(TokenLogonSid)");
      return new SecurityIdentifier(Marshal.ReadIntPtr(memory, IntPtr.Size == 8 ? 8 : 4)).Value;
    } finally { Marshal.FreeHGlobal(memory); }
  }
  static string UserSid(IntPtr token) {
    uint needed;
    GetTokenInformation(token, 1, IntPtr.Zero, 0, out needed);
    var memory = Marshal.AllocHGlobal((int)needed);
    try {
      Check(GetTokenInformation(token, 1, memory, needed, out needed), "GetTokenInformation(TokenUser)");
      return new SecurityIdentifier(Marshal.ReadIntPtr(memory)).Value;
    } finally { Marshal.FreeHGlobal(memory); }
  }
  sealed class SecuritySnapshot {
    public string Path;
    public string Sddl;
  }
  static readonly HashSet<string> journaled = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
  static string activeJournal = "";
  static string EncodeText(string value) {
    return Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
  }
  static string DecodeText(string value) {
    return Encoding.UTF8.GetString(Convert.FromBase64String(value));
  }
  static List<SecuritySnapshot> ReadJournal(string journal) {
    var snapshots = new List<SecuritySnapshot>();
    if (!File.Exists(journal)) return snapshots;
    var content = File.ReadAllText(journal, Encoding.UTF8);
    var lines = content.Split(new char[] { '\n' });
    for (var index = 0; index < lines.Length; index++) {
      var line = lines[index].TrimEnd('\r');
      if (String.IsNullOrWhiteSpace(line)) continue;
      // A crash can interrupt the final append before Flush(true). That entry
      // has not been mutated yet, so recover all prior complete records.
      if (index == lines.Length - 1 && !content.EndsWith("\n", StringComparison.Ordinal)) continue;
      var fields = line.Split(new char[] { '\t' }, 2);
      if (fields.Length != 2) throw new InvalidDataException("Invalid Windows sandbox security journal");
      snapshots.Add(new SecuritySnapshot { Path = DecodeText(fields[0]), Sddl = DecodeText(fields[1]) });
    }
    return snapshots;
  }
  static void PrepareJournal(string journal) {
    if (String.Equals(activeJournal, journal, StringComparison.OrdinalIgnoreCase)) return;
    activeJournal = journal;
    journaled.Clear();
    foreach (var snapshot in ReadJournal(journal)) journaled.Add(snapshot.Path);
  }
  static byte[] SnapshotRecord(FileSystemInfo entry) {
    var path = entry.FullName;
    IntPtr owner, group, dacl, sacl, descriptor;
    Error(GetNamedSecurityInfo(path, 1, 0x14, out owner, out group, out dacl, out sacl, out descriptor), "GetNamedSecurityInfo(SecuritySnapshot)");
    IntPtr text = IntPtr.Zero;
    try {
      uint length;
      Check(ConvertSecurityDescriptorToStringSecurityDescriptor(descriptor, 1, 0x14, out text, out length), "ConvertSecurityDescriptorToStringSecurityDescriptor");
      var sddl = Marshal.PtrToStringUni(text);
      return Encoding.UTF8.GetBytes(EncodeText(path) + "\t" + EncodeText(sddl) + "\n");
    } finally {
      if (text != IntPtr.Zero) LocalFree(text);
      if (descriptor != IntPtr.Zero) LocalFree(descriptor);
    }
  }
  static void AppendSnapshot(FileSystemInfo entry, FileStream stream) {
    var path = entry.FullName;
    if (journaled.Contains(path)) return;
    var record = SnapshotRecord(entry);
    stream.Write(record, 0, record.Length);
    journaled.Add(path);
  }
  static void SnapshotTreeEntry(FileSystemInfo entry, FileStream stream) {
    AppendSnapshot(entry, stream);
    var directory = entry as DirectoryInfo;
    if (directory == null) return;
    foreach (var child in directory.EnumerateFileSystemInfos()) {
      if ((child.Attributes & FileAttributes.ReparsePoint) == 0) SnapshotTreeEntry(child, stream);
    }
  }
  public static void SnapshotTree(string path, string journal) {
    PrepareJournal(journal);
    using (var stream = new FileStream(journal, FileMode.Append, FileAccess.Write, FileShare.Read)) {
      SnapshotTreeEntry(new DirectoryInfo(path), stream);
      stream.Flush(true);
    }
  }
  static void Snapshot(FileSystemInfo entry, string journal) {
    if (String.IsNullOrEmpty(journal)) return;
    PrepareJournal(journal);
    if (journaled.Contains(entry.FullName)) return;
    var record = SnapshotRecord(entry);
    using (var stream = new FileStream(journal, FileMode.Append, FileAccess.Write, FileShare.Read)) {
      stream.Write(record, 0, record.Length);
      stream.Flush(true);
    }
    journaled.Add(entry.FullName);
  }
  public static void MarkReady(string path) {
    var record = Encoding.UTF8.GetBytes("ready\n");
    using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) {
      stream.Write(record, 0, record.Length);
      stream.Flush(true);
    }
  }
  static void RestoreSnapshot(SecuritySnapshot snapshot) {
    if (!Directory.Exists(snapshot.Path) && !File.Exists(snapshot.Path)) return;
    IntPtr descriptor;
    uint size;
    Check(ConvertStringSecurityDescriptorToSecurityDescriptor(snapshot.Sddl, 1, out descriptor, out size), "ConvertStringSecurityDescriptorToSecurityDescriptor(SecuritySnapshot)");
    try {
      bool present, defaulted;
      IntPtr dacl, sacl;
      Check(GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted), "GetSecurityDescriptorDacl(SecuritySnapshot)");
      Check(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted), "GetSecurityDescriptorSacl(SecuritySnapshot)");
      Error(SetNamedSecurityInfo(snapshot.Path, 1, 0x14, IntPtr.Zero, IntPtr.Zero, dacl, sacl), "SetNamedSecurityInfo(SecuritySnapshot)");
    } finally { LocalFree(descriptor); }
  }
  static void PurgeCapability(FileSystemInfo entry, SecurityIdentifier capability) {
    if (entry is DirectoryInfo) {
      var directory = (DirectoryInfo)entry;
      var security = directory.GetAccessControl();
      security.PurgeAccessRules(capability);
      directory.SetAccessControl(security);
    } else {
      var file = (FileInfo)entry;
      var security = file.GetAccessControl();
      security.PurgeAccessRules(capability);
      file.SetAccessControl(security);
    }
  }
  static bool HasCapability(FileSystemInfo entry, SecurityIdentifier rootCapability, SecurityIdentifier tempCapability) {
    AuthorizationRuleCollection rules;
    if (entry is DirectoryInfo) rules = ((DirectoryInfo)entry).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier));
    else rules = ((FileInfo)entry).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier));
    foreach (FileSystemAccessRule rule in rules) {
      var identity = rule.IdentityReference as SecurityIdentifier;
      if (identity != null && (identity.Equals(rootCapability) || identity.Equals(tempCapability))) return true;
    }
    return false;
  }
  static void CleanNewEntries(FileSystemInfo entry, HashSet<string> original, SecurityIdentifier rootCapability, SecurityIdentifier tempCapability) {
    if (!original.Contains(entry.FullName) && HasCapability(entry, rootCapability, tempCapability)) {
      PurgeCapability(entry, rootCapability);
      PurgeCapability(entry, tempCapability);
      Error(SetNamedSecurityInfo(entry.FullName, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero), "SetNamedSecurityInfo(ClearIntegrityLabel)");
    }
    var directory = entry as DirectoryInfo;
    if (directory == null) return;
    foreach (var child in directory.EnumerateFileSystemInfos()) {
      if ((child.Attributes & FileAttributes.ReparsePoint) == 0) CleanNewEntries(child, original, rootCapability, tempCapability);
    }
  }
  public static void Restore(string root, string rootCapabilityText, string tempCapabilityText, string journal, string ready) {
    var snapshots = ReadJournal(journal);
    if (snapshots.Count == 0) return;
    var original = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var snapshot in snapshots) {
      original.Add(snapshot.Path);
      RestoreSnapshot(snapshot);
    }
    if (File.Exists(ready) && Directory.Exists(root)) CleanNewEntries(new DirectoryInfo(root), original, new SecurityIdentifier(rootCapabilityText), new SecurityIdentifier(tempCapabilityText));
  }
  static void TerminateJob(string name) {
    const string prefix = "SelectionWindowsSandbox-";
    Guid identity;
    if (!name.StartsWith(prefix, StringComparison.Ordinal) || !Guid.TryParse(name.Substring(prefix.Length), out identity)) {
      // The marker is persisted before its process is spawned. A partial marker
      // therefore cannot identify a live sandbox job and is safe to ignore.
      return;
    }
    var job = OpenJobObject(0x0008, false, name);
    if (job == IntPtr.Zero) {
      var code = Marshal.GetLastWin32Error();
      if (code == 2) return;
      throw new System.ComponentModel.Win32Exception(code, "OpenJobObject failed with Win32 error " + code);
    }
    try { Check(TerminateJobObject(job, 125), "TerminateJobObject"); }
    finally { CloseHandle(job); }
  }
  public static void TerminateJobs(string directory) {
    if (!Directory.Exists(directory)) return;
    foreach (var marker in Directory.EnumerateFiles(directory, "*.job")) {
      var name = File.ReadAllText(marker, Encoding.UTF8).Trim();
      if (name.Length > 0) TerminateJob(name);
    }
  }
  static void LowLabel(string path) {
    IntPtr descriptor;
    uint size;
    Check(ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;;NW;;;LW)", 1, out descriptor, out size), "ConvertStringSecurityDescriptorToSecurityDescriptor");
    try {
      bool present, defaulted;
      IntPtr acl;
      Check(GetSecurityDescriptorSacl(descriptor, out present, out acl, out defaulted), "GetSecurityDescriptorSacl");
      Error(SetNamedSecurityInfo(path, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, acl), "SetNamedSecurityInfo(LowNoWriteUp)");
    } finally { LocalFree(descriptor); }
  }
  public static void Grant(string path, string capabilityText, string journal) {
    GrantDirectory(new DirectoryInfo(path), new SecurityIdentifier(capabilityText), new SecurityIdentifier("S-1-1-0"), journal);
  }
  static void GrantDirectory(DirectoryInfo directory, SecurityIdentifier capability, SecurityIdentifier everyone, string journal) {
    Snapshot(directory, journal);
    var security = directory.GetAccessControl();
    security.AddAccessRule(new FileSystemAccessRule(capability, FileSystemRights.Modify, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(everyone, FileSystemRights.DeleteSubdirectoriesAndFiles, InheritanceFlags.None, PropagationFlags.None, AccessControlType.Deny));
    directory.SetAccessControl(security);
    LowLabel(directory.FullName);
    foreach (var entry in directory.EnumerateFileSystemInfos()) {
      if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue;
      var child = entry as DirectoryInfo;
      if (child != null) GrantDirectory(child, capability, everyone, journal);
      else {
        var file = (FileInfo)entry;
        Snapshot(file, journal);
        var acl = file.GetAccessControl();
        acl.AddAccessRule(new FileSystemAccessRule(capability, FileSystemRights.Modify, InheritanceFlags.None, PropagationFlags.None, AccessControlType.Allow));
        file.SetAccessControl(acl);
        LowLabel(file.FullName);
      }
    }
  }
  public static void Deny(string path, string capabilityText, string journal) {
    var capability = new SecurityIdentifier(capabilityText);
    if (Directory.Exists(path)) DenyEntry(new DirectoryInfo(path), capability, journal);
    else if (File.Exists(path)) DenyEntry(new FileInfo(path), capability, journal);
  }
  static void DenyEntry(FileSystemInfo entry, SecurityIdentifier capability, string journal) {
    Snapshot(entry, journal);
    var rights = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles;
    if (entry is DirectoryInfo) {
      var directory = (DirectoryInfo)entry;
      var security = directory.GetAccessControl();
      security.AddAccessRule(new FileSystemAccessRule(capability, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Deny));
      directory.SetAccessControl(security);
      foreach (var child in directory.EnumerateFileSystemInfos()) {
        if ((child.Attributes & FileAttributes.ReparsePoint) == 0) DenyEntry(child, capability, journal);
      }
    } else {
      var file = (FileInfo)entry;
      var security = file.GetAccessControl();
      security.AddAccessRule(new FileSystemAccessRule(capability, rights, InheritanceFlags.None, PropagationFlags.None, AccessControlType.Deny));
      file.SetAccessControl(security);
    }
  }
  static void DefaultDacl(IntPtr token, IntPtr primary, string logon, string rootCapability, string tempCapability) {
    var sddl = "D:(A;;GA;;;" + UserSid(token) + ")(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;" + logon + ")(A;;GA;;;" + rootCapability + ")(A;;GA;;;" + tempCapability + ")(A;;GRGX;;;WD)";
    IntPtr descriptor;
    uint size;
    Check(ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out descriptor, out size), "ConvertStringSecurityDescriptorToSecurityDescriptor(DefaultDacl)");
    try {
      bool present, defaulted;
      IntPtr acl;
      Check(GetSecurityDescriptorDacl(descriptor, out present, out acl, out defaulted), "GetSecurityDescriptorDacl");
      var memory = Marshal.AllocHGlobal(IntPtr.Size);
      try {
        Marshal.WriteIntPtr(memory, acl);
        Check(SetTokenInformation(primary, 6, memory, (uint)IntPtr.Size), "SetTokenInformation(TokenDefaultDacl)");
      } finally { Marshal.FreeHGlobal(memory); }
    } finally { LocalFree(descriptor); }
  }
  static uint RunProcess(IntPtr token, IntPtr job, string command, string cwd) {
    IntPtr process = IntPtr.Zero, thread = IntPtr.Zero;
    bool completed = false;
    try {
      var startup = new StartupInfo();
      startup.cb = Marshal.SizeOf(startup);
      startup.flags = 0x100;
      startup.input = GetStdHandle(-10);
      startup.output = GetStdHandle(-11);
      startup.error = GetStdHandle(-12);
      var info = new ProcessInformation();
      var commandLine = "\"" + Path.Combine(Environment.SystemDirectory, "cmd.exe") + "\" /d /s /c \"" + command + "\"";
      // CREATE_SUSPENDED: no user code may run before the job owns the process.
      Check(CreateProcessAsUser(token, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x00000004 | 0x08000000, IntPtr.Zero, cwd, ref startup, out info), "CreateProcessAsUser");
      process = info.Process;
      thread = info.Thread;
      Check(AssignProcessToJobObject(job, process), "AssignProcessToJobObject");
      Check(ResumeThread(thread) != 0xffffffff, "ResumeThread");
      Check(WaitForSingleObject(process, 0xffffffff) == 0, "WaitForSingleObject");
      uint code;
      Check(GetExitCodeProcess(process, out code), "GetExitCodeProcess");
      completed = true;
      return code;
    } finally {
      try {
        // Also terminate on job-assignment/resume failure: an unassigned suspended
        // process is not covered by closing the job handle.
        if (process != IntPtr.Zero && !completed) {
          if (TerminateProcess(process, 125)) {
            Check(WaitForSingleObject(process, 0xffffffff) == 0, "WaitForSingleObject(TerminatedProcess)");
          } else {
            var terminateError = Marshal.GetLastWin32Error();
            uint existingCode;
            if (!GetExitCodeProcess(process, out existingCode) || existingCode == 259) {
              throw new System.ComponentModel.Win32Exception(terminateError, "TerminateProcess failed with Win32 error " + terminateError);
            }
          }
        }
      } finally {
        if (thread != IntPtr.Zero) CloseHandle(thread);
        if (process != IntPtr.Zero) CloseHandle(process);
      }
    }
  }
  public static int Run(string rootCapability, string tempCapability, string jobName, string command, string flushCommand, string cwd) {
    IntPtr token = IntPtr.Zero, restricted = IntPtr.Zero, primary = IntPtr.Zero, job = IntPtr.Zero, low = IntPtr.Zero;
    var allocated = new System.Collections.Generic.List<IntPtr>();
    try {
      Check(OpenProcessToken(GetCurrentProcess(), 0x0001 | 0x0002 | 0x0008 | 0x0020, out token), "OpenProcessToken");
      var logon = LogonSid(token);
      var sids = new SidAndAttributes[4];
      var texts = new string[] { logon, "S-1-1-0", rootCapability, tempCapability };
      for (var i = 0; i < texts.Length; i++) {
        var sid = Sid(texts[i]);
        allocated.Add(sid);
        sids[i] = new SidAndAttributes { Sid = sid, Attributes = 0 };
      }
      Check(CreateRestrictedToken(token, 0x1 | 0x8, 0, IntPtr.Zero, 0, IntPtr.Zero, (uint)sids.Length, sids, out restricted), "CreateRestrictedToken");
      Check(DuplicateTokenEx(restricted, 0xF01FF, IntPtr.Zero, 2, 1, out primary), "DuplicateTokenEx(TokenPrimary)");
      DefaultDacl(token, primary, logon, rootCapability, tempCapability);
      low = Sid("S-1-16-4096");
      var label = new TokenMandatoryLabel { Label = new SidAndAttributes { Sid = low, Attributes = 0x20 } };
      var labelMemory = Marshal.AllocHGlobal(Marshal.SizeOf(label));
      try {
        Marshal.StructureToPtr(label, labelMemory, false);
        Check(SetTokenInformation(primary, 25, labelMemory, (uint)Marshal.SizeOf(label)), "SetTokenInformation(TokenIntegrityLevel)");
      } finally { Marshal.FreeHGlobal(labelMemory); }
      job = CreateJobObject(IntPtr.Zero, jobName);
      Check(job != IntPtr.Zero, "CreateJobObject");
      var limit = new ExtendedLimit();
      limit.Basic.LimitFlags = 0x2000;
      var limitMemory = Marshal.AllocHGlobal(Marshal.SizeOf(limit));
      try {
        Marshal.StructureToPtr(limit, limitMemory, false);
        Check(SetInformationJobObject(job, 9, limitMemory, (uint)Marshal.SizeOf(limit)), "SetInformationJobObject");
      } finally { Marshal.FreeHGlobal(limitMemory); }
      var code = RunProcess(primary, job, command, cwd);
      if (flushCommand.Length > 0) {
        var flushCode = RunProcess(primary, job, flushCommand, cwd);
        if (flushCode != 0) {
          Console.Error.WriteLine("Office candidate flush failed; OfficeCLI output is shown above.");
          return (int)flushCode;
        }
      }
      return (int)code;
    } finally {
      if (job != IntPtr.Zero) CloseHandle(job);
      if (primary != IntPtr.Zero) CloseHandle(primary);
      if (restricted != IntPtr.Zero) CloseHandle(restricted);
      if (token != IntPtr.Zero) CloseHandle(token);
      if (low != IntPtr.Zero) LocalFree(low);
      foreach (var sid in allocated) LocalFree(sid);
    }
  }
}
`

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function capability(domain: string): string {
  const digest = createHash('sha256').update(domain).digest()
  const values = Array.from({ length: 4 }, (_, index) => digest.readUInt32LE(index * 4))
  return `S-1-4-${values.join('-')}`
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function powershellPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function encodedScript(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function rejectHardLinks(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) rejectHardLinks(path)
    else if (entry.isFile() && statSync(path).nlink > 1) throw new Error(`Windows isolated Shell cannot safely grant a hard-linked file: ${path}`)
  }
}

function stageOfficecliWrapper(scratch: string): string {
  const names = ['officecli-wrapper.ts', 'officecli-heading-repair.ts'] as const
  const managedWrapper = process.env.CRAFT_OFFICECLI
  const candidates = [
    ...(managedWrapper ? [join(dirname(managedWrapper), '..', 'scripts')] : []),
    join(process.cwd(), 'apps', 'electron', 'resources', 'scripts'),
    join(process.cwd(), 'resources', 'scripts'),
  ]
  const sourceDirectory = candidates.find(candidate => names.every(name => existsSync(join(candidate, name))))
  if (!sourceDirectory) return ''
  const destination = join(scratch, 'officecli-wrapper')
  mkdirSync(destination)
  for (const name of names) copyFileSync(join(sourceDirectory, name), join(destination, name))
  return join(destination, names[0])
}

function powerShellArguments(script: string): string[] {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript(script)]
}

function runInvocation(assembly: string, rootCapability: string, tempCapability: string, jobName: string, command: string, flushCommand: string, cwd: string): string {
  return [
    `$ProgressPreference = 'SilentlyContinue'`,
    `Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}')))`,
    `[Environment]::SetEnvironmentVariable('SELECTION_SANDBOX_COMMAND', $null, 'Process')`,
    `[Environment]::SetEnvironmentVariable('SELECTION_SANDBOX_FLUSH_COMMAND', $null, 'Process')`,
    `exit [SelectionWindowsSandbox]::Run('${rootCapability}', '${tempCapability}', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(jobName)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(command)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(flushCommand)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(cwd)}')))`,
  ].join('; ')
}

interface SecurityRecoveryState {
  version: 1
  root: string
  rootCapability: string
  tempCapability: string
  ownerPid: number
  createdGitPlaceholder: boolean
  temporary: string
}

const activeWindowsRoots = new Set<string>()

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isOwnedTemporaryDirectory(path: string): boolean {
  const child = relative(realpathSync(tmpdir()), path)
  return /^selection-win-[a-z0-9]{6}$/i.test(child) && !isAbsolute(child) && !child.includes(sep)
}

function isRecoveryState(value: unknown, activeRoot: string): value is SecurityRecoveryState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<SecurityRecoveryState>
  return state.version === 1
    && typeof state.root === 'string' && state.root.toLowerCase() === activeRoot
    && typeof state.rootCapability === 'string' && /^S-1-4-(?:\d+-){3}\d+$/.test(state.rootCapability)
    && typeof state.tempCapability === 'string' && /^S-1-4-(?:\d+-){3}\d+$/.test(state.tempCapability)
    && typeof state.ownerPid === 'number' && Number.isInteger(state.ownerPid) && state.ownerPid > 0
    && typeof state.createdGitPlaceholder === 'boolean'
    && typeof state.temporary === 'string' && isOwnedTemporaryDirectory(state.temporary)
}

function windowsJobName(): string {
  return `SelectionWindowsSandbox-${randomUUID()}`
}

function terminateJobsInvocation(assembly: string, jobsDirectory: string): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}')))`,
    `[SelectionWindowsSandbox]::TerminateJobs([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(jobsDirectory)}')))`,
  ].join('; ')
}

function restoreInvocation(assembly: string, state: SecurityRecoveryState, journal: string, ready: string): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}')))`,
    `[SelectionWindowsSandbox]::Restore([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(state.root)}')), '${state.rootCapability}', '${state.tempCapability}', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(journal)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(ready)}')))`,
  ].join('; ')
}

function writeDurable(path: string, contents: string): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
  } finally { closeSync(descriptor) }
}

export function createWindowsIsolatedShell(directory: string, options: { denyExternalBrowsers?: boolean; officeDocument?: { path: string; binary: string } } = {}): { directory: string; operations: BashOperations; dispose: () => void } | undefined {
  if (process.platform !== 'win32') return undefined
  // Office tool dispatch enforces denyExternalBrowsers before a command reaches
  // this native shell; it is a policy flag, not a reason to remove confinement.
  const root = realpathSync(directory)
  const officeDocument = options.officeDocument && { path: realpathSync(options.officeDocument.path), binary: realpathSync(options.officeDocument.binary) }
  const activeRoot = root.toLowerCase()
  if (activeWindowsRoots.has(activeRoot)) throw new Error('A Windows isolated Shell is already active for this workspace')
  activeWindowsRoots.add(activeRoot)
  let temporary = ''
  let launcher = ''
  let home = ''
  let scratch = ''
  let assembly = ''
  let rootCapability = ''
  let tempCapability = ''
  let officecliWrapper = ''
  let recoveryDirectory = ''
  let journal = ''
  let ready = ''
  let jobsDirectory = ''
  let recoveryState: SecurityRecoveryState | undefined
  let ownsRecovery = false
  let recoveryDirectoryCreated = false
  let createdGitPlaceholder = false
  const gitPath = join(root, '.git')
  const children = new Set<number>()
  let disposed = false
  let resourcesDisposed = false
  let securityRestored = false

  const environment = (env?: NodeJS.ProcessEnv) => ({
    ...process.env,
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TMPDIR: scratch,
    TMP: scratch,
    TEMP: scratch,
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    DOTNET_CLI_HOME: home,
    DOTNET_EnableDiagnostics: '0',
    OFFICECLI_NO_AUTO_RESIDENT: '1',
    SELECTION_WINDOWS_SANDBOX: '1',
    SELECTION_OFFICECLI_WRAPPER: officecliWrapper,
    PYTHONDONTWRITEBYTECODE: '1',
    COMSPEC: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
  })
  const runPowerShell = (script: string) => execFileSync(powershellPath(), powerShellArguments(script), {
    cwd: root,
    env: environment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const registerJob = () => {
    const name = windowsJobName()
    const marker = join(jobsDirectory, `${name}.job`)
    writeDurable(marker, name)
    return { name, marker }
  }
  const unregisterJob = (marker: string) => rmSync(marker, { force: true })
  const restoreSecurity = () => {
    if (securityRestored || !ownsRecovery || !recoveryState) return
    runPowerShell(terminateJobsInvocation(assembly, jobsDirectory))
    rejectHardLinks(root)
    runPowerShell(restoreInvocation(assembly, recoveryState, journal, ready))
    removePlaceholder()
    rmSync(recoveryDirectory, { recursive: true, force: true })
    recoveryDirectoryCreated = false
    securityRestored = true
    ownsRecovery = false
    activeWindowsRoots.delete(activeRoot)
  }
  const removeEmptyGitPlaceholder = () => {
    try {
      if (readdirSync(gitPath).length === 0) rmdirSync(gitPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const removePlaceholder = () => {
    if (!createdGitPlaceholder) return
    removeEmptyGitPlaceholder()
    createdGitPlaceholder = false
  }
  const disposeResources = () => {
    if (resourcesDisposed || children.size) return
    restoreSecurity()
    removePlaceholder()
    rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    resourcesDisposed = true
    activeWindowsRoots.delete(activeRoot)
  }
  const stop = (pid: number) => {
    const result = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 10_000 })
    if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ESRCH') throw result.error
    if (result.status !== 0 && processIsRunning(pid)) throw new Error(`Failed to terminate Windows isolated Shell process ${pid}`)
  }
  const dispose = () => {
    if (resourcesDisposed) return
    disposed = true
    let failure: unknown
    for (const pid of children) {
      try { stop(pid); children.delete(pid) } catch (error) { failure ??= error }
    }
    try { disposeResources() } catch (error) { failure ??= error }
    if (failure) throw failure
  }

  try {
    if (officeDocument && !inside(root, officeDocument.path)) throw new Error('Office document escapes isolated workspace')
    temporary = realpathSync(mkdtempSync(join(tmpdir(), 'selection-win-')))
    launcher = join(temporary, 'launcher')
    home = join(temporary, 'home')
    scratch = join(temporary, 'scratch')
    mkdirSync(launcher)
    mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true })
    mkdirSync(join(home, 'AppData', 'Local'), { recursive: true })
    mkdirSync(scratch)
    officecliWrapper = stageOfficecliWrapper(scratch)
    assembly = join(launcher, 'sandbox.dll')
    const identity = randomUUID()
    rootCapability = capability(`root:${root.toLowerCase()}:${identity}`)
    tempCapability = capability(`temp:${scratch.toLowerCase()}:${identity}`)

    const compile = [
      `$ErrorActionPreference = 'Stop'`,
      `$source = @'\n${source}\n'@`,
      `Add-Type -TypeDefinition $source -OutputAssembly ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}'))) -ReferencedAssemblies System.dll`,
    ].join('\r\n')
    const compilePath = join(launcher, 'compile.ps1')
    writeFileSync(compilePath, compile, 'utf8')
    execFileSync(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', compilePath], {
      cwd: root, env: environment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    })

    const recoveryRoot = join(tmpdir(), 'selection-win-security')
    mkdirSync(recoveryRoot, { recursive: true })
    recoveryDirectory = join(recoveryRoot, createHash('sha256').update(activeRoot).digest('hex'))
    const statePath = join(recoveryDirectory, 'state.json')
    journal = join(recoveryDirectory, 'security.tsv')
    ready = join(recoveryDirectory, 'ready')
    jobsDirectory = join(recoveryDirectory, 'jobs')
    if (existsSync(recoveryDirectory)) {
      if (!existsSync(statePath)) {
        // The directory is created before state is durably written, and no ACL
        // mutation can happen in that interval.
        rmSync(recoveryDirectory, { recursive: true, force: true })
      } else {
        const candidateState: unknown = JSON.parse(readFileSync(statePath, 'utf8'))
        if (!isRecoveryState(candidateState, activeRoot)) throw new Error('Invalid Windows sandbox security recovery state')
        const stale = candidateState
        if (stale.ownerPid !== process.pid && processIsRunning(stale.ownerPid)) throw new Error('A Windows isolated Shell is already active for this workspace')
        runPowerShell(terminateJobsInvocation(assembly, jobsDirectory))
        rejectHardLinks(root)
        runPowerShell(restoreInvocation(assembly, stale, journal, ready))
        if (stale.createdGitPlaceholder) removeEmptyGitPlaceholder()
        rmSync(stale.temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        rmSync(recoveryDirectory, { recursive: true, force: true })
      }
    }

    rejectHardLinks(root)
    mkdirSync(recoveryDirectory)
    recoveryDirectoryCreated = true
    createdGitPlaceholder = !existsSync(gitPath)
    recoveryState = { version: 1, root, rootCapability, tempCapability, ownerPid: process.pid, createdGitPlaceholder, temporary }
    writeDurable(statePath, JSON.stringify(recoveryState))
    writeDurable(journal, '')
    mkdirSync(jobsDirectory)
    ownsRecovery = true
    if (createdGitPlaceholder) mkdirSync(gitPath)

    const bootstrapJob = registerJob()
    const bootstrap = [
      `$ErrorActionPreference = 'Stop'`,
      `Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}')))`,
      `[SelectionWindowsSandbox]::SnapshotTree([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(root)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(journal)}')))`,
      `[SelectionWindowsSandbox]::Grant([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(root)}')), '${rootCapability}', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(journal)}')))`,
      ...(process.env.NODE_ENV === 'test' && process.env.SELECTION_WINDOWS_SANDBOX_TEST_FAIL_AFTER_GRANT === '1' ? [`throw 'Injected Windows sandbox initialization failure'`] : []),
      `[SelectionWindowsSandbox]::Grant([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(scratch)}')), '${tempCapability}', '')`,
      `[SelectionWindowsSandbox]::Deny([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(gitPath)}')), '${rootCapability}', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(journal)}')))`,
      `[SelectionWindowsSandbox]::MarkReady([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(ready)}')))`,
      runInvocation(assembly, rootCapability, tempCapability, bootstrapJob.name, 'exit 0', '', root),
    ].join('\r\n')
    const bootstrapPath = join(launcher, 'bootstrap.ps1')
    writeFileSync(bootstrapPath, bootstrap, 'utf8')
    try {
      execFileSync(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bootstrapPath], {
        cwd: root, env: environment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      })
    } finally { unregisterJob(bootstrapJob.marker) }
  } catch (error) {
    let restorationError: unknown
    try { restoreSecurity() } catch (failure) { restorationError = failure }
    if (!ownsRecovery && recoveryDirectoryCreated) rmSync(recoveryDirectory, { recursive: true, force: true })
    removePlaceholder()
    if (temporary) rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    activeWindowsRoots.delete(activeRoot)
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim()
    const restoreStderr = (restorationError as { stderr?: Buffer | string } | undefined)?.stderr?.toString().trim()
    const detail = [stderr, restorationError && `security restoration failed${restoreStderr ? `: ${restoreStderr}` : ''}`].filter(Boolean).join('; ')
    throw new Error(`Windows isolated Shell initialization failed${detail ? `: ${detail}` : ''}`, { cause: restorationError ?? error })
  }

  const flushCommand = officeDocument ? `"${officeDocument.binary}" close "${officeDocument.path}"` : ''
  return { directory: root, dispose, operations: { exec(command, cwd, { onData, signal, timeout, env }) {
    signal?.throwIfAborted()
    if (disposed) throw new Error('Isolated Shell has been disposed')
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error('Invalid Shell timeout')
    const target = realpathSync(cwd)
    if (!inside(root, target)) throw new Error('Shell directory escapes isolated workspace')
    return new Promise((resolve, reject) => {
      const registeredJob = registerJob()
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(powershellPath(), powerShellArguments(runInvocation(assembly, rootCapability, tempCapability, registeredJob.name, command, flushCommand, target)), {
          cwd: target,
          env: { ...environment(env), SELECTION_SANDBOX_COMMAND: encode(command), SELECTION_SANDBOX_FLUSH_COMMAND: encode(flushCommand) },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch (error) {
        unregisterJob(registeredJob.marker)
        reject(error)
        return
      }
      if (child.pid) children.add(child.pid)
      let timedOut = false
      let terminationError: unknown
      let outputError: unknown
      const halt = () => {
        if (!child.pid) return
        try { stop(child.pid) } catch (error) { terminationError = error }
      }
      const timer = timeout === undefined ? undefined : setTimeout(() => { timedOut = true; halt() }, timeout * 1000)
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', halt)
        if (child.pid) children.delete(child.pid)
        unregisterJob(registeredJob.marker)
        if (disposed) disposeResources()
      }
      const consume = (bytes: Buffer) => {
        if (outputError !== undefined) return
        try { onData(bytes) } catch (error) { outputError = error ?? new Error('Shell output handling failed'); halt() }
      }
      child.stdout!.on('data', consume)
      child.stderr!.on('data', consume)
      signal?.addEventListener('abort', halt, { once: true })
      if (signal?.aborted) halt()
      child.once('error', error => {
        try { cleanup(); reject(error) } catch (cleanupError) { reject(cleanupError) }
      })
      child.once('close', exitCode => {
        let cleanupError: unknown
        try { cleanup() } catch (error) { cleanupError = error }
        if (cleanupError !== undefined) reject(cleanupError)
        else if (outputError !== undefined) reject(outputError)
        else if (terminationError) reject(terminationError)
        else if (signal?.aborted) reject(new Error('aborted'))
        else if (timedOut) reject(new Error(`timeout:${timeout}`))
        else resolve({ exitCode })
      })
    })
  } } }
}
