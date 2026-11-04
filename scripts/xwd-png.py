# Screenshot an X display to PNG without ImageMagick: xwd -root, then decode the 24/32-bpp ZPixmap.
import struct, subprocess, sys
from PIL import Image
display, out = sys.argv[1], sys.argv[2]
raw = subprocess.run(['xwd', '-root', '-silent', '-display', display], check=True, capture_output=True).stdout
h = struct.unpack('>25I', raw[:100])
header_size, width, height, byte_order, bpp, bpl, ncolors = h[0], h[4], h[5], h[7], h[11], h[12], h[19]
data = raw[header_size + ncolors * 12:]
assert bpp in (24, 32), bpp
mode = 'RGBX' if bpp == 32 else 'RGB'
raw_mode = ('BGRX' if byte_order == 0 else 'XRGB') if bpp == 32 else ('BGR' if byte_order == 0 else 'RGB')
img = Image.frombuffer(mode, (width, height), data, 'raw', raw_mode, bpl, 1).convert('RGB')
img.save(out)
