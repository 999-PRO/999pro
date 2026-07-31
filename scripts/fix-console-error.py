#!/usr/bin/env python3
"""Replace console.error calls with logger.error in backend lib files."""
import re
from pathlib import Path

# Map of (file, old_string, new_string)
replacements = [
    ('src/lib/moderation.ts',
     "console.error('[moderation] recordAIFlag failed:', e)",
     "logger.error('recordAIFlag failed', { module: 'moderation', error: e instanceof Error ? e : new Error(String(e)) })"),
    ('src/lib/moderation.ts',
     "console.error('[moderation] recordViolation failed:', e)",
     "logger.error('recordViolation failed', { module: 'moderation', error: e instanceof Error ? e : new Error(String(e)) })"),
    ('src/lib/moderation.ts',
     "console.error('[moderation] logModerationAction failed:', e)",
     "logger.error('logModerationAction failed', { module: 'moderation', error: e instanceof Error ? e : new Error(String(e)) })"),
]

base = Path('/home/z/my-project/app/999pro/mini-services/backend')
for relpath, old, new in replacements:
    p = base / relpath
    content = p.read_text(encoding='utf-8')
    if old in content:
        content = content.replace(old, new)
        p.write_text(content, encoding='utf-8')
        print(f"✓ {relpath}: replaced")
    else:
        print(f"✗ {relpath}: not found")

# Verify
for relpath, _, _ in replacements:
    p = base / relpath
    content = p.read_text(encoding='utf-8')
    count = content.count('console.error')
    print(f"  {relpath}: {count} console.error remaining")

# Check if logger is imported in moderation.ts
mod = (base / 'src/lib/moderation.ts').read_text(encoding='utf-8')
if "from './logger.js'" not in mod and 'from "../lib/logger.js"' not in mod:
    print("⚠ moderation.ts needs logger import")
