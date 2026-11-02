import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

const source = String.raw`
using System;
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
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint ResumeThread(IntPtr thread);
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
  public static void Grant(string path, string capabilityText) {
    GrantDirectory(new DirectoryInfo(path), new SecurityIdentifier(capabilityText), new SecurityIdentifier("S-1-1-0"));
  }
  static void GrantDirectory(DirectoryInfo directory, SecurityIdentifier capability, SecurityIdentifier everyone) {
    var security = directory.GetAccessControl();
    security.AddAccessRule(new FileSystemAccessRule(capability, FileSystemRights.Modify, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(everyone, FileSystemRights.DeleteSubdirectoriesAndFiles, InheritanceFlags.None, PropagationFlags.None, AccessControlType.Deny));
    directory.SetAccessControl(security);
    LowLabel(directory.FullName);
    foreach (var entry in directory.EnumerateFileSystemInfos()) {
      if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue;
      var child = entry as DirectoryInfo;
      if (child != null) GrantDirectory(child, capability, everyone);
      else {
        var file = (FileInfo)entry;
        var acl = file.GetAccessControl();
        acl.AddAccessRule(new FileSystemAccessRule(capability, FileSystemRights.Modify, InheritanceFlags.None, PropagationFlags.None, AccessControlType.Allow));
        file.SetAccessControl(acl);
        LowLabel(file.FullName);
      }
    }
  }
  public static void Deny(string path, string capabilityText) {
    var capability = new SecurityIdentifier(capabilityText);
    if (Directory.Exists(path)) DenyEntry(new DirectoryInfo(path), capability);
    else if (File.Exists(path)) DenyEntry(new FileInfo(path), capability);
  }
  static void DenyEntry(FileSystemInfo entry, SecurityIdentifier capability) {
    var rights = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles;
    if (entry is DirectoryInfo) {
      var directory = (DirectoryInfo)entry;
      var security = directory.GetAccessControl();
      security.AddAccessRule(new FileSystemAccessRule(capability, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Deny));
      directory.SetAccessControl(security);
      foreach (var child in directory.EnumerateFileSystemInfos()) {
        if ((child.Attributes & FileAttributes.ReparsePoint) == 0) DenyEntry(child, capability);
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
    try {
      var startup = new StartupInfo();
      startup.cb = Marshal.SizeOf(startup);
      startup.flags = 0x100;
      startup.input = GetStdHandle(-10);
      startup.output = GetStdHandle(-11);
      startup.error = GetStdHandle(-12);
      var info = new ProcessInformation();
      var commandLine = "\"" + Path.Combine(Environment.SystemDirectory, "cmd.exe") + "\" /d /s /c \"" + command + "\"";
      Check(CreateProcessAsUser(token, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x00000010, IntPtr.Zero, cwd, ref startup, out info), "CreateProcessAsUser");
      process = info.Process;
      thread = info.Thread;
      Check(AssignProcessToJobObject(job, process), "AssignProcessToJobObject");
      Check(ResumeThread(thread) != 0xffffffff, "ResumeThread");
      WaitForSingleObject(process, 0xffffffff);
      uint code;
      Check(GetExitCodeProcess(process, out code), "GetExitCodeProcess");
      return code;
    } finally {
      if (thread != IntPtr.Zero) CloseHandle(thread);
      if (process != IntPtr.Zero) CloseHandle(process);
    }
  }
  public static int Run(string rootCapability, string tempCapability, string command, string flushCommand, string cwd) {
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
      job = CreateJobObject(IntPtr.Zero, null);
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
    join(import.meta.dir, '..', '..', '..', '..', 'apps', 'electron', 'resources', 'scripts'),
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

function runInvocation(assembly: string, rootCapability: string, tempCapability: string, command: string, flushCommand: string, cwd: string): string {
  return [
    `$ProgressPreference = 'SilentlyContinue'`,
    `Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}')))`,
    `[Environment]::SetEnvironmentVariable('SELECTION_SANDBOX_COMMAND', $null, 'Process')`,
    `[Environment]::SetEnvironmentVariable('SELECTION_SANDBOX_FLUSH_COMMAND', $null, 'Process')`,
    `exit [SelectionWindowsSandbox]::Run('${rootCapability}', '${tempCapability}', [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(command)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(flushCommand)}')), [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(cwd)}')))`,
  ].join('; ')
}

