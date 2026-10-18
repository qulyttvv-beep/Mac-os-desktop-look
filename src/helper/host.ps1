# Long-running helper for Mac Desktop. Reads one JSON request per line on stdin,
# writes one JSON response per line on stdout. Handles COM-heavy work that is
# awkward from Node: audio volume, jumbo icon extraction, Start-menu app list.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class MdAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float GetVolume() { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void SetVolume(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty)); }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, System.Guid.Empty)); }
}

public static class MdIcons {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr SHGetFileInfo(IntPtr pidl, uint attr, ref SHFILEINFO psfi, uint cb, uint flags);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHParseDisplayName(string name, IntPtr bc, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);
  [DllImport("shell32.dll", EntryPoint = "#727")]
  static extern int SHGetImageList(int iImageList, ref Guid riid, out IntPtr ppv);
  [DllImport("comctl32.dll")]
  static extern IntPtr ImageList_GetIcon(IntPtr himl, int i, int flags);
  [DllImport("user32.dll")]
  static extern bool DestroyIcon(IntPtr h);
  [DllImport("ole32.dll")]
  static extern void CoTaskMemFree(IntPtr p);

  public static bool Save(string name, string outPath) {
    IntPtr pidl; uint o;
    if (SHParseDisplayName(name, IntPtr.Zero, out pidl, 0, out o) != 0 || pidl == IntPtr.Zero) return false;
    var info = new SHFILEINFO();
    try {
      // SHGFI_SYSICONINDEX | SHGFI_PIDL
      if (SHGetFileInfo(pidl, 0, ref info, (uint)Marshal.SizeOf(info), 0x4000 | 0x8) == IntPtr.Zero) return false;
    } finally { CoTaskMemFree(pidl); }
    Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
    IntPtr himl;
    if (SHGetImageList(4 /* SHIL_JUMBO */, ref iid, out himl) != 0) return false;
    IntPtr hIcon = ImageList_GetIcon(himl, info.iIcon, 1 /* ILD_TRANSPARENT */);
    if (hIcon == IntPtr.Zero) return false;
    try {
      using (var ico = Icon.FromHandle(hIcon))
      using (var bmp = ico.ToBitmap()) {
        Bitmap final = Trim(bmp);
        final.Save(outPath, ImageFormat.Png);
        if (!object.ReferenceEquals(final, bmp)) final.Dispose();
      }
    } finally { DestroyIcon(hIcon); }
    return true;
  }

