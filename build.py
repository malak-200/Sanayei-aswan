#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — يدمج كل الملفات في index.html واحد جاهز للرفع
الاستخدام:
    python3 build.py
الإخراج:
    index-built.html  ← الملف النهائي
"""

import os
import re

SHELL   = 'index.html'       # الملف الأساسي (shell)
OUTPUT  = 'index-built.html' # الملف النهائي

print('🔨  يبدأ الدمج...\n')

with open(SHELL, 'r', encoding='utf-8') as f:
    content = f.read()

# ── استبدال كل صفحة ──────────────────────────────────────────────────────────
page_refs = re.findall(r'<!-- PAGE_INCLUDE:(page-[^-][^\s>-][^\s>]*?) -->', content)
page_refs = re.findall(r'<!-- PAGE_INCLUDE:([\w-]+) -->', content)

for page_id in page_refs:
    fname = f'pages/{page_id}.html'
    if os.path.exists(fname):
        with open(fname, 'r', encoding='utf-8') as f:
            page_html = f.read()
        content = content.replace(f'<!-- PAGE_INCLUDE:{page_id} -->', page_html)
        print(f'  ✅ {fname}')
    else:
        print(f'  ⚠️  مش موجود: {fname}')

# ── استبدال كل JS ─────────────────────────────────────────────────────────────
js_refs = re.findall(r'<!-- JS_INCLUDE:([\w-]+) -->', content)

for label in js_refs:
    fname = f'js/{label}.js'
    if os.path.exists(fname):
        with open(fname, 'r', encoding='utf-8') as f:
            js_body = f.read()
        content = content.replace(
            f'<!-- JS_INCLUDE:{label} -->',
            f'<script>\n{js_body}\n</script>'
        )
        print(f'  ✅ {fname}')
    else:
        print(f'  ⚠️  مش موجود: {fname}')

# ── كتابة الملف النهائي ────────────────────────────────────────────────────────
with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(content)

lines = content.count('\n') + 1
print(f'\n🎉  اتكتب: {OUTPUT}  ({lines:,} سطر)')
