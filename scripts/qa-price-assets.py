#!/usr/bin/env python3
"""Create test price-list files (PDF with real text + 2 PNGs), upload & register via API."""
import json, struct, zlib, hmac, hashlib, base64, time, urllib.request, io

BASE = 'http://localhost:4000'
SECRET = 'G5OMY46YSNPYL7DMUK3HCTIZFWUKSOUI'

def totp(secret):
    key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8), casefold=True)
    t = struct.pack('>Q', int(time.time()) // 30)
    h = hmac.new(key, t, hashlib.sha1).digest()
    o = h[19] & 15
    return str((struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000).zfill(6)

def api(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if token: r.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')

# login admin
code, body = api('POST', '/api/auth/login', {'login': 'admin', 'password': 'Admin999!', 'totpCode': totp(SECRET)})
token = body['token']
print('login', code)

# ---- minimal 1-page PDF with real text (handcrafted, no deps) ----
def make_pdf(lines):
    content = 'BT /F1 24 Tf 60 760 Td 22 TL\n'
    for ln in lines:
        safe = ln.replace('(', '').replace(')', '')
        content += f'({safe}) Tj T*\n'
    content += 'ET'
    cb = content.encode('cp1251', errors='replace')
    objs = []
    objs.append(b'<< /Type /Catalog /Pages 2 0 R >>')
    objs.append(b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    objs.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>')
    objs.append(b'<< /Length ' + str(len(cb)).encode() + b' >>\nstream\n' + cb + b'\nendstream')
    objs.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    out = io.BytesIO()
    out.write(b'%PDF-1.4\n')
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f'{i} 0 obj\n'.encode() + o + b'\nendobj\n')
    xref = out.tell()
    out.write(f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'.encode())
    for off in offsets:
        out.write(f'{off:010d} 00000 n \n'.encode())
    out.write(f'trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode())
    return out.getvalue()

pdf_bytes = make_pdf([
    '999PRO - PAUSLIST 2026',
    '',
    '1. Vizitki 5x5 - 390 руб / 100 sht',
    '2. Listovki A5 - 790 руб / 500 sht',
    '3. Bannery 3x1 m - 1450 rub',
    '4. Naklejki - 590 rub / 200 sht',
    '',
    'Test PDF viewer v25.21 - esli vidno etot tekst,',
    'znachit pdf.js rabotaet pravilno!',
])
open('/tmp/price-test.pdf', 'wb').write(pdf_bytes)

# ---- PNG generator (pure stdlib) ----
def make_png(path, rgb):
    w, h = 320, 452
    rows = b''
    for y in range(h):
        rows += b'\x00'
        for x in range(w):
            r, g, b = rgb
            if (x // 60 + y // 60) % 2 == 0:
                r2, g2, b2 = min(255, r + 30), min(255, g + 30), min(255, b + 30)
            else:
                r2, g2, b2 = r, g, b
            rows += bytes((r2, g2, b2))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)

make_png('/tmp/price-a.png', (236, 72, 153))
make_png('/tmp/price-b.png', (99, 102, 241))
print('assets ready')

# ---- upload via /api/upload ----
def upload(path, fname, mime, token):
    boundary = '----v2521smoke'
    data = open(path, 'rb').read()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\n'
            f'Content-Type: {mime}\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    r = urllib.request.Request(BASE + '/api/upload', data=body, method='POST')
    r.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    r.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print('UPLOAD FAIL', fname, e.code, e.read().decode()[:300])
        raise

u1 = upload('/tmp/price-test.pdf', 'price-test.pdf', 'application/pdf', token)
u2 = upload('/tmp/price-a.png', 'price-a.png', 'image/png', token)
u3 = upload('/tmp/price-b.png', 'price-b.png', 'image/png', token)
print('uploads:', u1, u2, u3)

# ---- create price lists ----
def mk(title, desc, url, ftype, cat):
    payload = {'title': title, 'description': desc, 'fileUrl': url if url.startswith('/') else '/' + url, 'fileType': ftype, 'category': cat, 'isVisible': True}
    return api('POST', '/api/price-lists', payload, token)

for payload, res in [
    (('Прайс: Визитки (PDF)', 'PDF с текстом — тест pdf.js', u1.get('url') or u1.get('fileUrl'), 'pdf', 'Визитки'), None),
    (('Прайс: Баннеры (фото)', 'Картинка-прайс №1', u2.get('url') or u2.get('fileUrl'), 'image', 'Баннеры'), None),
    (('Прайс: Наклейки (фото)', 'Картинка-прайс №2', u3.get('url') or u3.get('fileUrl'), 'image', 'Наклейки'), None),
]:
    code, body = mk(*payload)
    print('create', payload[0], '->', code)

code, body = api('GET', '/api/price-lists')
print('total price lists now:', len(body.get('items', [])))
