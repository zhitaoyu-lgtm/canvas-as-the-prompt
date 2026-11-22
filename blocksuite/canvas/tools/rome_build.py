# Turns the line drawings into (1) compact transparent PNGs and (2) the strokes a pen would make:
# centre lines traced from the ink, each with its width, so the page can draw them one after another.
import sys, json, base64, struct, numpy as np
from PIL import Image
from skimage.morphology import skeletonize
from scipy import ndimage as ndi
SRC, OUT = sys.argv[1], sys.argv[2]
def trace(name, maxw, crop=None):
    im = Image.open(f'{SRC}/canvas-rome-{name}.png').convert('RGBA')
    if crop: im = im.crop(crop)   # the drawing only: no scale bar, no caption
    if im.width > maxw: im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    a = np.array(im); alpha = a[..., 3]
    # the picture kept on the board: ink only, no ground. gray + alpha, alpha in 32 steps → small
    la = np.dstack([np.full_like(alpha, 30), (np.round(alpha / 255 * 31) * (255 / 31)).astype(np.uint8)])
    Image.fromarray(la, 'LA').save(f'{OUT}/{name}.png', optimize=True)
    ink = alpha > 96
    sk = skeletonize(ink); dist = ndi.distance_transform_edt(ink)
    H, W = sk.shape; ys, xs = np.nonzero(sk); pts = set(zip(ys.tolist(), xs.tolist()))
    N8 = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    nb = lambda p: [(p[0]+dy, p[1]+dx) for dy, dx in N8 if (p[0]+dy, p[1]+dx) in pts]
    deg = {p: len(nb(p)) for p in pts}
    visited = set(); paths = []
    def walk(start, nxt):
        path = [start, nxt]; visited.add((start, nxt)); visited.add((nxt, start)); prev, cur = start, nxt
        while deg[cur] == 2:
            n = [q for q in nb(cur) if q != prev]
            if not n: break
            q = n[0]
            if (cur, q) in visited: break
            visited.add((cur, q)); visited.add((q, cur)); path.append(q); prev, cur = cur, q
        return path
    for p in pts:
        if deg[p] != 2:
            for q in nb(p):
                if (p, q) not in visited: paths.append(walk(p, q))
    seen = set(q for path in paths for q in path)
    for p in pts:   # closed loops with no junction
        if p not in seen and deg[p] == 2:
            q = nb(p)[0]; path = walk(p, q); seen.update(path); paths.append(path)
    for p in pts:   # lone dots
        if deg[p] == 0: paths.append([p, p])
    out = []
    for path in paths:
        w = float(np.mean([dist[y, x] for y, x in path])) * 2
        step = 3 if len(path) > 9 else 2
        keep = path[::step]
        if keep[-1] != path[-1]: keep.append(path[-1])
        out.append((w, [(x, y) for y, x in keep]))
    # binary: per path  n(uint16) w*8(uint16) then n × (x,y) uint16
    buf = bytearray()
    for w, k in out:
        buf += struct.pack('<HH', len(k), min(65535, max(8, round(w * 8))))
        for x, y in k: buf += struct.pack('<HH', x, y)
    print(name, im.size, 'paths', len(out), 'points', sum(len(k) for _, k in out), 'bytes', len(buf), 'ink', ink.mean())
    return {'w': W, 'h': H, 'data': base64.b64encode(bytes(buf)).decode()}
res = {'plan': trace('plan', 2400), 'section': trace('section', 1727, (0, 92, 1727, 676)), 'detail': trace('detail', 976)}
json.dump(res, open(f'{OUT}/strokes.json', 'w'))
for n, q in [('aerial', 90)]:
    im = Image.open(f'{SRC}/canvas-rome-aerial.png').convert('RGB'); im.save(f'{OUT}/aerial.jpg', quality=q, optimize=True); print('aerial', im.size)
import shutil
shutil.copy(f'{SRC}/canvas-rome-photo2.jpg', f'{OUT}/photo2.jpg'); shutil.copy(f'{SRC}/canvas-rome-photo3.jpg', f'{OUT}/photo3.jpg')
