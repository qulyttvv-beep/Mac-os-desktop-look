# Renders the app icon (a tiny desktop: menu bar + dock) to build/icon.png and build/icon.ico.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Force $out | Out-Null

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Render([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $m = $S * 0.04
  $body = RoundRect $m $m ($S - 2 * $m) ($S - 2 * $m) ($S * 0.225)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, $m), (New-Object System.Drawing.PointF 0, ($S - $m)), ([System.Drawing.Color]::FromArgb(255, 106, 209, 255)), ([System.Drawing.Color]::FromArgb(255, 91, 91, 240))
  $g.FillPath($grad, $body)
  $g.SetClip($body)
  # menu bar
  $bar = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 255, 255, 255))
  $g.FillRectangle($bar, 0, 0, $S, $S * 0.15)
  $g.ResetClip()
  # dock
  $dw = $S * 0.66; $dh = $S * 0.19; $dx = ($S - $dw) / 2; $dy = $S * 0.70
  $dock = RoundRect $dx $dy $dw $dh ($dh * 0.32)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 255, 255, 255))), $dock)
  $cols = @(@(255, 95, 87), @(254, 188, 46), @(40, 200, 64))
  $isz = $dh * 0.62; $gap = ($dw - 3 * $isz) / 4
  for ($i = 0; $i -lt 3; $i++) {
    $c = $cols[$i]
    $ix = $dx + $gap + $i * ($isz + $gap); $iy = $dy + ($dh - $isz) / 2
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $c[0], $c[1], $c[2]))), (RoundRect $ix $iy $isz $isz ($isz * 0.26)))
  }
  $g.Dispose()
  return $bmp
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($s in $sizes) {
  $b = Render $s
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($s -eq 256) { $b.Save((Join-Path $out 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $pngs += , $ms.ToArray()
  $b.Dispose()
}

# ICO container with PNG-compressed entries
$fs = [System.IO.File]::Create((Join-Path $out 'icon.ico'))
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$len); $w.Write([uint32]$offset)
  $offset += $len
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Close()
"icon written to $out"
