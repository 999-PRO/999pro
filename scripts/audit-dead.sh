#!/bin/bash
# v25.18 audit: find unreferenced source files (dead code candidates)
cd /home/z/my-project
echo "=== Unreferenced files in src/components ==="
for f in $(find src/components src/modules src/lib -maxdepth 2 -name '*.tsx' -o -maxdepth 2 -name '*.ts' | grep -v '.test.' | grep -v 'index.ts$'); do
  base=$(basename "$f" | sed 's/\.tsx$//;s/\.ts$//')
  # skip likely route/hooks conventions
  count=$(grep -rl "from.*${base}" src --include='*.tsx' --include='*.ts' 2>/dev/null | grep -v "^$f$" | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "  $f"
  fi
done 2>/dev/null | head -40
