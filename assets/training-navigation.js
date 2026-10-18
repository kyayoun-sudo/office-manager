(function () {
  'use strict';
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-training-view]'));
  var views = ['cabinet', 'specialized', 'shadow'];
  function show(view) {
    if (views.indexOf(view) < 0) view = 'cabinet';
    views.forEach(function (key) { document.getElementById('training-' + key).hidden = key !== view; });
    buttons.forEach(function (b) { var selected = b.dataset.trainingView === view; b.setAttribute('aria-pressed', String(selected)); b.className = selected ? 'btn' : 'btn ghost'; });
  }
  function fromHash() { var value = location.hash.slice(1); show(value === 'tests-specialises' ? 'specialized' : value === 'lecons' || value === 'shadow-card' ? 'shadow' : 'cabinet'); }
  buttons.forEach(function (b) { b.addEventListener('click', function () {
    var key = b.dataset.trainingView;
    location.hash = key === 'cabinet' ? 'firm-simulation' : key === 'specialized' ? 'tests-specialises' : 'lecons';
    show(key);
  }); });
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
