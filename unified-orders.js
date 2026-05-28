// ==================== UNIFIED ORDERS ====================
  (function () {
    var _role = 'client', _cf = 'all', _wf = 'all', _co = [], _wo = [], _cu = null, _wu = null;

    window.showUnifiedOrders = function () {
      if (!currentUser) { showAuthPage('login'); return; }
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
      document.getElementById('page-unified-orders').classList.add('active');
      window.scrollTo(0, 0);
      if (typeof updateClientOrderBadge === 'function') updateClientOrderBadge(0);
      if (typeof markClientOrderNotifsRead === 'function') markClientOrderNotifsRead();
      var tabs = document.getElementById('uord-role-tabs');
      if (tabs) tabs.style.display = 'none';
      uordSwitchRole((currentProfile && currentProfile.role === 'worker') ? 'worker' : 'client');
    };

    window.uordSwitchRole = function (role) {
      _role = role;
      var cv = document.getElementById('uord-client-view');
      var wv = document.getElementById('uord-worker-view');
      if (role === 'client') {
        if (cv) cv.style.display = 'block'; if (wv) wv.style.display = 'none'; startCL();
      } else {
        if (cv) cv.style.display = 'none'; if (wv) wv.style.display = 'block'; startWL();
      }
    };

    function startCL() {
      if (_cu) { _cu(); _cu = null; }
      if (!currentUser) return;
      var el = document.getElementById('uord-client-list');
      if (el) el.innerHTML = msg('\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0645\u064a\u0644...');
      _cu = onValue(ref(db, 'service_requests'), function (snap) {
        _co = snap.exists() ? Object.values(snap.val()).filter(function (o) { return o.user_id === currentUser.uid; }).sort(byDate) : [];
        renderC();
        var n = _co.filter(function (o) { return ['price_offered', 'client_counter', 'accepted', 'worker_done_pending'].indexOf(o.status) > -1; }).length;
        if (typeof updateClientOrderBadge === 'function') updateClientOrderBadge(n);
      });
    }

    function startWL() {
      if (_wu) { _wu(); _wu = null; }
      if (!currentUser) return;
      var el = document.getElementById('uord-worker-list');
      if (el) el.innerHTML = msg('\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0645\u064a\u0644...');
      _wu = onValue(ref(db, 'service_requests'), function (snap) {
        _wo = snap.exists() ? Object.values(snap.val()).filter(function (o) { return o.worker_id === currentUser.uid; }).sort(byDate) : [];
        renderW();
      });
    }

    function byDate(a, b) { return new Date(b.created_at) - new Date(a.created_at); }
    function msg(t) { return '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">' + t + '</p>'; }

    window.uordFilterClient = function (s) {
      _cf = s;
      document.querySelectorAll('[id^="ucord-tab-"]').forEach(function (b) { b.classList.remove('uord-tab-active'); });
      var t = document.getElementById('ucord-tab-' + s); if (t) t.classList.add('uord-tab-active');
      renderC();
    };
    window.uordFilterWorker = function (s) {
      _wf = s;
      document.querySelectorAll('[id^="uwreq-tab-"]').forEach(function (b) { b.classList.remove('uord-tab-active'); });
      var t = document.getElementById('uwreq-tab-' + s); if (t) t.classList.add('uord-tab-active');
      renderW();
    };

    function filt(list, f) {
      if (f === 'all') return list;
      if (f === 'pending') return list.filter(function (o) { return ['pending', 'price_offered', 'client_counter'].indexOf(o.status) > -1; });
      if (f === 'accepted') return list.filter(function (o) { return ['accepted', 'worker_done_pending'].indexOf(o.status) > -1; });
      return list.filter(function (o) { return o.status === f; });
    }

    var EMPTY_C = { all: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0628\u0639\u062f', pending: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u062c\u062f\u064a\u062f\u0629', accepted: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0642\u0628\u0648\u0644\u0629', done: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0646\u062c\u0632\u0629', cancelled: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0644\u063a\u064a\u0629' };
    var EMPTY_W = { all: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0628\u0639\u062f', pending: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u062c\u062f\u064a\u062f\u0629', accepted: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0642\u0628\u0648\u0644\u0629', done: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0646\u062c\u0632\u0629' };

    function renderC() { var el = document.getElementById('uord-client-list'); if (!el) return; var l = filt(_co, _cf); el.innerHTML = l.length ? l.map(function (o) { return card(o, false); }).join('') : msg(EMPTY_C[_cf] || '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a'); }
    function renderW() { var el = document.getElementById('uord-worker-list'); if (!el) return; var l = filt(_wo, _wf); el.innerHTML = l.length ? l.map(function (o) { return card(o, true); }).join('') : msg(EMPTY_W[_wf] || '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a'); }

    var CM = { pending: ['badge-pending', '\u062c\u062f\u064a\u062f'], price_offered: ['badge-pending', '\u0639\u0631\u0636 \u0633\u0639\u0631'], client_counter: ['badge-pending', '\u0645\u0641\u0627\u0648\u0636\u0629'], accepted: ['badge-active', '\u0645\u0642\u0628\u0648\u0644'], worker_done_pending: ['badge-pending', '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u062a\u0623\u0643\u064a\u062f\u0643'], done: ['badge-done', '\u0645\u0646\u062c\u0632'], cancelled: ['badge-inactive', '\u0645\u0644\u063a\u064a'] };
    var WM = { pending: ['badge-pending', '\u062c\u062f\u064a\u062f'], price_offered: ['badge-pending', '\u0633\u0639\u0631 \u0645\u0642\u062a\u0631\u062d'], client_counter: ['badge-pending', '\u0639\u0645\u064a\u0644 \u0628\u064a\u0641\u0627\u0635\u0644'], accepted: ['badge-active', '\u0645\u0642\u0628\u0648\u0644'], worker_done_pending: ['badge-active', '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0639\u0645\u064a\u0644'], done: ['badge-done', '\u0645\u0646\u062c\u0632'], cancelled: ['badge-inactive', '\u0645\u0644\u063a\u064a'] };

    function safe(v) { return (v || '').replace(/'/g, ''); }

    function card(o, w) {
      var bm = (w ? WM : CM)[o.status] || ['badge-pending', o.status];
      var cls = bm[0], lbl = bm[1];
      var dt = o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }) : '';
      var num = safe(o.order_number);
      var extra = '';

      if (!w && o.status === 'worker_done_pending') {
        var st = safe(o.service_type);
        extra = '<div style="margin-top:10px;padding:10px;background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.3);border-radius:10px;">'
          + '<div style="font-size:13px;font-weight:800;color:#C8873A;margin-bottom:8px;">\u23f3 \u0627\u0644\u0635\u0646\u0627\u064a\u0639\u064a \u0642\u0627\u0644 \u0625\u0646 \u0627\u0644\u0634\u063a\u0644 \u062e\u0644\u0635 \u2014 \u0647\u0644 \u062a\u0623\u0643\u062f\u061f</div>'
          + '<div style="display:flex;gap:8px;">'
          + '<button onclick="event.stopPropagation();openConfirmDoneModal(\'' + num + '\',\'' + st + '\')" style="flex:1;padding:9px;background:rgba(30,132,73,0.2);border:1px solid rgba(30,132,73,0.4);border-radius:9px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">\u2705 \u0623\u064a\u0648\u0647\u060c \u062e\u0644\u0635</button>'
          + '<button onclick="event.stopPropagation();clientConfirmDone(false)" style="flex:1;padding:9px;background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.3);border-radius:9px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">\u274c \u0644\u0623\u060c \u0644\u0633\u0647</button>'
          + '</div></div>';
      } else if (!w && o.status === 'price_offered' && o.offered_price) {
        var priceNote = o.offered_price_note ? '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:3px;">📝 ' + o.offered_price_note + '</div>' : '';
        extra = '<div style="margin-top:10px;padding:12px;background:rgba(155,89,182,0.1);border:2px solid rgba(155,89,182,0.4);border-radius:12px;">'
          + '<div style="text-align:center;margin-bottom:10px;">'
          + '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:2px;">💰 عرض سعر من الصنايعي</div>'
          + '<div style="font-size:24px;font-weight:900;color:#9B59B6;">' + o.offered_price + ' جنيه</div>'
          + priceNote
          + '</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
          + '<button onclick="event.stopPropagation();clientAcceptPrice(\'' + num + '\')" style="flex:1;min-width:60px;padding:9px 4px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✓ موافق</button>'
          + '<button onclick="event.stopPropagation();openCounterOfferModal(\'' + num + '\',\'' + o.offered_price + '\')" style="flex:1;min-width:60px;padding:9px 4px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.45);border-radius:8px;color:#E67E22;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">🤝 فاصل</button>'
          + '<button onclick="event.stopPropagation();clientRejectPrice(\'' + num + '\')" style="flex:1;min-width:60px;padding:9px 4px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✗ رفض</button>'
          + '</div></div>';
      } else if (w && o.status === 'client_counter' && o.client_counter_price) {
        extra = '<div style="margin-top:10px;padding:10px;background:rgba(230,126,34,0.1);border:1px solid rgba(230,126,34,0.35);border-radius:10px;">'
          + '<div style="font-size:13px;font-weight:800;color:#E67E22;margin-bottom:8px;">\u0627\u0644\u0639\u0645\u064a\u0644 \u0639\u0631\u0636 ' + o.client_counter_price + ' \u062c\u0646\u064a\u0647</div>'
          + '<div style="display:flex;gap:8px;">'
          + '<button onclick="event.stopPropagation();workerAcceptCounter(\'' + num + '\')" style="flex:1;padding:9px;background:rgba(30,132,73,0.2);border:1px solid rgba(30,132,73,0.4);border-radius:9px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">\u2705 \u0642\u0628\u0648\u0644</button>'
          + '<button onclick="event.stopPropagation();openWorkerCounterModal(\'' + num + '\',' + o.client_counter_price + ')" style="flex:1;padding:9px;background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);border-radius:9px;color:#3498DB;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">\u21a9\ufe0f \u0641\u0627\u0635\u0644 \u0628\u0633\u0639\u0631 \u062a\u0627\u0646\u064a</button>'
          + '</div></div>';
      }

      var sub = w
        ? (o.client_name ? '<div style="font-size:12px;color:rgba(255,255,255,0.5);">\ud83d\udc64 ' + o.client_name + '</div>' : '')
        : (o.worker_name ? '<div style="font-size:12px;color:#C8873A;font-weight:700;">\ud83d\udd27 ' + o.worker_name + '</div>' : '');

      return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:16px;padding:16px 18px;cursor:pointer;" onclick="openRequestDetail(\'' + num + '\')">'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;">'
        + '<div style="flex:1;"><div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px;">' + (o.service_type || '\u062e\u062f\u0645\u0629') + '</div>'
        + '<div style="font-size:12px;color:rgba(255,255,255,0.4);">\ud83d\udccd ' + (o.address || o.area || '-') + ' \u00b7 ' + dt + '</div></div>'
        + '<span class="badge ' + cls + '" style="flex-shrink:0;">' + lbl + '</span></div>'
        + (o.desc ? '<div style="font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:10px;">' + o.desc.slice(0, 100) + (o.desc.length > 100 ? '\u2026' : '') + '</div>' : '')
        + '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'
        + '<div style="font-size:12px;color:rgba(255,255,255,0.35);"># ' + (o.order_number || '-') + '</div>' + sub
        + '</div>' + extra + '</div>';
    }
  })();
  // ==================== END UNIFIED ORDERS ====================