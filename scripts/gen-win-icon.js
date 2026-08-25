#!/usr/bin/env node
/**
 * 从 assets/icons/icon-1024.png 生成 Windows 多尺寸 icon.ico
 * 用法：node scripts/gen-win-icon.js
 * 依赖：系统 python3 + Pillow（pip install pillow）
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const py = `
from PIL import Image
from pathlib import Path
import struct, io

root = Path(${JSON.stringify(root)})
src = root / 'assets' / 'icons' / 'icon-1024.png'
out = root / 'assets' / 'icons' / 'icon.ico'
if not src.exists():
    raise SystemExit(f'missing {src}')
base = Image.open(src).convert('RGBA')
sizes = [16, 24, 32, 48, 64, 128, 256]

def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()

images = []
for s in sizes:
    im = base.resize((s, s), Image.Resampling.LANCZOS)
    images.append((s, png_bytes(im)))

count = len(images)
header = struct.pack('<HHH', 0, 1, count)
entries, blobs = [], []
offset = 6 + 16 * count
for s, data in images:
    w = 0 if s >= 256 else s
    h = 0 if s >= 256 else s
    entries.append(struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(data), offset))
    blobs.append(data)
    offset += len(data)
out.write_bytes(header + b''.join(entries) + b''.join(blobs))
print(f'wrote {out} ({out.stat().st_size} bytes, sizes={sizes})')
`;

const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) process.exit(r.status || 1);
