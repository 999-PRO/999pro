#!/usr/bin/env python3
"""Generate a TOTP code for the local 999PRO admin (QA only)."""
import hmac, hashlib, struct, base64, time, sys, urllib.parse

secret = sys.argv[1] if len(sys.argv) > 1 else 'KH6Y35HZB5DPXITDIZVNR5M77UOHYZ2A'
key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8), casefold=True)
counter = int(time.time()) // 30
msg = struct.pack('>Q', counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
code = (struct.unpack('>I', digest[offset:offset+4])[0] & 0x7FFFFFFF) % 1000000
print(f'{code:06d}')