  // Apps without a 256px icon come back as a small icon in a big empty canvas: crop + upscale.
  static Bitmap Trim(Bitmap b) {
    int minX = b.Width, minY = b.Height, maxX = -1, maxY = -1;
    var data = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int stride = data.Stride;
    byte[] px = new byte[stride * b.Height];
    Marshal.Copy(data.Scan0, px, 0, px.Length);
    b.UnlockBits(data);
    for (int y = 0; y < b.Height; y++)
      for (int x = 0; x < b.Width; x++)
        if (px[y * stride + x * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    if (maxX < 0) return b;
    int w = maxX - minX + 1, h = maxY - minY + 1;
    if (w > b.Width * 0.6 || h > b.Height * 0.6) return b;
    int side = Math.Max(w, h);
    var outB = new Bitmap(256, 256, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(outB)) {
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.SmoothingMode = SmoothingMode.HighQuality;
      float scale = 232f / side;
      float dw = w * scale, dh = h * scale;
      g.DrawImage(b, new RectangleF((256 - dw) / 2, (256 - dh) / 2, dw, dh), new RectangleF(minX, minY, w, h), GraphicsUnit.Pixel);
    }
    return outB;
  }
}
'@


# ---- Audio devices, per-app mixer, microphone, monitor brightness (DDC/CI), theme broadcast.
$script:sysTypesOk = $true
try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] public struct MdPropKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] public struct MdPropVar { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdEnum {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMdColl devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMdDev dev);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMdDev dev);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdColl { [PreserveSig] int GetCount(out int n); [PreserveSig] int Item(int i, out IMdDev dev); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdDev {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  [PreserveSig] int OpenPropertyStore(int access, out IMdProps store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetState(out int state);
}
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdProps {
  [PreserveSig] int GetCount(out int n);
  [PreserveSig] int GetAt(int i, out MdPropKey k);
  [PreserveSig] int GetValue(ref MdPropKey k, out MdPropVar v);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr n);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr n);
  [PreserveSig] int GetChannelCount(out uint c);
  [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
  [PreserveSig] int SetMasterVolumeLevelScalar(float v, ref Guid ctx);
  [PreserveSig] int GetMasterVolumeLevel(out float db);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float v);
  [PreserveSig] int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float v, ref Guid ctx);
  [PreserveSig] int GetChannelVolumeLevel(uint ch, out float db);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float v);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr f);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int d, IntPtr f);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr a, IntPtr b);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int d, IntPtr a, IntPtr b);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr a);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr m);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr m);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int s, IntPtr k, IntPtr v);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int s, IntPtr k, IntPtr v);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class MdPolicyConfigClient { }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MdEnumClass { }

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdSessionManager2 {
  [PreserveSig] int GetAudioSessionControl(IntPtr g, int flags, out IntPtr c);
  [PreserveSig] int GetSimpleAudioVolume(IntPtr g, int flags, out IntPtr v);
  [PreserveSig] int GetSessionEnumerator(out IMdSessionEnum e);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdSessionEnum { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IMdSession s); }
