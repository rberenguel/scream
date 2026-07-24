(function () {
  var CHANNEL = 'scream-presenter';
  var isPresenter = window.name === CHANNEL;
  var channel = new BroadcastChannel(CHANNEL);
  var presenterWin = null;

  var current = 0;
  var wrappers   = Array.from(document.querySelectorAll('.slide-wrapper'));
  var noteSlides = Array.from(document.querySelectorAll('.notes-slide'));
  var ovCards    = Array.from(document.querySelectorAll('.ov-card'));
  var total = wrappers.length;

  /* ── shared ── */

  function broadcastState() {
    if (isPresenter || !presenterWin || presenterWin.closed) return;
    var next = Math.min(current + 1, total - 1);
    channel.postMessage({
      type: 'state-update',
      idx: current,
      total: total,
      cur:   wrappers[current].querySelector('.slide-preview-box').outerHTML,
      nxt:   wrappers[next].querySelector('.slide-preview-box').outerHTML,
      notes: noteSlides[current].innerHTML,
      light: document.body.classList.contains('light-theme'),
    });
  }

  function showSlide(i) {
    wrappers[current].classList.remove('active');
    noteSlides[current].classList.remove('active');
    if (ovCards[current]) ovCards[current].classList.remove('active');
    current = Math.max(0, Math.min(total - 1, i));
    wrappers[current].classList.add('active');
    noteSlides[current].classList.add('active');
    if (ovCards[current]) {
      ovCards[current].classList.add('active');
      ovCards[current].scrollIntoView({ block: 'nearest' });
    }
    document.dispatchEvent(new CustomEvent('scream:slidechange'));
    if (!isPresenter) broadcastState();
  }

  /* ── presenter window ── */

  if (isPresenter) {
    document.getElementById('main-view').style.display = 'none';
    var pv = document.getElementById('presenter-view');
    pv.style.display = 'flex';

    var elCur    = document.getElementById('pv-current-slide');
    var elNxt    = document.getElementById('pv-next-slide');
    var elNotes  = document.getElementById('pv-notes');
    var elCount  = document.getElementById('pv-counter');

    document.getElementById('pv-prev-btn').onclick = function () {
      channel.postMessage({ type: 'cmd', action: 'prev' });
    };
    document.getElementById('pv-next-btn').onclick = function () {
      channel.postMessage({ type: 'cmd', action: 'next' });
    };

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        channel.postMessage({ type: 'cmd', action: 'next' });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        channel.postMessage({ type: 'cmd', action: 'prev' });
      }
    });

    channel.onmessage = function (e) {
      var m = e.data;
      if (m.type !== 'state-update') return;
      elCur.innerHTML   = m.cur;
      elNxt.innerHTML   = m.nxt;
      elNotes.innerHTML = m.notes || '<span class="pv-notes-empty">No notes</span>';
      if (elCount) elCount.textContent = (m.idx + 1) + ' / ' + m.total;
      document.body.classList.toggle('light-theme', !!m.light);
    };

    window.addEventListener('beforeunload', function () {
      channel.postMessage({ type: 'cmd', action: 'presenter-closing' });
    });

    setTimeout(function () {
      channel.postMessage({ type: 'cmd', action: 'presenter-ready' });
    }, 150);

  /* ── audience window ── */

  } else {
    channel.onmessage = function (e) {
      if (wrappers.length && !wrappers[0].isConnected) return;
      var m = e.data;
      if (m.type !== 'cmd') return;
      if      (m.action === 'next')              showSlide(current + 1);
      else if (m.action === 'prev')              showSlide(current - 1);
      else if (m.action === 'presenter-closing') presenterWin = null;
      else if (m.action === 'presenter-ready') {
        presenterWin = window.open('', CHANNEL);
        broadcastState();
      }
    };

    document.addEventListener('scream:exit-present', function () { channel.close(); }, { once: true });

    document.addEventListener('keydown', function (e) {
      // Guard for in-page present mode: bail if our slide DOM has been removed.
      if (wrappers.length && !wrappers[0].isConnected) return;
      if (e.key === 'Escape' && document.body.classList.contains('help-open')) {
        document.body.classList.remove('help-open');
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (!presenterWin || presenterWin.closed) {
          presenterWin = window.open(
            window._presentUrl || window.location.href, CHANNEL,
            'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no'
          );
        } else {
          presenterWin.focus();
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault(); showSlide(current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); showSlide(current - 1);
      } else if (e.key === 'n' || e.key === 'N') {
        document.body.classList.toggle('notes-open');
      } else if (e.key === 'o' || e.key === 'O') {
        document.body.classList.toggle('overview-open');
      } else if (e.key === 'l' || e.key === 'L') {
        document.body.classList.toggle('light-theme');
        var _po = document.getElementById('present-overlay');
        if (_po) _po.classList.toggle('light-theme');
        broadcastState();
      } else if (e.key === 'Home') {
        e.preventDefault(); showSlide(0);
      } else if (e.key === 'End') {
        e.preventDefault(); showSlide(total - 1);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        document.body.classList.remove('scale-2', 'scale-3');
        if (e.key === '2') document.body.classList.add('scale-2');
        if (e.key === '3') document.body.classList.add('scale-3');
      } else if (e.key === '?') {
        document.body.classList.toggle('help-open');
      }
    });

    var _helpOverlay = document.querySelector('#present-overlay #help-overlay') || document.getElementById('help-overlay');
    _helpOverlay.addEventListener('click', function (e) {
      if (!e.target.closest('.help-box')) document.body.classList.remove('help-open');
    });

    document.addEventListener('click', function (e) {
      if (wrappers.length && !wrappers[0].isConnected) return;
      if (document.body.classList.contains('help-open')) return;
      var card = e.target.closest('.ov-card');
      if (card) showSlide(parseInt(card.dataset.index, 10));
    });

    window.addEventListener('beforeunload', function () {
      if (presenterWin && !presenterWin.closed) presenterWin.close();
    });

    showSlide(typeof window._startSlide === 'number' ? window._startSlide : 0);
  }
})();
