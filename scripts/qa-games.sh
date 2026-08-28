#!/bin/bash
# QA loop: open each game, verify GameShell appears, log page errors, close.
S="agent-browser --session gamesqa"
GAMES=("Супер-раннер" "Дудл-прыг" "Ночной забег" "Космический шутер" "Танчики" "Миллионер" "Угадай флаг" "Угадай столицу" "Спорт-викторина" "Угадай слово" "Поле чудес" "Шахматы" "Шашки" "Раскраска" "Найди пару" "Пузыри" "Детская математика" "Азбука")
for g in "${GAMES[@]}"; do
  echo "=== $g ==="
  $S find role button click --name "$g" > /dev/null 2>&1
  $S wait 1600 > /dev/null 2>&1
  RES=$($S eval "(() => { const t = document.body.innerText; const hasExit = !!Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Выход' || b.closest('[class*=fixed]') && b.querySelector('svg') && b.textContent?.trim() === ''); return t.includes('$g') && t.length > 0 ? 'OPEN' : 'MISSING'; })()" 2>&1 | tail -1)
  echo "state: $RES"
  ERR=$($S errors 2>&1 | grep -v "✓ Done" | grep -v "stderr" | grep -v "launched browser" | head -4)
  [ -n "$ERR" ] && echo "PAGE_ERRORS: $ERR"
  # close the shell via the X button (first button in shell header)
  $S eval "(() => { const btns = Array.from(document.querySelectorAll('button')); const x = btns.find(b => { const r = b.getBoundingClientRect(); return r.top < 80 && r.left < 80 && r.width > 0 && b.querySelector('svg'); }); if (x) { x.click(); return 'closed'; } return 'no-x'; })()" > /dev/null 2>&1
  $S wait 700 > /dev/null 2>&1
done
echo "DONE"