[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdSession {
  [PreserveSig] int GetState(out int state);
  [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string v, IntPtr ctx);
  [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string v, IntPtr ctx);
  [PreserveSig] int GetGroupingParam(out Guid g);
  [PreserveSig] int SetGroupingParam(ref Guid g, IntPtr ctx);
  [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
  [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
  [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetProcessId(out uint pid);
  [PreserveSig] int IsSystemSoundsSession();
  [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMdSimpleVolume {
  [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
  [PreserveSig] int GetMasterVolume(out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public class MdDevice { public string id; public string name; public bool isDefault; }
public class MdSessionInfo { public uint pid; public string name; public string exe; public float level; public bool muted; public bool system; public bool active; }
public class MdMonitor { public int index; public string name; public int left; public int top; public int right; public int bottom; public int min; public int cur; public int max; public bool ok; }

public static class MdSys {
  // Created by CLSID (not through a wrapper class) so it can't collide with the RCW cached
  // for the same singleton by the volume code above.
  static IMdEnum Enumerator() { return (IMdEnum)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))); }
  static Guid Ctx = Guid.Empty;

  static string FriendlyName(IMdDev d) {
    IMdProps store;
    if (d.OpenPropertyStore(0, out store) != 0) return null;
    MdPropKey key = new MdPropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    MdPropVar v;
    if (store.GetValue(ref key, out v) != 0) return null;
    string s = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : null;
    if (v.p != IntPtr.Zero) Marshal.FreeCoTaskMem(v.p);
    return s;
  }

  public static MdDevice[] Devices(int flow) {
    var list = new List<MdDevice>();
    var e = Enumerator();
    string defId = null;
    IMdDev def;
    if (e.GetDefaultAudioEndpoint(flow, 0, out def) == 0) def.GetId(out defId);
    IMdColl coll;
    if (e.EnumAudioEndpoints(flow, 1, out coll) != 0) return list.ToArray();
    int n; coll.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IMdDev d; if (coll.Item(i, out d) != 0) continue;
      string id; d.GetId(out id);
      list.Add(new MdDevice { id = id, name = FriendlyName(d) ?? id, isDefault = id == defId });
    }
    return list.ToArray();
  }

  public static void SetDefault(string id) {
    var pc = (IMdPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")));
    for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, role));
  }

  static IMdEndpointVolume EndpointVolume(int flow) {
    IMdDev d;
    Marshal.ThrowExceptionForHR(Enumerator().GetDefaultAudioEndpoint(flow, 0, out d));
    Guid iid = typeof(IMdEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IMdEndpointVolume)o;
  }
  public static float GetLevel(int flow) { float v; EndpointVolume(flow).GetMasterVolumeLevelScalar(out v); return v; }
  public static bool GetMuted(int flow) { bool m; EndpointVolume(flow).GetMute(out m); return m; }
  public static void SetLevel(int flow, float v) { EndpointVolume(flow).SetMasterVolumeLevelScalar(v, ref Ctx); }
  public static void SetMuted(int flow, bool m) { EndpointVolume(flow).SetMute(m, ref Ctx); }

  static IMdSessionEnum Sessions() {
    IMdDev d;
    Marshal.ThrowExceptionForHR(Enumerator().GetDefaultAudioEndpoint(0, 0, out d));
    Guid iid = typeof(IMdSessionManager2).GUID;
    object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
    IMdSessionEnum se;
    Marshal.ThrowExceptionForHR(((IMdSessionManager2)o).GetSessionEnumerator(out se));
    return se;
  }

  public static MdSessionInfo[] Mixer() {
    var byPid = new Dictionary<uint, MdSessionInfo>();
    var se = Sessions();
    int n; se.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IMdSession s; if (se.GetSession(i, out s) != 0) continue;
      uint pid; s.GetProcessId(out pid);
      int state; s.GetState(out state);
      if (state == 2) continue; // expired
      var vol = (IMdSimpleVolume)s;
      float lv; bool mu; vol.GetMasterVolume(out lv); vol.GetMute(out mu);
      bool sys = s.IsSystemSoundsSession() == 0;
      MdSessionInfo info;
      if (!byPid.TryGetValue(pid, out info)) {
        string name; s.GetDisplayName(out name);
        string exe = null;
        try { exe = System.Diagnostics.Process.GetProcessById((int)pid).MainModule.FileName; } catch { }
        info = new MdSessionInfo { pid = pid, name = name, exe = exe, level = lv, muted = mu, system = sys, active = state == 1 };
        byPid[pid] = info;
      } else if (state == 1) info.active = true;
    }
    return new List<MdSessionInfo>(byPid.Values).ToArray();
  }

  public static void SetApp(uint pid, float level, int mute) {
    var se = Sessions();
    int n; se.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IMdSession s; if (se.GetSession(i, out s) != 0) continue;
      uint p; s.GetProcessId(out p);
      if (p != pid) continue;
      var vol = (IMdSimpleVolume)s;
      if (level >= 0) vol.SetMasterVolume(level, ref Ctx);
      if (mute >= 0) vol.SetMute(mute == 1, ref Ctx);
    }
  }

  // ---- external monitor brightness over DDC/CI
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PHYS { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
  delegate bool MonProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonProc proc, IntPtr data);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr h, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr h, uint n, [Out] PHYS[] arr);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint n, PHYS[] arr);
  [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint v);

  static List<KeyValuePair<RECT, IntPtr>> Hmons() {
    var l = new List<KeyValuePair<RECT, IntPtr>>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr dc, ref RECT r, IntPtr d) => { l.Add(new KeyValuePair<RECT, IntPtr>(r, h)); return true; }, IntPtr.Zero);
    return l;
  }

  public static MdMonitor[] Monitors() {
    var res = new List<MdMonitor>();
    int idx = 0;
    foreach (var kv in Hmons()) {
      uint n;
      var m = new MdMonitor { index = idx++, left = kv.Key.l, top = kv.Key.t, right = kv.Key.r, bottom = kv.Key.b, name = "Display" };
      if (GetNumberOfPhysicalMonitorsFromHMONITOR(kv.Value, out n) && n > 0) {
        var arr = new PHYS[n];
        if (GetPhysicalMonitorsFromHMONITOR(kv.Value, n, arr)) {
          m.name = string.IsNullOrEmpty(arr[0].desc) ? "Display" : arr[0].desc;
          uint mn, cu, mx;
          if (GetMonitorBrightness(arr[0].h, out mn, out cu, out mx)) { m.ok = true; m.min = (int)mn; m.cur = (int)cu; m.max = (int)mx; }
          DestroyPhysicalMonitors(n, arr);
        }
      }
      res.Add(m);
    }
    return res.ToArray();
  }

  public static bool SetBrightness(int index, int value) {
    var mons = Hmons();
    if (index < 0 || index >= mons.Count) return false;
    uint n;
    if (!GetNumberOfPhysicalMonitorsFromHMONITOR(mons[index].Value, out n) || n == 0) return false;
    var arr = new PHYS[n];
    bool ok = false;
    if (GetPhysicalMonitorsFromHMONITOR(mons[index].Value, n, arr)) {
      for (int i = 0; i < n; i++) ok |= SetMonitorBrightness(arr[i].h, (uint)value);
      DestroyPhysicalMonitors(n, arr);
    }
    return ok;
  }

  // ---- tell every window the light/dark theme changed
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr res);
  public static void BroadcastTheme() {
    IntPtr r;
    SendMessageTimeout((IntPtr)0xffff, 0x1A, IntPtr.Zero, "ImmersiveColorSet", 2, 3000, out r);
  }
}
'@
} catch {
  $script:sysTypesOk = $false
  [Console]::Error.WriteLine("system helpers unavailable: " + $_.Exception.Message)
}

