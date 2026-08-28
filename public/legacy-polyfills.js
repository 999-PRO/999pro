// ============================================================================
// TRI999 — legacy-polyfills.js (v25.27)
// ----------------------------------------------------------------------------
// Поддержка старых ТВ-браузеров (Tizen/webOS/старый Android). Подключается
// ОБЫЧНЫМ (не module) <script> в <head> ДО всех бандлов Next.js, поэтому
// выполняется даже там, где ES-модули недоступны.
//
// Что делаем:
//   • globalThis (Chromium < 71)
//   • crypto.randomUUID (Chromium < 92)
//   • ResizeObserver / IntersectionObserver — безопасные заглушки
//     (без них framer-motion/скролл-хуки падают при инициализации)
//   • Element.closest (очень старые WebKit)
//   • scrollTo/scrollBy с опциями { behavior } — деградация в мгновенный скролл
//   • Детект отсутствия ES-модулей → вежливая плашка «обновите браузер»
//     поверх сплеша (иначе пользователь видит вечный сплеш и думает,
//     что приложение «не работает»).
// ============================================================================
(function () {
  // globalThis
  if (typeof globalThis === 'undefined') {
    try {
      if (typeof self !== 'undefined') self.globalThis = self
      if (typeof window !== 'undefined') window.globalThis = window
    } catch (e) { /* noop */ }
  }

  // crypto.randomUUID
  try {
    if (window.crypto && !window.crypto.randomUUID) {
      window.crypto.randomUUID = function () {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0
          var v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })
      }
    }
  } catch (e) { /* noop */ }

  // ResizeObserver guard (Chromium < 64)
  if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = function () {
      this.observe = function () {}
      this.unobserve = function () {}
      this.disconnect = function () {}
    }
  }

  // IntersectionObserver guard (Chromium < 51)
  if (typeof window.IntersectionObserver === 'undefined') {
    window.IntersectionObserver = function (cb) {
      this.observe = function (el) {
        try {
          cb([{ isIntersecting: true, target: el, intersectionRatio: 1 }], this)
        } catch (e) { /* noop */ }
      }
      this.unobserve = function () {}
      this.disconnect = function () {}
    }
  }

  // Element.closest (старые WebKit)
  if (window.Element && !Element.prototype.closest) {
    Element.prototype.closest = function (s) {
      var el = this
      var matches = el.matches || el.msMatchesSelector || el.webkitMatchesSelector
      while (el && el.nodeType === 1) {
        if (matches.call(el, s)) return el
        el = el.parentElement || el.parentNode
      }
      return null
    }
  }

  // scrollTo/scrollBy({ behavior }) → мгновенная прокрутка (Chromium < 61)
  try {
    if (!('scrollBehavior' in document.documentElement.style)) {
      if (window.Element) {
        Element.prototype.scrollTo = function (a, b) {
          if (typeof a === 'object' && a) { this.scrollLeft = a.left || 0; this.scrollTop = a.top || 0 }
          else { this.scrollLeft = a || 0; this.scrollTop = b || 0 }
        }
        Element.prototype.scrollBy = function (a, b) {
          if (typeof a === 'object' && a) { this.scrollLeft += a.left || 0; this.scrollTop += a.top || 0 }
          else { this.scrollLeft += a || 0; this.scrollTop += b || 0 }
        }
      }
      window.scrollTo = function (a, b) {
        if (typeof a === 'object' && a) { window.pageXOffset = a.left || 0; window.pageYOffset = a.top || 0 }
        else { window.pageXOffset = a || 0; window.pageYOffset = b || 0 }
      }
    }
  } catch (e) { /* noop */ }

  // Нет ES-модулей (Chromium < 61, многие ТВ) → JS-бандлы Next.js не
  // запустятся никогда. Честно сообщаем пользователю вместо вечного сплеша.
  try {
    var modulesOk = false
    try {
      modulesOk = typeof HTMLScriptElement !== 'undefined' &&
        HTMLScriptElement.supports && HTMLScriptElement.supports('module')
    } catch (e) { modulesOk = false }
    if (!modulesOk) {
      window.__TRI999_NO_MODULES__ = true
      var addNote = function () {
        var splash = document.getElementById('app-splash')
        if (!splash || splash.querySelector('[data-legacy-note]')) return
        var note = document.createElement('div')
        note.setAttribute('data-legacy-note', '1')
        note.textContent = 'Браузер слишком старый для приложения TRI999 — обновите его или откройте с телефона/компьютера'
        note.style.cssText = 'position:absolute;bottom:11%;left:50%;transform:translateX(-50%);' +
          'color:rgba(255,255,255,0.92);font-size:13px;line-height:1.5;text-align:center;max-width:78%;' +
          'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
        splash.appendChild(note)
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addNote)
      } else {
        addNote()
      }
    }
  } catch (e) { /* noop */ }
})()
