# Toolspell icons

Each channel uses the same white spark and handle glyph over a solid background.

| Channel   | Background | Used for                                                |
| --------- | ---------- | ------------------------------------------------------- |
| `prod`    | `#5A27A0`  | Default web build and release packaging                 |
| `nightly` | `#182751`  | Web builds with `--mode nightly` and nightly packaging  |
| `dev`     | `#006851`  | Vite dev server, Electron dev, and T3 Code project icon |

Vite serves the selected channel's `web/` directory at the same URLs in every channel.

| File                       | Dimensions in pixels                                 |
| -------------------------- | ---------------------------------------------------- |
| `universal-1024.png`       | 1024 × 1024                                          |
| `macos-1024.png`           | 1024 × 1024 with an 824 × 824 body and 100 px inset  |
| `windows.ico`              | Square frames at 16, 24, 32, 48, 64, 128, and 256 px |
| `web/favicon.ico`          | Square frames at 16, 24, 32, 48, 64, 128, and 256 px |
| `web/favicon-16x16.png`    | 16 × 16                                              |
| `web/favicon-32x32.png`    | 32 × 32                                              |
| `web/apple-touch-icon.png` | 180 × 180                                            |
| `web/icon-192x192.png`     | 192 × 192                                            |
| `web/icon-512x512.png`     | 512 × 512                                            |

## Regenerate the exports

Use each channel's `universal-1024.png` as the full-bleed master. If replacing the artwork, use
the same glyph, scale, and position in all three masters and change the background color by channel.
Run the following from the repository root with Python 3 and Pillow installed.

```sh
python3 - <<'PY'
from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw

grid = 824
scale = 4
mask = Image.new("L", (grid * scale, grid * scale))
ImageDraw.Draw(mask).rounded_rectangle(
    (0, 0, grid * scale - 1, grid * scale - 1), radius=184 * scale, fill=255
)
mask = mask.resize((grid, grid), Image.Resampling.LANCZOS)

for channel in ("prod", "nightly", "dev"):
    directory = Path("assets") / channel
    web = directory / "web"
    web.mkdir(exist_ok=True)
    master = Image.open(directory / "universal-1024.png").convert("RGB")
    body = master.resize((grid, grid), Image.Resampling.LANCZOS)
    body.putalpha(mask)
    macos = Image.new("RGBA", (1024, 1024))
    macos.paste(body, (100, 100))
    macos.save(directory / "macos-1024.png", optimize=True)

    for name, size in (
        ("favicon-16x16", 16),
        ("favicon-32x32", 32),
        ("apple-touch-icon", 180),
        ("icon-192x192", 192),
        ("icon-512x512", 512),
    ):
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            web / f"{name}.png", optimize=True
        )

    sizes = [(size, size) for size in (16, 24, 32, 48, 64, 128, 256)]
    master.save(directory / "windows.ico", sizes=sizes)
    copyfile(directory / "windows.ico", web / "favicon.ico")
PY
```

## Glyph source

The glyph came from the built-in ImageGen tool. The opaque white silhouette was isolated from
the generated raster and fitted within a centered 700 × 700 px area in the universal masters.

```text
Use case: logo-brand. Create artwork for a new original Toolspell app icon. Single flat opaque white silhouette on a genuinely transparent square canvas: a stout diagonal handle that widens into a single four-point smithing spark at its upper-right head, seamlessly fused into one shape like a magical hand tool. Orient the solid handle from bottom left to top right, with a slightly rounded blunt pommel. Use a crisp bold silhouette and thick geometry, with at most one broad change of width in the handle. Keep the spark's other three rays short and substantial. Center the whole silhouette optically, balanced with generous transparent space. The single shape must stay recognizable at 16 pixels. Crisp polished raster logo, pure white only, no lines, holes, extra marks, separate sparkles, reflections, shadows, outlines, gradients, tiles, frame, words, letters or resemblance to existing brand marks.
```
