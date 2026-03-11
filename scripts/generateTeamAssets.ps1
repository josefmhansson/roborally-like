Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$typeName = 'GeneratedTeamAssetGenerator'
if (-not ($typeName -as [type])) {
  Add-Type -ReferencedAssemblies @('System.Drawing.dll') -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

public static class GeneratedTeamAssetGenerator
{
    public static void Generate(string sourcePath, string basePath, string teamPath, bool squareCanvas)
    {
        using (var source = new Bitmap(sourcePath))
        {
            var opaqueBounds = GetOpaqueBounds(source);
            if (opaqueBounds.Width <= 0 || opaqueBounds.Height <= 0)
            {
                opaqueBounds = new Rectangle(0, 0, source.Width, source.Height);
            }

            var padding = Math.Max(6, (int)Math.Round(Math.Max(opaqueBounds.Width, opaqueBounds.Height) * 0.06));
            var expanded = ExpandWithinSource(opaqueBounds, padding, source.Width, source.Height);
            using (var working = CloneRegion(source, expanded))
            using (var processedBase = new Bitmap(working.Width, working.Height, PixelFormat.Format32bppArgb))
            using (var processedTeam = new Bitmap(working.Width, working.Height, PixelFormat.Format32bppArgb))
            {
                for (var y = 0; y < working.Height; y++)
                {
                    for (var x = 0; x < working.Width; x++)
                    {
                        var pixel = working.GetPixel(x, y);
                        if (pixel.A == 0)
                        {
                            processedBase.SetPixel(x, y, Color.Transparent);
                            processedTeam.SetPixel(x, y, Color.Transparent);
                            continue;
                        }

                        if (!IsTeamPixel(pixel))
                        {
                            processedBase.SetPixel(x, y, pixel);
                            processedTeam.SetPixel(x, y, Color.Transparent);
                            continue;
                        }

                        var gray = ToGray(pixel);
                        processedBase.SetPixel(x, y, Color.FromArgb(pixel.A, gray, gray, gray));
                        processedTeam.SetPixel(x, y, Color.FromArgb(pixel.A, gray, gray, gray));
                    }
                }

                if (squareCanvas)
                {
                    using (var squaredBase = PadToSquare(processedBase))
                    using (var squaredTeam = PadToSquare(processedTeam))
                    {
                        SavePng(squaredBase, basePath);
                        SavePng(squaredTeam, teamPath);
                    }
                    return;
                }

                SavePng(processedBase, basePath);
                SavePng(processedTeam, teamPath);
            }
        }
    }

    private static Rectangle GetOpaqueBounds(Bitmap bitmap)
    {
        var minX = bitmap.Width;
        var minY = bitmap.Height;
        var maxX = -1;
        var maxY = -1;
        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                if (bitmap.GetPixel(x, y).A == 0)
                {
                    continue;
                }

                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < minX || maxY < minY)
        {
            return Rectangle.Empty;
        }

        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    private static Rectangle ExpandWithinSource(Rectangle bounds, int padding, int maxWidth, int maxHeight)
    {
        var left = Math.Max(0, bounds.Left - padding);
        var top = Math.Max(0, bounds.Top - padding);
        var right = Math.Min(maxWidth, bounds.Right + padding);
        var bottom = Math.Min(maxHeight, bounds.Bottom + padding);
        return Rectangle.FromLTRB(left, top, right, bottom);
    }

    private static Bitmap CloneRegion(Bitmap source, Rectangle bounds)
    {
        var clone = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(clone))
        {
            graphics.Clear(Color.Transparent);
            graphics.DrawImage(
                source,
                new Rectangle(0, 0, bounds.Width, bounds.Height),
                bounds,
                GraphicsUnit.Pixel
            );
        }
        return clone;
    }

    private static Bitmap PadToSquare(Bitmap source)
    {
        var margin = Math.Max(6, (int)Math.Round(Math.Max(source.Width, source.Height) * 0.06));
        var side = Math.Max(source.Width, source.Height) + margin * 2;
        var output = new Bitmap(side, side, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(output))
        {
            graphics.Clear(Color.Transparent);
            var drawX = (side - source.Width) / 2;
            var drawY = side - source.Height - margin;
            graphics.DrawImage(source, drawX, drawY, source.Width, source.Height);
        }
        return output;
    }

    private static int ToGray(Color color)
    {
        return ClampToByte((int)Math.Round(color.R * 0.2126 + color.G * 0.7152 + color.B * 0.0722));
    }

    private static bool IsTeamPixel(Color color)
    {
        if (color.A < 16)
        {
            return false;
        }

        var r = color.R / 255.0;
        var g = color.G / 255.0;
        var b = color.B / 255.0;
        var max = Math.Max(r, Math.Max(g, b));
        var min = Math.Min(r, Math.Min(g, b));
        var delta = max - min;
        var saturation = max <= 0 ? 0 : delta / max;
        if (saturation < 0.12)
        {
            return false;
        }

        var hue = GetHue(r, g, b, max, delta);
        var blueDominance = color.B - Math.Max(color.R, color.G);
        var inBlueRange = hue >= 175 && hue <= 285;
        return inBlueRange && (saturation >= 0.18 || blueDominance >= 14);
    }

    private static double GetHue(double r, double g, double b, double max, double delta)
    {
        if (delta == 0)
        {
            return 0;
        }

        double hue;
        if (Math.Abs(max - r) < 0.00001)
        {
            hue = ((g - b) / delta) % 6.0;
        }
        else if (Math.Abs(max - g) < 0.00001)
        {
            hue = ((b - r) / delta) + 2.0;
        }
        else
        {
            hue = ((r - g) / delta) + 4.0;
        }

        hue *= 60.0;
        if (hue < 0)
        {
            hue += 360.0;
        }
        return hue;
    }

    private static int ClampToByte(int value)
    {
        if (value < 0) return 0;
        if (value > 255) return 255;
        return value;
    }

    private static void SavePng(Bitmap bitmap, string outputPath)
    {
        var directory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }
        bitmap.Save(outputPath, ImageFormat.Png);
    }
}
'@
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')

