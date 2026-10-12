// Light or dark before the first paint: the reader's choice if they made one,
// otherwise dark (the mvxsafe.io look). hooks/useTheme.ts takes over after load.
(function () {
  var choice = 'dark';
  try {
    choice = localStorage.getItem('mvxvest:theme') || 'dark';
  } catch (e) {}
  var dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-mvx-theme', dark ? 'mvx:dark-theme' : 'mvx:light-theme');
})();