# ---- WinRT: media session (Now Playing) and radios (Bluetooth / Wi-Fi), loaded on first use.
$script:winrt = $null
function Init-WinRT {
  if ($script:winrt -ne $null) { return $script:winrt }
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $script:winrt = $true
  } catch { $script:winrt = $false }
  return $script:winrt
}
function Await($op, [Type]$type) {
  $task = $script:asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { throw 'timeout' }
  return $task.Result
}

$script:gsmtc = $null
$script:artKey = $null
$script:art = $null
function Get-MediaSession {
  if (-not (Init-WinRT)) { return $null }
  if (-not $script:gsmtc) {
    $script:gsmtc = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  return $script:gsmtc.GetCurrentSession()
}
function Get-Media {
  $s = Get-MediaSession
  if (-not $s) { return $null }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $info = $s.GetPlaybackInfo()
  $key = "$($p.Title)|$($p.Artist)"
  if ($key -ne $script:artKey) {
    $script:artKey = $key
    $script:art = $null
    if ($p.Thumbnail) {
      try {
        $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $net.Dispose()
        $script:art = [Convert]::ToBase64String($ms.ToArray())
      } catch { }
    }
  }
  return @{ title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; app = $s.SourceAppUserModelId; playing = ("$($info.PlaybackStatus)" -eq 'Playing'); art = $script:art; key = $key }
}
function Invoke-Media($cmd) {
  $s = Get-MediaSession
  if (-not $s) { return $false }
  $op = switch ($cmd) { 'next' { $s.TrySkipNextAsync() } 'prev' { $s.TrySkipPreviousAsync() } default { $s.TryTogglePlayPauseAsync() } }
  return (Await $op ([bool]))
}
function Get-RadioList {
  if (-not (Init-WinRT)) { return @() }
  $null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
  return Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}

function Get-DarkMode {
  $v = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction SilentlyContinue
  return ($v -and $v.AppsUseLightTheme -eq 0)
}
function Set-DarkMode([bool]$dark) {
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  $val = if ($dark) { 0 } else { 1 }
  Set-ItemProperty -Path $k -Name AppsUseLightTheme -Value $val -Type DWord
  Set-ItemProperty -Path $k -Name SystemUsesLightTheme -Value $val -Type DWord
  if ($script:sysTypesOk) { [MdSys]::BroadcastTheme() }
}

function Write-Response($obj) {
  $json = ConvertTo-Json -InputObject $obj -Compress -Depth 8
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Get-AppList {
  $shell = New-Object -ComObject WScript.Shell
  $roots = @(
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
  )
  $byName = @{}
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $target = $shell.CreateShortcut($_.FullName).TargetPath
        if (-not $byName.ContainsKey($_.BaseName)) { $byName[$_.BaseName] = @{ lnk = $_.FullName; target = $target } }
      } catch { }
    }
  }
  $list = New-Object System.Collections.ArrayList
  foreach ($a in (Get-StartApps)) {
    $m = $byName[$a.Name]
    $null = $list.Add([ordered]@{
      name   = $a.Name
      appId  = $a.AppID
      lnk    = if ($m) { $m.lnk } else { $null }
      target = if ($m) { $m.target } else { $null }
    })
  }
  return , $list.ToArray()
}

