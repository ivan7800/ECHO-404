(() => {
  let theme;
  try { theme = localStorage.getItem('echo404-theme'); } catch {}
  if (!['light', 'dark'].includes(theme)) theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
})();