export function createWindowsIsolatedShell(directory: string, options: { denyExternalBrowsers?: boolean; officeDocument?: { path: string; binary: string } } = {}): { directory: string; operations: BashOperations; dispose: () => void } | undefined {
  if (process.platform !== 'win32' || options.denyExternalBrowsers) return undefined
  const root = realpathSync(directory)
  const officeDocument = options.officeDocument && { path: realpathSync(options.officeDocument.path), binary: realpathSync(options.officeDocument.binary) }
  if (officeDocument && !inside(root, officeDocument.path)) throw new Error('Office document escapes isolated workspace')
  rejectHardLinks(root)

  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'selection-win-')))
  const launcher = join(temporary, 'launcher')
  const home = join(temporary, 'home')
  const scratch = join(temporary, 'scratch')
  mkdirSync(launcher)
  mkdirSync(join(home, 'AppData', 'Roaming'), { recursive: true })
  mkdirSync(join(home, 'AppData', 'Local'), { recursive: true })
  mkdirSync(scratch)
  const officecliWrapper = stageOfficecliWrapper(scratch)
  const assembly = join(launcher, 'sandbox.dll')
  const identity = randomUUID()
  const rootCapability = capability(`root:${root.toLowerCase()}:${identity}`)
  const tempCapability = capability(`temp:${scratch.toLowerCase()}:${identity}`)
  const gitPath = join(root, '.git')
  const createdGitPlaceholder = !existsSync(gitPath)
  if (createdGitPlaceholder) mkdirSync(gitPath)
  const children = new Set<number>()
  let disposed = false
  let resourcesDisposed = false

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
  const disposeResources = () => {
    if (resourcesDisposed || children.size) return
    resourcesDisposed = true
    if (createdGitPlaceholder) {
      try {
        if (readdirSync(gitPath).length === 0) rmdirSync(gitPath)
      } catch { /* Keep a non-empty or already-removed placeholder untouched. */ }
    }
    rmSync(temporary, { recursive: true, force: true })
  }
  const stop = (pid: number) => {
    const result = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 10_000 })
    if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ESRCH') throw result.error
  }
  const dispose = () => {
    disposed = true
    for (const pid of children) stop(pid)
    disposeResources()
  }

  try {
    const bootstrap = [
      `$source = @'\n${source}\n'@`,
      `Add-Type -TypeDefinition $source -OutputAssembly ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}'))) -ReferencedAssemblies System.dll`,
      `Add-Type -Path ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(assembly)}')))`,
      `[SelectionWindowsSandbox]::Grant([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(root)}')), '${rootCapability}')`,
      `[SelectionWindowsSandbox]::Grant([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(scratch)}')), '${tempCapability}')`,
      `[SelectionWindowsSandbox]::Deny([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(gitPath)}')), '${rootCapability}')`,
      runInvocation(assembly, rootCapability, tempCapability, 'exit 0', '', root),
    ].join('\r\n')
    const bootstrapPath = join(launcher, 'bootstrap.ps1')
    writeFileSync(bootstrapPath, bootstrap, 'utf8')
    execFileSync(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bootstrapPath], { cwd: root, env: environment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
  } catch (error) {
    disposeResources()
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim()
    throw new Error(`Windows isolated Shell initialization failed${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }

  const flushCommand = officeDocument ? `"${officeDocument.binary}" close "${officeDocument.path}"` : ''
  return { directory: root, dispose, operations: { exec(command, cwd, { onData, signal, timeout, env }) {
    signal?.throwIfAborted()
    if (disposed) throw new Error('Isolated Shell has been disposed')
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error('Invalid Shell timeout')
    const target = realpathSync(cwd)
    if (!inside(root, target)) throw new Error('Shell directory escapes isolated workspace')
    return new Promise((resolve, reject) => {
      const child = spawn(powershellPath(), powerShellArguments(runInvocation(assembly, rootCapability, tempCapability, command, flushCommand, target)), {
        cwd: target,
        env: { ...environment(env), SELECTION_SANDBOX_COMMAND: encode(command), SELECTION_SANDBOX_FLUSH_COMMAND: encode(flushCommand) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
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
        if (disposed) disposeResources()
      }
      const consume = (bytes: Buffer) => {
        if (outputError !== undefined) return
        try { onData(bytes) } catch (error) { outputError = error ?? new Error('Shell output handling failed'); halt() }
      }
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)
      signal?.addEventListener('abort', halt, { once: true })
      if (signal?.aborted) halt()
      child.once('error', error => { cleanup(); reject(error) })
      child.once('close', exitCode => {
        cleanup()
        if (outputError !== undefined) reject(outputError)
        else if (terminationError) reject(terminationError)
        else if (signal?.aborted) reject(new Error('aborted'))
        else if (timedOut) reject(new Error(`timeout:${timeout}`))
        else resolve({ exitCode })
      })
    })
  } } }
}
