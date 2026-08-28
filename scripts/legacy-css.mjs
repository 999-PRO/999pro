// ============================================================================
// TRI999 — legacy-css.mjs (v25.27)
// ----------------------------------------------------------------------------
// ПРОБЛЕМА (владелец): «на телевизоре приложение открывается без CSS, ничего
// не нажимается». Причина: Tailwind v4 генерирует CSS с @layer, @property,
// oklch()/color-mix() и вложенными селекторами. Старые ТВ-браузеры
// (Chromium 60–98, Tizen/webOS) не понимают @layer и ВЫБРАСЫВАЮТ ВСЁ
// содержимое слоя целиком → страница открывается «голая».
//
// РЕШЕНИЕ: пост-обработка собранных CSS-чанков lightningcss с targets на
// старые браузеры:
//   • @layer  → разворачивается в плоский CSS (содержимое сохраняется)
//   • oklch()/lab()/color-mix() → статически пересчитываются в rgb()
//   • вложенные селекторы → разворачиваются
//   • minify — заодно меньше трафик
// Вызывается автоматически после `next build` (scripts/build.js).
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// lightningcss: версия кодируется как (major << 16 | minor << 8 | patch)
const V = (major, minor = 0, patch = 0) => (major << 16) | (minor << 8) | patch

// Целевые браузеры: ТВ-платформы и «последние старые» десктопы.
// Chromium 81 (2020) — база Tizen 6/webOS 6; ниже модули не работают всё равно.
const TARGETS = {
  chrome: V(81),
  edge: V(88),
  firefox: V(78),
  safari: V(13),
  ios_saf: V(13),
  // samsung — браузер ТВ Samsung (на базе Chromium)
  samsung: V(13),
}

const ROOT = path.resolve(__dirname, '..')

// ────────────────────────────────────────────────────────────────────────────
// flattenCssLayers — lightningcss НЕ разворачивает @layer (оставил как есть в
// пробном прогоне). Старые браузеры (Chromium < 99) выбрасывают содержимое
// @layer целиком → «приложение без CSS». Поэтому разворачиваем слои сами:
//   @layer theme, base, utilities;      → удаляется
//   @layer base { ... }                 → ... (содержимое остаётся на месте)
// Порядок блоков сохраняется → каскад эквивалентен слоёному.
// ────────────────────────────────────────────────────────────────────────────
export function flattenCssLayers(code) {
  let css = typeof code === 'string' ? code : code.toString('utf8')
  let guard = 0
  // Шаг 1: инструкции без тела — `@layer a, b;`
  css = css.replace(/@layer[^{;]*;/g, '')
  // Шаг 2: блоки с телом — разворачиваем с учётом вложенных скобок,
  // повторяем пока остаются @layer { } (бывают вложенные).
  let hasLayers = /@layer[\s\S]*?\{/.test(css)
  while (hasLayers && guard < 50) {
    guard += 1
    hasLayers = false
    let out = ''
    let i = 0
    const n = css.length
    while (i < n) {
      const idx = css.indexOf('@layer', i)
      if (idx === -1) {
        out += css.slice(i)
        break
      }
      // Не «слой» ли это в строке/комментарии — для Tailwind CSS не критично,
      // проверяем что перед @layer идёт не буква (это часть идентификатора).
      const prev = idx > 0 ? css[idx - 1] : ''
      if (/[A-Za-z0-9_-]/.test(prev)) {
        out += css.slice(i, idx + 6)
        i = idx + 6
        continue
      }
      out += css.slice(i, idx)
      // читаем до первой {
      const braceIdx = css.indexOf('{', idx)
      const semiIdx = css.indexOf(';', idx)
      if (braceIdx === -1 || (semiIdx !== -1 && semiIdx < braceIdx)) {
        // `@layer a, b;` — удаляем целиком
        i = semiIdx !== -1 ? semiIdx + 1 : n
        continue
      }
      // ищем парную закрывающую скобку с учётом вложенности
      let depth = 0
      let j = braceIdx
      for (; j < n; j += 1) {
        const ch = css[j]
        if (ch === '{') depth += 1
        else if (ch === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      if (depth !== 0) {
        // повреждённый CSS — оставляем как есть
        out += css.slice(idx)
        i = n
        break
      }
      // содержимое блока (без внешних скобок) остаётся на месте
      out += css.slice(braceIdx + 1, j)
      i = j + 1
      hasLayers = true
    }
    css = out
  }
  return css
}

function walkCss(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walkCss(p, out)
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

export function downlevelDir(label, staticDir) {
  const cssDir = path.join(staticDir, 'css')
  const files = walkCss(cssDir)
  if (!files.length) {
    console.log(`  ${label}: CSS-чанков не найдено (${cssDir}) — пропускаем`)
    return 0
  }
  let n = 0
  for (const file of files) {
    try {
      let code = fs.readFileSync(file)
      // 1) Разворачиваем @layer (иначе старые браузеры выбросят всё содержимое)
      code = Buffer.from(flattenCssLayers(code))
      // 2) lightningcss: oklch/color-mix → rgb, вложенность → плоские селекторы
      const result = transform({
        filename: file,
        code,
        targets: TARGETS,
        minify: true,
        errorRecovery: true,
      })
      fs.writeFileSync(file, result.code)
      n += 1
    } catch (e) {
      // Не валим сборку из-за одного чанка — оставляем оригинал.
      console.warn(`  ! ${path.relative(ROOT, file)}: ${e.message || e}`)
    }
  }
  console.log(`  ✓ ${label}: ${n} CSS-чанк(ов) сконвертированы под старые браузеры`)
  return n
}

// CLI-режим: node scripts/legacy-css.mjs [staticDir ...]
// Без аргументов — фронтенд (.next/static) + студия (mini-services/studio/.next/static).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('▶ Legacy CSS downlevel (TV / старые браузеры)')
  const dirs = process.argv.slice(2)
  if (dirs.length) {
    for (const d of dirs) downlevelDir(path.basename(path.resolve(d)), d)
  } else {
    downlevelDir('frontend', path.join(ROOT, '.next', 'static'))
    downlevelDir('studio', path.join(ROOT, 'mini-services', 'studio', '.next', 'static'))
  }
  console.log('✓ Legacy CSS готов')
}
