#!/usr/bin/env python3
"""v25.21 API smoke: mobileHeroBlock PUT/GET roundtrip (as admin), price-lists, chat unread-counts."""
import json, hmac, hashlib, base64, struct, time, urllib.request, sys

BASE = 'http://localhost:4000'
SECRET = 'G5OMY46YSNPYL7DMUK3HCTIZFWUKSOUI'

def totp(secret):
    key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8), casefold=True)
    t = struct.pack('>Q', int(time.time()) // 30)
    h = hmac.new(key, t, hashlib.sha1).digest()
    o = h[19] & 15
    return str((struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000).zfill(6)

def req(method, path, body=None, cookie=None, bearer=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if cookie: r.add_header('Cookie', cookie)
    if bearer: r.add_header('Authorization', f'Bearer {bearer}')
    try:
        with urllib.request.urlopen(r) as resp:
            setc = resp.headers.get('Set-Cookie', '')
            return resp.status, json.loads(resp.read().decode()), setc
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}'), ''

# 1. admin login
code, body, setc = req('POST', '/api/auth/login', {'login': 'admin', 'password': 'Admin999!', 'totpCode': totp(SECRET)})
print('login:', code)
token = body.get('token', '')
if code != 200 or not token:
    print('LOGIN FAILED', body); sys.exit(1)
cookie = ''
for part in setc.split(','):
    part = part.strip()
    if part.startswith(('token=', 'connect.sid=', 'auth=')):
        cookie += part.split(';')[0] + '; '
if code != 200:
    print('LOGIN FAILED', body); sys.exit(1)
# 2. mobileHeroBlock PUT
mh = {
    'enabled': True,
    'media': ['/uploads/smoke-banner.jpg'],
    'badge': 'Смоук',
    'title': 'Тест v25.21',
    'description': None,
    'primaryButton': {'text': 'В каталог', 'view': 'catalog', 'link': None},
    'secondaryButton': None,
}
code, body, _ = req('PUT', '/api/settings/mobileHeroBlock', mh, None, token)
print('PUT mobileHeroBlock:', code, '' if code == 200 else body)
code, body, _ = req('GET', '/api/settings/mobileHeroBlock')
print('GET mobileHeroBlock:', code, json.dumps(body.get('value'), ensure_ascii=False)[:160])

# 3. heroBlock PUT with videos (validate new videos field survives roundtrip)
code, cur, _ = req('GET', '/api/settings/heroBlock')
hero = cur.get('value') or {}
# stored value may be partial (client merges defaults); PUT needs full shape
hero = {
    'enabled': hero.get('enabled', True),
    'useGradient': hero.get('useGradient', True),
    'image': hero.get('image', None),
    'images': hero.get('images', []),
    'gradient': hero.get('gradient', 'from-sky-400 via-blue-500 to-indigo-600'),
    'badge': hero.get('badge', None),
    'title': hero.get('title', '999 Store'),
    'description': hero.get('description', None),
    'primaryButton': hero.get('primaryButton') or {'text': 'В каталог', 'view': 'catalog', 'link': None},
    'secondaryButton': hero.get('secondaryButton') or {'text': 'Ещё', 'view': None, 'link': None},
    'objectFit': hero.get('objectFit', 'cover'),
    'mode': hero.get('mode', 'image-text'),
}
hero['videos'] = ['/uploads/smoke-hero.mp4']
code, body, _ = req('PUT', '/api/settings/heroBlock', hero, None, token)
print('PUT heroBlock(+videos):', code, '' if code == 200 else body)
code, body, _ = req('GET', '/api/settings/heroBlock')
print('GET heroBlock videos =', (body.get('value') or {}).get('videos'))

# cleanup: disable test mobile hero, keep hero videos field empty again
mh['enabled'] = False
req('PUT', '/api/settings/mobileHeroBlock', mh, None, token)
hero['videos'] = []
req('PUT', '/api/settings/heroBlock', hero, None, token)
print('cleanup done')

# 4. price-lists GET (public)
code, body, _ = req('GET', '/api/price-lists')
print('GET price-lists:', code, 'items:', len(body.get('items', [])))

# 5. chat unread-counts (admin)
code, body, _ = req('GET', '/api/chat/unread-counts', None, None, token)
print('GET chat/unread-counts:', code, json.dumps(body, ensure_ascii=False)[:120])
