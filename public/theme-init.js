(function () {
  try {
    var theme = localStorage.getItem('theme') || 'system';
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      var systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  } catch {}
})();
