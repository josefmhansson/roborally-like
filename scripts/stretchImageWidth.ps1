param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [double]$WidthScale = 1.1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($WidthScale -le 0) {
  throw 'WidthScale must be greater than 0.'
}

Add-Type -AssemblyName System.Drawing

$typeName = 'HorizontalImageWidthTransformer'
if (-not ($typeName -as [type])) {
  Add-Type -ReferencedAssemblies @('System.Drawing.dll') -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class HorizontalImageWidthTransformer
{
    public static void Transform(string sourcePath, string outputPath, double widthScale)
    {
        using (var source = new Bitmap(sourcePath))
        {
            var outputWidth = Math.Max(1, (int)Math.Round(source.Width * widthScale));
            using (var output = new Bitmap(outputWidth, source.Height, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(output))
            {
                graphics.Clear(Color.Transparent);
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.DrawImage(
                    source,
                    new Rectangle(0, 0, outputWidth, source.Height),
                    new Rectangle(0, 0, source.Width, source.Height),
                    GraphicsUnit.Pixel
                );

                var directory = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                output.Save(outputPath, ImageFormat.Png);
            }
        }
    }
}
'@
}

$resolvedSourcePath = Resolve-Path -LiteralPath $SourcePath
[HorizontalImageWidthTransformer]::Transform([string]$resolvedSourcePath, $OutputPath, $WidthScale)
Write-Host "Widened $resolvedSourcePath -> $OutputPath (${WidthScale}x width)"
