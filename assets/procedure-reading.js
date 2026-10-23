(function () {
  'use strict';
  window.OfficeManager.readingRequest = function (run, progress) {
    var controller = new AbortController(), started = Date.now();
    var timer = setInterval(function () { progress(Math.floor((Date.now() - started) / 1000)); }, 5000);
    var deadline = setTimeout(function () { controller.abort(); }, 210000);
    return Promise.resolve().then(function () { return run(controller.signal); }).catch(function (e) {
      if (controller.signal.aborted) throw new Error('READING_REQUEST_TIMEOUT');
      throw e;
    }).finally(function () { clearInterval(timer); clearTimeout(deadline); });
  };

  // The Working File workboard is additive: the existing procedure page and chat stay intact.
  // First build a deterministic understanding of the whole workbook (guide, PGA/programme,
  // risks, PBC, populations, reconciliations and tests). Only then load the existing
  // step-by-step Enhanced Auditor workboard. If understanding fails, that script still loads
  // the existing workboard so this layer cannot remove an acquired capability.
  if (document.getElementById('procedure-workspace')) {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/assets/working-file-agent-panel.css';
    document.head.appendChild(css);

    var script = document.createElement('script');
    script.src = '/assets/working-file-understanding-panel.js';
    script.defer = true;
    script.dataset.workingFileUnderstanding = '1';
    document.head.appendChild(script);
  }
})();