function Get-Description($path) {
  try {
    $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($path)
    if ($v.FileDescription -and $v.FileDescription.Trim()) { return $v.FileDescription.Trim() }
    if ($v.ProductName -and $v.ProductName.Trim()) { return $v.ProductName.Trim() }
  } catch { }
  return $null
}

# Windows key -> our Start menu. A low-level keyboard hook on its own thread (with its own
# message loop), so it never waits on anything else this helper does. A lone press of
# Win is swallowed on release and replayed as Win+<unassigned key> (vk E8), which keeps
# the Windows Start menu closed without ever leaving Win stuck; Win+<key> shortcuts pass
# through untouched.
$script:keysOk = $false
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class MdKeys {
  [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vk; public uint scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  static Proc proc;
  static IntPtr hook = IntPtr.Zero;
  static Thread thread;
  static bool winDown, combo;
  public static volatile bool Enabled;
  public static void Start() {
    if (thread != null) return;
    thread = new Thread(Run);
    thread.IsBackground = true;
    thread.Start();
  }
  static void Run() {
    proc = Hook;
    hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
  }
  static void Emit() {
    ThreadPool.QueueUserWorkItem(delegate {
      try { Console.Out.WriteLine("{\"event\":\"winkey\"}"); Console.Out.Flush(); } catch { }
    });
  }
  static IntPtr Hook(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && Enabled) {
      KBD k = (KBD)Marshal.PtrToStructure(l, typeof(KBD));
      if ((k.flags & 0x10) == 0) {
        int msg = w.ToInt32();
        bool down = msg == 0x100 || msg == 0x104;
        if (k.vk == 0x5B || k.vk == 0x5C) {
          if (down) {
            if (!winDown) { winDown = true; combo = false; }
          } else {
            bool lone = winDown && !combo;
            winDown = false;
            if (lone) {
              keybd_event(0xE8, 0, 0, UIntPtr.Zero);
              keybd_event(0xE8, 0, 2, UIntPtr.Zero);
              keybd_event((byte)k.vk, 0, 3, UIntPtr.Zero);
              Emit();
              return (IntPtr)1;
            }
          }
        } else if (down && winDown) {
          combo = true;
        }
      }
    }
    return CallNextHookEx(hook, code, w, l);
  }
}
'@
  $script:keysOk = $true
} catch {
  [Console]::Error.WriteLine("keys hook unavailable: $($_.Exception.Message)")
}