$jobs = @(
  @{
    Source = 'public/assets/new style/unit_soldier.png'
    Base = 'public/assets/units/unit_soldier_base.png'
    Team = 'public/assets/units/unit_soldier_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/unit_commander.png'
    Base = 'public/assets/units/unit_commander_base.png'
    Team = 'public/assets/units/unit_commander_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/unit_warrior.png'
    Base = 'public/assets/units/unit_warrior_base.png'
    Team = 'public/assets/units/unit_warrior_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/unit_warleader.png'
    Base = 'public/assets/units/unit_warleader_base.png'
    Team = 'public/assets/units/unit_warleader_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/unit_mage.png'
    Base = 'public/assets/units/unit_mage_base.png'
    Team = 'public/assets/units/unit_mage_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/unit_archmage.png'
    Base = 'public/assets/units/unit_archmage_base.png'
    Team = 'public/assets/units/unit_archmage_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/unit_barricade.png'
    Base = 'public/assets/units/unit_barricade_base.png'
    Team = 'public/assets/units/unit_barricade_team.png'
    SquareCanvas = $true
  },
  @{
    Source = 'public/assets/new style/building_spawn_village.png'
    Base = 'public/assets/buildings/spawn_village_base.png'
    Team = 'public/assets/buildings/spawn_village_team.png'
    SquareCanvas = $false
  }
)

foreach ($job in $jobs) {
  $sourcePath = Join-Path $repoRoot $job.Source
  $basePath = Join-Path $repoRoot $job.Base
  $teamPath = Join-Path $repoRoot $job.Team

  [GeneratedTeamAssetGenerator]::Generate($sourcePath, $basePath, $teamPath, [bool]$job.SquareCanvas)
  Write-Host "Generated $($job.Base) and $($job.Team)"
}
