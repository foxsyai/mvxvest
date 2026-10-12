// Light or dark before the first paint: the reader's choice if they made one,
// otherwise their system setting. hooks/useTheme.ts takes over after load.
(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('mvxvest:theme') || 'system';
  } catch (e) {}
  var dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-mvx-theme', dark ? 'mvx:dark-theme' : 'mvx:light-theme');
})();
