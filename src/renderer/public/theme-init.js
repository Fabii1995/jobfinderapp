// Runs synchronously before first paint to avoid a flash of the wrong theme.
// External file (not inline) because the CSP forbids inline scripts.
// Keep the storage key/shape in sync with src/renderer/src/store/theme.ts.
;(function () {
  var theme = 'system'
  try {
    var raw = window.localStorage.getItem('jobfinder-theme-v1')
    var t = raw && JSON.parse(raw).state.theme
    if (t === 'light' || t === 'dark' || t === 'system') theme = t
  } catch (e) {}
  var dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
