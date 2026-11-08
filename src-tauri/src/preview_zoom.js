(() => {
  if (window.parent === window || location.hostname !== '127.0.0.1') return;

  function report() {
    const container = document.getElementById('typst-container-main');
    const documentSvg = document.querySelector('svg.typst-doc');
    if (!container || !documentSvg) return;
    const width = container.getBoundingClientRect().width;
    if (width > 0) {
      window.parent.postMessage(
        { type: 'papyri-typst-zoom', ratio: documentSvg.getBoundingClientRect().width / width },
        '*',
      );
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== 'papyri-typst-zoom-command') return;
    if (event.data.action !== 'in' && event.data.action !== 'out') return;
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: event.data.action === 'in' ? '=' : '-',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    setTimeout(report, 250);
  });
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) setTimeout(report, 250);
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.ctrlKey) setTimeout(report, 250);
    },
    true,
  );
  window.addEventListener('load', () => {
    setTimeout(report, 1000);
  });
})();
