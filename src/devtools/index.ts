chrome.devtools.panels.create(
  'OPFS',
  'icons/128.png',
  'panel.html',
  (panel) => {
    panel.onShown.addListener(() => {
      // panel became visible — could re-sync state here if needed
    });
  },
);