# Music reactivity for the live wallpaper: what the PC is playing, read straight from the
# default output device (WASAPI loopback) on a thread of its own, reduced to three band
# levels about 30 times a second. Far lighter than capturing the desktop in Chromium.
$script:loopOk = $false
try {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ILbEnum {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out ILbDev dev);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ILbDev {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ILbClient {
  [PreserveSig] int Initialize(int shareMode, int flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
  [PreserveSig] int GetBufferSize(out int frames);
  [PreserveSig] int GetStreamLatency(out long latency);
  [PreserveSig] int GetCurrentPadding(out int padding);
  [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
  [PreserveSig] int GetMixFormat(out IntPtr format);
  [PreserveSig] int GetDevicePeriod(out long def, out long min);
  [PreserveSig] int Start();
  [PreserveSig] int Stop();
  [PreserveSig] int Reset();
  [PreserveSig] int SetEventHandle(IntPtr h);
  [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ILbCapture {
  [PreserveSig] int GetBuffer(out IntPtr data, out int frames, out int flags, out long devPos, out long qpcPos);
  [PreserveSig] int ReleaseBuffer(int frames);
  [PreserveSig] int GetNextPacketSize(out int frames);
}

// Same numbers a Web Audio AnalyserNode gives (fftSize 2048, Blackman window, smoothing
// 0.5, -100..-30 dB mapped to 0..1), averaged over bass / mid / treble.
class LbAnalyzer {
  readonly int n; readonly double rate;
  readonly double[] win, re, im, smooth;
  public double bass, mid, treble;
  public LbAnalyzer(int size, int sampleRate) {
    n = size; rate = sampleRate;
    win = new double[n]; re = new double[n]; im = new double[n]; smooth = new double[n / 2];
    for (int i = 0; i < n; i++) win[i] = 0.42 - 0.5 * Math.Cos(2 * Math.PI * i / n) + 0.08 * Math.Cos(4 * Math.PI * i / n);
  }
  public void Run(float[] ring, int start) {
    for (int i = 0; i < n; i++) { re[i] = ring[(start + i) & (n - 1)] * win[i]; im[i] = 0; }
    Fft();
    for (int k = 0; k < n / 2; k++) smooth[k] = 0.5 * smooth[k] + 0.5 * Math.Sqrt(re[k] * re[k] + im[k] * im[k]) / n;
    bass = Band(25, 150); mid = Band(150, 2000); treble = Band(2000, 9000);
  }
  double Band(double lo, double hi) {
    double hz = rate / n;
    int a = Math.Max(1, (int)Math.Floor(lo / hz));
    int b = Math.Min(n / 2 - 1, (int)Math.Ceiling(hi / hz));
    double s = 0;
    for (int k = a; k <= b; k++) {
      double db = 20 * Math.Log10(Math.Max(smooth[k], 1e-12));
      s += Math.Min(1, Math.Max(0, (db + 100) / 70));
    }
    return s / Math.Max(1, b - a + 1);
  }
  void Fft() {
    for (int i = 1, j = 0; i < n; i++) {
      int bit = n >> 1;
      for (; (j & bit) != 0; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (int len = 2; len <= n; len <<= 1) {
      double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
      for (int i = 0; i < n; i += len) {
        double cr = 1, ci = 0;
        for (int k = 0; k < len / 2; k++) {
          int p = i + k, q = p + len / 2;
          double xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr;
          re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
          double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
}

public static class MdLoop {
  const int N = 2048;
  static Thread thread;
  static volatile bool on;
  public static void Enable(bool v) {
    on = v;
    if (v && thread == null) { thread = new Thread(Run); thread.IsBackground = true; thread.Start(); }
  }
  static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
  static void Run() {
    while (true) {
      if (!on) { Thread.Sleep(250); continue; }
      try { Capture(); } catch (Exception e) { try { Console.Error.WriteLine("audio loopback: " + e.Message); } catch { } }
      if (on) Thread.Sleep(2000); // device gone or changed: start over
    }
  }
  static string DefaultId(ILbEnum en) {
    ILbDev d;
    if (en.GetDefaultAudioEndpoint(0, 0, out d) < 0 || d == null) return null;
    string id; d.GetId(out id);
    Marshal.ReleaseComObject(d);
    return id;
  }
  static string F(double v) { return v.ToString("0.####", CultureInfo.InvariantCulture); }
  static void Capture() {
    var en = (ILbEnum)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    ILbDev dev; Check(en.GetDefaultAudioEndpoint(0, 0, out dev));
    string devId; dev.GetId(out devId);
    Guid iid = typeof(ILbClient).GUID; object o;
    Check(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    var ac = (ILbClient)o;
    IntPtr fmt; Check(ac.GetMixFormat(out fmt));
    int tag = Marshal.ReadInt16(fmt, 0) & 0xFFFF;
    int ch = Math.Max(1, (int)Marshal.ReadInt16(fmt, 2));
    int rate = Marshal.ReadInt32(fmt, 4);
    int bits = Marshal.ReadInt16(fmt, 14);
    bool flt = tag == 3 || (tag == 0xFFFE && Marshal.ReadInt32(fmt, 24) == 3);
    int hr = ac.Initialize(0, 0x00020000 /* loopback */, 1000000, 0, fmt, IntPtr.Zero);
    Marshal.FreeCoTaskMem(fmt);
    Check(hr);
    Guid cid = typeof(ILbCapture).GUID; object co;
    Check(ac.GetService(ref cid, out co));
    var cc = (ILbCapture)co;
    Check(ac.Start());
    var an = new LbAnalyzer(N, rate);
    float[] ring = new float[N]; int w = 0;
    float[] fb = new float[0]; short[] sb = new short[0];
    var clock = Stopwatch.StartNew();
    long lastData = 0, lastEmit = 0, lastDev = 0;
    bool quiet = false;
    try {
      while (on) {
        Thread.Sleep(12);
        int packet; Check(cc.GetNextPacketSize(out packet));
        while (packet > 0) {
          IntPtr data; int frames, flags; long dp, qp;
          Check(cc.GetBuffer(out data, out frames, out flags, out dp, out qp));
          int cnt = frames * ch;
          bool silent = (flags & 2) != 0;
          if (!silent && flt && bits == 32) { if (fb.Length < cnt) fb = new float[cnt]; Marshal.Copy(data, fb, 0, cnt); }
          else if (!silent && !flt && bits == 16) { if (sb.Length < cnt) sb = new short[cnt]; Marshal.Copy(data, sb, 0, cnt); }
          else silent = true;
          for (int i = 0; i < frames; i++) {
            float s = 0;
            if (!silent) {
              for (int c = 0; c < ch; c++) s += flt ? fb[i * ch + c] : sb[i * ch + c] / 32768f;
              s /= ch;
            }
            ring[w] = s; w = (w + 1) & (N - 1);
          }
          Check(cc.ReleaseBuffer(frames));
          lastData = clock.ElapsedMilliseconds;
          Check(cc.GetNextPacketSize(out packet));
        }
        long now = clock.ElapsedMilliseconds;
        if (now - lastEmit >= 33) {
          lastEmit = now;
          if (now - lastData > 200) Array.Clear(ring, 0, N); // nothing is playing
          an.Run(ring, w);
          bool q = an.bass < 0.002 && an.mid < 0.002 && an.treble < 0.002;
          if (!(q && quiet)) {
            Console.Out.WriteLine("{\"event\":\"audio\",\"b\":" + F(an.bass) + ",\"m\":" + F(an.mid) + ",\"t\":" + F(an.treble) + "}");
            Console.Out.Flush();
          }
          quiet = q;
        }
        if (now - lastDev > 2000) {
          lastDev = now;
          if (DefaultId(en) != devId) break; // follow the new default output device
        }
      }
    } finally {
      try { ac.Stop(); } catch { }
      Marshal.ReleaseComObject(cc); Marshal.ReleaseComObject(ac); Marshal.ReleaseComObject(dev); Marshal.ReleaseComObject(en);
    }
  }
}
'@
  $script:loopOk = $true
} catch {
  [Console]::Error.WriteLine("audio loopback unavailable: $($_.Exception.Message)")
}

Write-Response @{ ready = $true }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = ConvertFrom-Json -InputObject $line
    $a = $req.args
    $data = $null
    switch ($req.cmd) {
      'ping' { $data = 'pong' }
      'volume.get' { $data = @{ level = [MdAudio]::GetVolume(); muted = [MdAudio]::GetMute() } }
      'volume.set' { [MdAudio]::SetVolume([float]$a.level); $data = $true }
      'mute.set' { [MdAudio]::SetMute([bool]$a.muted); $data = $true }
      'icons' {
        $done = New-Object System.Collections.ArrayList
        foreach ($it in $a.items) {
          $okIcon = $false
          try { $okIcon = [MdIcons]::Save([string]$it.src, [string]$it.out) } catch { }
          $null = $done.Add(@{ src = $it.src; ok = $okIcon })
        }
        $data = $done.ToArray()
      }
      'apps' { $data = Get-AppList }
      'describe' {
        $res = @{}
        foreach ($p in $a.paths) { $res[[string]$p] = Get-Description $p }
        $data = $res
      }
      'brightness.get' {
        $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
        $data = [int]$b.CurrentBrightness
      }
      'brightness.set' {
        $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
        $null = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$a.level }
        $data = $true
      }
      'audio.devices' {
        $data = @{ outputs = [MdSys]::Devices(0); inputs = [MdSys]::Devices(1) }
      }
      'audio.setDefault' { [MdSys]::SetDefault([string]$a.id); $data = $true }
      'mic.get' { $data = @{ level = [MdSys]::GetLevel(1); muted = [MdSys]::GetMuted(1) } }
      'mic.set' {
        if ($a.level -ne $null) { [MdSys]::SetLevel(1, [float]$a.level) }
        if ($a.muted -ne $null) { [MdSys]::SetMuted(1, [bool]$a.muted) }
        $data = $true
      }
      'mixer.list' { $data = [MdSys]::Mixer() }
      'mixer.set' {
        $lv = if ($a.level -ne $null) { [float]$a.level } else { [float]-1 }
        $mu = if ($a.muted -ne $null) { if ($a.muted) { 1 } else { 0 } } else { -1 }
        [MdSys]::SetApp([uint32]$a.pid, $lv, $mu)
        $data = $true
      }
      'media.get' { $data = Get-Media }
      'media.cmd' { $data = Invoke-Media ([string]$a.cmd) }
      'radios.get' {
        $data = @(Get-RadioList | ForEach-Object { @{ kind = "$($_.Kind)"; name = $_.Name; on = ("$($_.State)" -eq 'On') } })
      }
      'radios.set' {
        $r = Get-RadioList | Where-Object { "$($_.Kind)" -eq [string]$a.kind } | Select-Object -First 1
        if (-not $r) { throw 'no such radio' }
        $state = if ($a.on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
        $data = "$(Await ($r.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus]))"
      }
      'theme.get' { $data = @{ dark = (Get-DarkMode) } }
      'theme.set' { Set-DarkMode ([bool]$a.dark); $data = $true }
      'audio.listen' {
        if ($script:loopOk) { [MdLoop]::Enable([bool]$a.on) }
        $data = $script:loopOk
      }
      'keys.enable' {
        if ($script:keysOk) {
          [MdKeys]::Enabled = [bool]$a.on
          if ($a.on) { [MdKeys]::Start() }
        }
        $data = $script:keysOk
      }
      'monitors.get' { $data = [MdSys]::Monitors() }
      'monitors.set' { $data = [MdSys]::SetBrightness([int]$a.index, [int]$a.value) }
      default { throw "unknown command: $($req.cmd)" }
    }
    Write-Response @{ id = $req.id; ok = $true; data = $data }
  } catch {
    $rid = if ($req) { $req.id } else { $null }
    Write-Response @{ id = $rid; ok = $false; error = $_.Exception.Message }
  }
}
