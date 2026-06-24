    // ==================== CLIENT MARKET JS ====================
    const CM_SERVICE_ICONS = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️', 'ألومنيوم': '🪟', 'سيراميك': '🏠', 'ميكانيكا': '🔧', 'حمامات': '🏊', 'أخرى': '🛠️' };
    function cmServiceIcon(s) { for (const k of Object.keys(CM_SERVICE_ICONS)) { if (s && s.includes(k)) return CM_SERVICE_ICONS[k]; } return '🛠️'; }

    let cmMarketListener = null, cmMineListener = null;
    let cmAllMarket = {}, cmAllMine = {};
    let cmMarketFilter = 'all', cmMineFilter = 'all';
    let cmCurrentTab = 'market';

    // ---- SHOW/HIDE MARKET ELEMENTS IN NAV/SIDEBAR ----
    function cmShowNavElements() {
      const role = currentProfile?.role;
      // nav dropdown
      const marketLink = document.getElementById('nav-market-link');
      if (marketLink) marketLink.style.display = role ? 'block' : 'none';
      // sidebar
      const siMarket = document.getElementById('si-market');
      if (siMarket) siMarket.style.display = role ? 'flex' : 'none';

      // ===== MOBILE NAV: 5 أزرار ثابتة حسب الـ role =====
      const mbMarket   = document.getElementById('mbnav-market');
      const mbWallet   = document.getElementById('mbnav-wallet');
      const mbGuide    = document.getElementById('mbnav-guide');
      const mbCraftsmen = document.getElementById('mbnav-craftsmen');
      const mbOrders   = document.getElementById('mbnav-orders');

      if (role === 'worker') {
        // صنايعي: الرئيسية | السوق | 🛠️اطلب | محفظتي | حسابي
        if (mbMarket)    mbMarket.style.display    = 'flex';
        if (mbWallet)    mbWallet.style.display    = 'flex';
        if (mbGuide)     mbGuide.style.display     = 'none';
        if (mbCraftsmen) mbCraftsmen.style.display = 'none';
        if (mbOrders)    mbOrders.style.display    = 'none';
      } else {
        // عميل: الرئيسية | طلباتي | 🛠️اطلب | الصنايعية | حسابي
        if (mbMarket)    mbMarket.style.display    = 'none';
        if (mbWallet)    mbWallet.style.display    = 'none';
        if (mbGuide)     mbGuide.style.display     = 'none';
        if (mbCraftsmen) mbCraftsmen.style.display = 'flex';
        if (mbOrders)    mbOrders.style.display    = 'flex';
      }

      // worker-only: show "عروضي" tab, hide "طلباتي" tab
      const tabMine = document.getElementById('cmt-mine');
      const tabMyOffers = document.getElementById('cmt-myoffers');
      if (role === 'worker') {
        if (tabMine) tabMine.style.display = 'none';
        if (tabMyOffers) tabMyOffers.style.display = '';
      } else {
        if (tabMine) tabMine.style.display = '';
        if (tabMyOffers) tabMyOffers.style.display = 'none';
      }
    }

    // Hook into existing auth state — run after profile loads
    const _origUpdateNavLoggedIn = window.updateNavForLoggedIn;
    window.updateNavForLoggedIn = function () {
      if (_origUpdateNavLoggedIn) _origUpdateNavLoggedIn.apply(this, arguments);
      setTimeout(cmShowNavElements, 200);
      cmLoadMarket();
      if (currentUser) cmLoadMine();
      if (currentUser && currentProfile?.role === 'worker') setTimeout(cmLoadMyOffers, 300);
    };

    // Also run on page load if already logged in
    setTimeout(() => {
      cmLoadMarket();
      cmShowNavElements();
      if (currentUser) cmLoadMine();
      if (currentUser && currentProfile?.role === 'worker') cmLoadMyOffers();
    }, 1200);

    // ---- TAB SWITCH ----
    function cmSwitchTab(tab) {
      cmCurrentTab = tab;
      ['market', 'mine', 'post', 'myoffers'].forEach(t => {
        const v = document.getElementById('cmv-' + t);
        const b = document.getElementById('cmt-' + t);
        if (v) v.style.display = t === tab ? 'block' : 'none';
        if (b) b.classList.toggle('active', t === tab);
      });
      if (tab === 'mine') {
        if (!currentUser) { showAuthPage('login'); return; }
        cmRenderMine();
        if (typeof markMarketNotifsRead === 'function') markMarketNotifsRead();
      }
      if (tab === 'myoffers') {
        if (!currentUser) { showAuthPage('login'); return; }
        cmLoadMyOffers();
        if (typeof markMarketNotifsRead === 'function') markMarketNotifsRead();
      }
      if (tab === 'post' && !currentUser) { showAuthPage('login'); return; }
    }
    window.cmSwitchTab = cmSwitchTab;
    window.cmShowNavElements = cmShowNavElements;
    window.cmLoadMarket = cmLoadMarket;
    window.cmLoadMine = cmLoadMine;
    window.cmFilterMarket = cmFilterMarket;
    window.cmFilterMine = cmFilterMine;

    // ---- LOAD MARKET ----
    function cmLoadMarket() {
      if (cmMarketListener) cmMarketListener();
      cmMarketListener = onValue(ref(db, 'client_requests'), (snap) => {
        cmAllMarket = {};
        if (snap.exists()) Object.entries(snap.val()).forEach(([id, r]) => { cmAllMarket[id] = { ...r, id }; });
        cmRenderMarket();
      });
    }

    function cmFilterMarket(cat, btn) {
      cmMarketFilter = cat;
      document.querySelectorAll('#cm-market-filters .cm-filter').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      cmRenderMarket();
    }
    window.cmFilterMarket = cmFilterMarket;

    function cmRenderMarket() {
      const el = document.getElementById('cm-market-list');
      if (!el) return;
      let reqs = Object.values(cmAllMarket).filter(r => r.status === 'open');
      if (cmMarketFilter !== 'all') reqs = reqs.filter(r => r.service && r.service.includes(cmMarketFilter));
      reqs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (!reqs.length) {
        el.innerHTML = '<div class="cm-empty"><div class="cm-empty-icon">🔍</div><div class="cm-empty-title">مفيش طلبات مفتوحة دلوقتي</div><div class="cm-empty-sub">ارجع بعد شوية أو انشر طلبك!</div></div>';
        return;
      }
      const isWorker = currentProfile?.role === 'worker';
      el.innerHTML = reqs.map(r => {
        const offersCount = r.offers ? Object.keys(r.offers).length : 0;
        const alreadyOffered = isWorker && r.offers && Object.values(r.offers).some(o => o.worker_id === currentUser?.uid);
        const isOwner = r.user_id === currentUser?.uid;
        return `<div class="cm-card">
        <div class="cm-card-top">
          <div class="cm-icon">${cmServiceIcon(r.service)}</div>
          <div class="cm-info">
            <div class="cm-title">${r.title || 'طلب خدمة'}</div>
            <div class="cm-meta">
              <span>📍 ${r.area || '-'}</span>
              <span>📅 ${cmFormatDate(r.created_at)}</span>
              ${r.budget ? `<span>💰 ${r.budget}</span>` : ''}
              ${r.timing ? `<span>⏰ ${r.timing}</span>` : ''}
            </div>
          </div>
        </div>
        ${r.desc ? `<div class="cm-desc">${r.desc}</div>` : ''}
        <div class="cm-footer">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
            <span class="cm-status open">🟢 مفتوح</span>
            ${offersCount > 0 ? `<span class="cm-offers-count">💼 ${offersCount} عرض</span>` : ''}
          </div>
          <div style="display:flex;gap:7px;">
            <button class="cm-detail-btn" onclick="cmOpenDetail('${r.id}')">🔍 تفاصيل</button>
            ${isWorker && !isOwner ? `<button class="cm-offer-btn" onclick="cmOpenOfferModal('${r.id}')" ${alreadyOffered ? 'disabled' : ''}>${alreadyOffered ? '✅ عرضت' : '💰 ابعت عرض'}</button>` : ''}
          </div>
        </div>
      </div>`;
      }).join('');
    }

    // ---- LOAD MINE ----
    function cmLoadMine() {
      if (!currentUser) return;
      if (cmMineListener) cmMineListener();
      cmMineListener = onValue(ref(db, 'client_requests'), (snap) => {
        cmAllMine = {};
        if (snap.exists()) Object.entries(snap.val()).forEach(([id, r]) => { if (r.user_id === currentUser.uid) cmAllMine[id] = { ...r, id }; });
        // badge
        const withOffers = Object.values(cmAllMine).filter(r => r.offers && Object.keys(r.offers).length > 0 && r.status === 'open').length;
        const badge = document.getElementById('cmt-mine-badge');
        if (badge) { badge.textContent = withOffers || ''; badge.classList.toggle('show', withOffers > 0); }
        // nav badge
        const navBadge = document.getElementById('nav-market-badge');
        if (navBadge) { navBadge.textContent = withOffers || ''; navBadge.style.display = withOffers > 0 ? 'inline' : 'none'; }
        // sidebar badge
        const sbBadge = document.getElementById('si-market-badge');
        if (sbBadge) { sbBadge.textContent = withOffers || ''; sbBadge.className = 'si-badge' + (withOffers > 0 ? ' show' : ''); }
        // mobile badge
        const mbBadge = document.getElementById('mbnav-market-badge');
        if (mbBadge) { mbBadge.textContent = withOffers || ''; mbBadge.className = 'm-badge' + (withOffers > 0 ? ' show' : ''); }
        if (cmCurrentTab === 'mine') cmRenderMine();
      });
    }

    function cmFilterMine(f, btn) {
      cmMineFilter = f;
      document.querySelectorAll('#cmv-mine .cm-filter').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      cmRenderMine();
    }
    window.cmFilterMine = cmFilterMine;

    function cmRenderMine() {
      const el = document.getElementById('cm-mine-list');
      if (!el) return;
      let reqs = Object.values(cmAllMine);
      if (cmMineFilter === 'open') reqs = reqs.filter(r => r.status === 'open');
      else if (cmMineFilter === 'has_offers') reqs = reqs.filter(r => r.offers && Object.keys(r.offers).length > 0 && r.status === 'open');
      else if (cmMineFilter === 'accepted') reqs = reqs.filter(r => ['accepted', 'pending_client_confirm', 'client_done_pending'].includes(r.status));
      else if (cmMineFilter === 'done') reqs = reqs.filter(r => r.status === 'done' || r.status === 'cancelled');
      reqs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (!reqs.length) {
        el.innerHTML = `<div class="cm-empty"><div class="cm-empty-icon">📋</div><div class="cm-empty-title">مفيش طلبات هنا</div><div class="cm-empty-sub">انشر طلبك وهيتواصل معاك الصنايعية</div><button class="submit-btn" style="max-width:200px;margin:1rem auto 0;" onclick="cmSwitchTab('post')">+ انشر طلبك</button></div>`;
        return;
      }
      el.innerHTML = reqs.map(r => {
        const offers = r.offers ? Object.entries(r.offers) : [];
        const newOffers = offers.filter(([, o]) => !o.rejected).length;
        const isPendingConfirm = r.status === 'pending_client_confirm';
        const isClientDonePending = r.status === 'client_done_pending';
        const acceptedOffer = offers.find(([oid]) => oid === r.accepted_offer_id);
        const statusLabel =
          r.status === 'pending_admin' ? '<span class="cm-status" style="background:rgba(243,156,18,0.12);color:#F39C12;border:1px solid rgba(243,156,18,0.35);padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">⏳ جديد</span>' :
          r.status === 'open' ? '<span class="cm-status open">🟢 مفتوح</span>' :
            r.status === 'accepted' ? '<span class="cm-status accepted">🔄 مقبول — جاري التنفيذ</span>' :
              isPendingConfirm ? '<span class="cm-status" style="background:rgba(200,135,58,0.2);color:#C8873A;border:1px solid rgba(200,135,58,0.4);padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">⏳ بانتظار تأكيدك</span>' :
                isClientDonePending ? '<span class="cm-status" style="background:rgba(46,204,113,0.12);color:#27AE60;border:1px solid rgba(46,204,113,0.35);padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">⏳ بانتظار تأكيد الصنايعي</span>' :
                  r.status === 'done' ? '<span class="cm-status done">✅ منتهي</span>' :
                    '<span class="cm-status cancelled">❌ ملغي</span>';
        const validOffers = offers.filter(([, o]) => !o.rejected);
        // بانر تأكيد الإنهاء
        const confirmBanner = isPendingConfirm && acceptedOffer ? `
        <div style="background:rgba(200,135,58,0.12);border:2px solid rgba(200,135,58,0.5);border-radius:12px;padding:14px;margin-top:12px;">
          <div style="font-size:14px;font-weight:900;color:#C8873A;margin-bottom:8px;">⏳ الصنايعي قال إن الشغل خلص — هل تأكد؟</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="cmClientConfirmMarketDone('${r.id}','${r.accepted_offer_id}')" style="flex:1;padding:10px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:9px;color:#2ECC71;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✅ أيوه، خلص</button>
            <button onclick="cmClientDispute('${r.id}')" style="flex:1;padding:10px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:9px;color:#E74C3C;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">❌ لأ، مش خلص</button>
          </div>
        </div>` : '';
        const offersHtml = validOffers.length > 0 ? `
        <div style="margin-top:11px;border-top:1px solid rgba(255,255,255,0.06);padding-top:11px;">
          <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:7px;">💼 العروض الواردة (${validOffers.length})</div>
          ${validOffers.map(([oid, o]) => cmRenderOfferItem(r, oid, o)).join('')}
        </div>` : '';
        return `<div class="cm-card" style="${isPendingConfirm ? 'border-color:rgba(200,135,58,0.4);' : ''}">
        <div class="cm-card-top">
          <div class="cm-icon">${cmServiceIcon(r.service)}</div>
          <div class="cm-info">
            <div class="cm-title">${r.title || 'طلب خدمة'}</div>
            <div class="cm-meta">
              <span>📍 ${r.area || '-'}</span>
              <span>📅 ${cmFormatDate(r.created_at)}</span>
              ${r.budget ? `<span>💰 ${r.budget}</span>` : ''}
            </div>
          </div>
        </div>
        ${r.desc ? `<div class="cm-desc">${r.desc}</div>` : ''}
        <div class="cm-footer">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${statusLabel}
            ${newOffers > 0 && r.status === 'open' ? `<span style="color:#E74C3C;font-size:12px;font-weight:800;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);padding:3px 10px;border-radius:20px;">🔔 ${newOffers} عرض جديد!</span>` : ''}
          </div>
          ${(r.status === 'open' || r.status === 'pending_admin') ? `<button class="cm-btn-reject" style="font-size:11px;padding:5px 11px;" onclick="cmCancelRequest('${r.id}')">إلغاء الطلب</button>` : ''}
        </div>
        ${confirmBanner}
        ${offersHtml}
      </div>`;
      }).join('');
    }

    function cmRenderOfferItem(req, oid, offer) {
      const isAccepted = req.status === 'accepted' && req.accepted_offer_id === oid;
      const canAct = req.status === 'open';
      return `<div class="cm-offer-item${isAccepted ? ' accepted-offer' : ''}">
      <div class="cm-offer-worker">
        <div class="cm-offer-avatar">${cmServiceIcon(offer.worker_trade)}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;">${offer.worker_name || 'صنايعي'}</div>
          <div style="font-size:11px;color:var(--gold);">${offer.worker_trade || ''}</div>
        </div>
        ${isAccepted ? '<span style="font-size:11px;color:#2ECC71;font-weight:700;">✅ تم القبول</span>' : ''}
      </div>
      <div class="cm-offer-price">${offer.price} جنيه</div>
      ${offer.client_counter_price && offer.counter_status === 'pending' ? `<div style="font-size:12px;font-weight:700;color:#E67E22;background:rgba(230,126,34,0.1);border:1px solid rgba(230,126,34,0.3);border-radius:8px;padding:6px 10px;margin:6px 0;">🤝 عرضك: ${offer.client_counter_price} جنيه — بانتظار رد الصنايعي</div>` : ''}
      ${offer.counter_status === 'worker_counter' && offer.worker_counter_price ? `<div style="background:rgba(52,152,219,0.1);border:2px solid rgba(52,152,219,0.45);border-radius:12px;padding:12px;margin:8px 0;">
        <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">↩️ الصنايعي رد بسعر جديد</div>
        <div style="font-size:22px;font-weight:900;color:#3498DB;margin-bottom:6px;">${offer.worker_counter_price} جنيه</div>
        ${offer.worker_counter_note ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.04);padding:6px 9px;border-radius:7px;margin-bottom:8px;">"${offer.worker_counter_note}"</div>` : ''}
        <div style="display:flex;gap:8px;">
          <button onclick="cmAcceptOffer('${req.id}','${oid}','${offer.worker_id}','${offer.worker_counter_price}')" style="flex:1;padding:9px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:9px;color:#2ECC71;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✅ قبول ${offer.worker_counter_price} جنيه</button>
          <button onclick="cmOpenCounterModal('${req.id}','${oid}','${offer.worker_id}','${offer.worker_counter_price}','${(offer.worker_name || 'صنايعي').replace(/'/g, "\\'")}')\" style=\"flex:1;padding:9px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.45);border-radius:9px;color:#E67E22;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;\">🤝 فاصل تاني</button>
        </div>
      </div>`: ''}
      ${offer.counter_status === 'accepted' ? `<div style="font-size:12px;font-weight:700;color:#2ECC71;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);border-radius:8px;padding:6px 10px;margin:6px 0;">✅ الصنايعي وافق على سعرك — اقبل العرض!</div>` : ''}
      ${offer.note ? `<div class="cm-offer-note">${offer.note}</div>` : ''}
      <div class="cm-offer-actions">
        ${canAct && offer.counter_status !== 'worker_counter' ? `<button class="cm-btn-accept" onclick="cmAcceptOffer('${req.id}','${oid}','${offer.worker_id}','${offer.price}')">✅ قبول</button>
                  <button class="cm-btn-counter" onclick="cmOpenCounterModal('${req.id}','${oid}','${offer.worker_id}','${offer.price}','${(offer.worker_name || 'صنايعي').replace(/'/g, "\\'")}')">🤝 فاصل</button>
                  <button class="cm-btn-reject" onclick="cmRejectOffer('${req.id}','${oid}','${offer.worker_id}')">❌ رفض</button>` : ''}
        ${(isAccepted && req.status !== 'done' && req.status !== 'cancelled') ? `<button class="cm-btn-chat" onclick="openChatModal('${offer.worker_id}',{role:'worker',full_name:'${(offer.worker_name || 'صنايعي').replace(/'/g, '&apos;')}',phone:'${offer.worker_phone || ''}'})">💬 شات</button>` : ''}
        ${isAccepted && req.status === 'accepted' ? `<button onclick="cmClientConfirmMarketDone('${req.id}','${oid}')" style="padding:7px 14px;border-radius:8px;border:1px solid rgba(46,204,113,0.4);background:rgba(46,204,113,0.12);color:#2ECC71;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">🏁 الشغل خلص</button>` : ''}
      </div>
    </div>`;
    }

    // ---- POST REQUEST ----
    async function cmSubmitRequest() {
      if (!currentUser) { showAuthPage('login'); return; }
      const service = document.getElementById('cm-post-service').value;
      const title = document.getElementById('cm-post-title').value.trim();
      const desc = document.getElementById('cm-post-desc').value.trim();
      const area = document.getElementById('cm-post-area').value;
      const timing = document.getElementById('cm-post-timing').value;
      const details = collectProfessionExtraFields('cm-extra-fields', service);
      if (!service || !title || !desc || !area) { showToast('⚠️ اكمل الحقول المطلوبة: الخدمة والعنوان والوصف والمنطقة'); return; }
      // ✅ لو الخدمة المختارة ليها حقول تفاصيل (زي نوع الشغل/المقاس/إلخ)، لازم تتملى — علشان الصنايعي ميستلمش طلب فاضي من التفاصيل
      const _cmKey = cleanProfessionName(service);
      const _cmCfg = PROFESSION_DETAILS_CONFIG[_cmKey];
      if (_cmCfg && _cmCfg.fields && _cmCfg.fields.length && !details) {
        showToast('⚠️ اكمل تفاصيل "' + _cmKey + '" اللي ظهرت تحت اختيار نوع الخدمة — ده اللي بيخلي الصنايعي يقدر يحدد السعر صح');
        return;
      }
      const btn = document.getElementById('cm-submit-req-btn');
      btn.disabled = true; btn.textContent = 'جاري النشر...';
      try {
        const ts = Date.now();
        const reqId = 'CR' + ts;
        const serviceClean = service.replace(/^[^\u0600-\u06FF\w]+/, '').trim();
        // جمع الصور المرفوعة
        const images = window.cmUploadedImages || [];
        await set(ref(db, 'client_requests/' + reqId), {
          user_id: currentUser.uid,
          user_name: currentProfile?.full_name || 'عميل',
          user_phone: currentProfile?.phone || '',
          service: serviceClean, title, desc, area,
          budget: null, timing: timing || null, details: details || null,
          images: images.length > 0 ? images : null,
          // الطلب بيتنشر مباشرة في السوق بدون مراجعة الإدارة
          status: 'open', created_at: new Date().toISOString()
        });
        document.getElementById('cm-req-num').textContent = 'رقم الطلب: ' + reqId;
        document.getElementById('cm-post-form-wrap').style.display = 'none';
        document.getElementById('cm-post-success').style.display = 'block';
        showToast('✅ تم نشر طلبك!');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ، حاول تاني'); }
      finally { btn.disabled = false; btn.innerHTML = '<span>📢</span> نشر الطلب'; }
    }
    window.cmSubmitRequest = cmSubmitRequest;

    function cmResetPost() {
      ['cm-post-service', 'cm-post-title', 'cm-post-desc', 'cm-post-area', 'cm-post-timing']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      clearProfessionExtraFields('cm-extra-fields');
      updateDescPlaceholder('cm-post-desc', '');
      window.cmUploadedImages = [];
      document.getElementById('cm-images-preview').innerHTML = '';
      document.getElementById('cm-post-images').value = '';
      document.getElementById('cm-post-form-wrap').style.display = 'block';
      document.getElementById('cm-post-success').style.display = 'none';
    }
    window.cmResetPost = cmResetPost;

    // ---- OFFER MODAL ----
    async function cmOpenOfferModal(reqId) {
      if (!currentUser) { showAuthPage('login'); return; }
      if (currentProfile?.role !== 'worker') { showToast('⚠️ بس الصنايعي يقدر يبعت عرض — تأكد إن حسابك مسجّل كـ صنايعي'); return; }

      // تحقق من تطابق المهنة في السوق
      const req = cmAllMarket[reqId];
      if (req && currentProfile?.trade) {
        const cleanReqService = (req.service || '').replace(/^[^ء-ي٠-٩a-zA-Z]+/, '').trim();
        const cleanWorkerTrade = (currentProfile.trade || '').replace(/^[^ء-ي٠-٩a-zA-Z]+/, '').trim();
        if (cleanReqService && cleanWorkerTrade && !cleanReqService.includes(cleanWorkerTrade) && !cleanWorkerTrade.includes(cleanReqService)) {
          showToast('⛔ الطلب ده مش تخصصك (' + cleanReqService + ') — بس اعرض على طلبات ' + cleanWorkerTrade, '#E74C3C');
          return;
        }
      }
      document.getElementById('cm-offer-req-id').value = reqId;
      document.getElementById('cm-offer-price').value = '';
      document.getElementById('cm-offer-note').value = '';
      document.getElementById('cm-offer-summary').innerHTML = req
        ? `<strong>${req.title}</strong><br><span style="font-size:11px;color:rgba(255,255,255,0.45);">📍 ${req.area} | ${req.service}</span>` +
          (req.details && Object.keys(req.details).length ? `<div style="margin-top:8px;">${formatProfessionDetailsHTML(req.details)}</div>` : '')
        : '';

      // ✅ اجلب حالة العروض وأظهر البانر المناسب
      const promoBanner = document.getElementById('cm-offer-promo-banner');
      if (promoBanner) {
        promoBanner.style.display = 'none';
        try {
          const now = Date.now();
          const [wSnap, promosSnap] = await Promise.all([
            get(walletRef(currentUser.uid)),
            get(ref(db, 'promos'))
          ]);
          const completed = wSnap.exists() ? (wSnap.val().completed_orders || 0) : 0;
          let bannerMsg = null;

          if (promosSnap.exists()) {
            const promosData = promosSnap.val();
            let activePromo = null;
            Object.values(promosData).forEach(p => {
              if (p.active && new Date(p.start_at) <= now && new Date(p.end_at) >= now) {
                activePromo = p;
              }
            });
            if (activePromo) {
              const remaining = Math.ceil((new Date(activePromo.end_at) - now) / (1000 * 60 * 60 * 24));
              bannerMsg = '🌟 ' + activePromo.name + ' — عمولة ' + activePromo.rate + '% فقط! (متبقي ' + remaining + ' يوم)';
            }
          }

          if (bannerMsg) {
            promoBanner.textContent = bannerMsg;
            promoBanner.style.display = 'block';
          }
        } catch (e) { /* silent */ }
      }

      document.getElementById('cm-offer-modal').classList.add('show');
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.getElementById('cm-offer-price').focus(), 200);
    }
    window.cmOpenOfferModal = cmOpenOfferModal;

    function cmCloseOfferModal() { document.getElementById('cm-offer-modal').classList.remove('show'); document.body.style.overflow = ''; }
    window.cmCloseOfferModal = cmCloseOfferModal;

    // ---- CLIENT COUNTER OFFER (فاصل في السوق) ----
    function cmOpenCounterModal(reqId, offerId, workerId, currentPrice, workerName) {
      if (!currentUser) { showAuthPage('login'); return; }
      document.getElementById('cm-counter-req-id').value = reqId;
      document.getElementById('cm-counter-offer-id').value = offerId;
      document.getElementById('cm-counter-worker-id').value = workerId;
      document.getElementById('cm-counter-price').value = '';
      document.getElementById('cm-counter-note').value = '';
      document.getElementById('cm-counter-summary').innerHTML =
        `<strong>${workerName}</strong> عرض <strong style="color:var(--gold);">${currentPrice} جنيه</strong><br>
       <span style="font-size:12px;color:rgba(255,255,255,0.45);">اكتب سعرك المقترح عشان يوافق أو يرفض</span>`;
      const modal = document.getElementById('cm-counter-modal');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.getElementById('cm-counter-price').focus(), 200);
    }
    window.cmOpenCounterModal = cmOpenCounterModal;

    function cmCloseCounterModal() {
      document.getElementById('cm-counter-modal').style.display = 'none';
      document.body.style.overflow = '';
    }
    window.cmCloseCounterModal = cmCloseCounterModal;

    async function cmSubmitCounter() {
      const reqId = document.getElementById('cm-counter-req-id').value;
      const offerId = document.getElementById('cm-counter-offer-id').value;
      const workerId = document.getElementById('cm-counter-worker-id').value;
      const price = parseInt(document.getElementById('cm-counter-price').value);
      const note = document.getElementById('cm-counter-note').value.trim();
      if (!price || price <= 0) { showToast('⚠️ اكتب سعر صحيح'); return; }
      const btn = document.getElementById('cm-submit-counter-btn');
      btn.disabled = true; btn.textContent = 'جاري الإرسال...';
      try {
        // خزّن عرض العميل على الأوفر
        await update(ref(db, 'client_requests/' + reqId + '/offers/' + offerId), {
          client_counter_price: price,
          client_counter_note: note || null,
          counter_status: 'pending'
        });
        // إشعار الصنايعي
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        const rd = reqSnap.exists() ? reqSnap.val() : {};
        await push(ref(db, 'notifications/' + workerId), {
          type: 'cm_client_counter', title: '🤝 العميل بيفاصل في السعر!',
          body: (currentProfile?.full_name || 'العميل') + ' عرض ' + price + ' جنيه بدل عرضك لطلب: ' + (rd.title || reqId) + ' — وافق أو رد من شات السوق.',
          req_id: reqId, offer_id: offerId, read: false, created_at: new Date().toISOString()
        });
        // رسالة شات تلقائية للصنايعي
        const chatId = [currentUser.uid, workerId].sort().join('_');
        await push(ref(db, 'chats/' + chatId + '/messages'), {
          from: currentUser.uid,
          text: '🤝 بفاصل معاك في طلب السوق: "' + (rd.title || reqId) + '"\nعرضي: ' + price + ' جنيه' + (note ? '\nملاحظة: ' + note : '') + '\n\nوافق من الإشعارات أو ردّ بسعر جديد.',
          timestamp: Date.now()
        });
        cmCloseCounterModal();
        showToast('✅ تم إرسال عرضك للصنايعي!');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ، حاول تاني'); }
      finally { btn.disabled = false; btn.innerHTML = '<span>🤝</span> إرسال عرضي للصنايعي'; }
    }
    window.cmSubmitCounter = cmSubmitCounter;

    // الصنايعي يوافق على عرض العميل في السوق
    async function cmWorkerAcceptCounter(reqId, offerId, clientId, counterPrice) {
      try {
        await update(ref(db, 'client_requests/' + reqId + '/offers/' + offerId), {
          price: counterPrice,
          client_counter_price: null,
          counter_status: 'accepted'
        });
        await push(ref(db, 'notifications/' + clientId), {
          type: 'cm_counter_accepted', title: '✅ الصنايعي وافق على سعرك!',
          body: 'الصنايعي قبل عرضك بـ ' + counterPrice + ' جنيه — افتح الطلب وقبّل العرض.',
          req_id: reqId, read: false, created_at: new Date().toISOString()
        });
        showToast('✅ وافقت على سعر العميل!');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmWorkerAcceptCounter = cmWorkerAcceptCounter;

    // ---- رفض مفاوضة العميل (الصنايعي يرفض العرض المضاد) ----
    async function cmWorkerRejectCounter(reqId, offerId) {
      if (!confirm('⚠️ هترفض مفاوضة العميل وهيبقى العرض الأصلي؟ متأكد؟')) return;
      try {
        await update(ref(db, 'client_requests/' + reqId + '/offers/' + offerId), {
          client_counter_price: null,
          counter_status: 'rejected'
        });
        showToast('تم رفض المفاوضة — عرضك الأصلي لازال قائم', '#E67E22');
        cmLoadMyOffers();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmWorkerRejectCounter = cmWorkerRejectCounter;

    // ---- الصنايعي يفتح مودال المفاوضة رداً على العميل ----
    function cmWorkerOpenCounterModal(reqId, offerId, clientId, clientPrice) {
      document.getElementById('cm-worker-counter-req-id').value = reqId;
      document.getElementById('cm-worker-counter-offer-id').value = offerId;
      document.getElementById('cm-worker-counter-client-id').value = clientId;
      document.getElementById('cm-worker-counter-price').value = '';
      document.getElementById('cm-worker-counter-note').value = '';
      document.getElementById('cm-worker-counter-summary').innerHTML =
        `العميل اقترح <strong style="color:#E67E22;">${clientPrice} جنيه</strong> — اكتب سعرك المضاد وهنبعتهوله فوراً.`;
      const modal = document.getElementById('cm-worker-counter-modal');
      modal.style.display = 'flex';
      setTimeout(() => document.getElementById('cm-worker-counter-price').focus(), 100);
    }
    window.cmWorkerOpenCounterModal = cmWorkerOpenCounterModal;

    function cmCloseWorkerCounterModal() {
      document.getElementById('cm-worker-counter-modal').style.display = 'none';
    }
    window.cmCloseWorkerCounterModal = cmCloseWorkerCounterModal;

    async function cmSubmitWorkerCounter() {
      const reqId = document.getElementById('cm-worker-counter-req-id').value;
      const offerId = document.getElementById('cm-worker-counter-offer-id').value;
      const clientId = document.getElementById('cm-worker-counter-client-id').value;
      const price = parseInt(document.getElementById('cm-worker-counter-price').value);
      const note = document.getElementById('cm-worker-counter-note').value.trim();
      if (!price || price <= 0) { showToast('⚠️ اكتب سعر صحيح'); return; }
      const btn = document.getElementById('cm-submit-worker-counter-btn');
      btn.disabled = true; btn.textContent = 'جاري الإرسال...';
      try {
        await update(ref(db, 'client_requests/' + reqId + '/offers/' + offerId), {
          worker_counter_price: price,
          worker_counter_note: note || null,
          client_counter_price: null,
          counter_status: 'worker_counter'
        });
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        const rd = reqSnap.exists() ? reqSnap.val() : {};
        await push(ref(db, 'notifications/' + clientId), {
          type: 'cm_worker_counter', title: '↩️ الصنايعي بيفاصل في السعر!',
          body: (currentProfile?.full_name || 'الصنايعي') + ' عرض ' + price + ' جنيه — افتح طلبك وشوف العرض الجديد.',
          req_id: reqId, offer_id: offerId, read: false, created_at: new Date().toISOString()
        });
        const chatId = [currentUser.uid, clientId].sort().join('_');
        await push(ref(db, 'chats/' + chatId + '/messages'), {
          from: currentUser.uid,
          text: '↩️ بفاصل معاك في طلب: "' + (rd.title || reqId) + '"\nعرضي: ' + price + ' جنيه' + (note ? '\nملاحظة: ' + note : '') + '\n\nوافق أو رد بسعر جديد.',
          timestamp: Date.now()
        });
        cmCloseWorkerCounterModal();
        showToast('✅ تم إرسال عرضك للعميل!');
        cmLoadMyOffers();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ، حاول تاني'); }
      finally { btn.disabled = false; btn.innerHTML = '<span>↩️</span> إرسال عرضي للعميل'; }
    }
    window.cmSubmitWorkerCounter = cmSubmitWorkerCounter;

    // ---- الصنايعي يعلن إنهاء الشغل (بيطلب تأكيد من العميل) ----
    async function cmWorkerMarkDone(reqId, offerId) {
      if (!confirm('🏁 هتعلن إن الشغل خلص وبتطلب تأكيد من العميل؟')) return;
      try {
        await update(ref(db, 'client_requests/' + reqId), {
          status: 'pending_client_confirm',
          done_requested_at: new Date().toISOString()
        });
        // إشعار العميل
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        if (reqSnap.exists()) {
          const rd = reqSnap.val();
          if (rd.user_id) {
            await push(ref(db, 'notifications/' + rd.user_id), {
              type: 'cm_worker_done', title: '🏁 الصنايعي قال إن الشغل خلص!',
              body: 'أكد إن الشغل خلص عشان تقفل الطلب.',
              req_id: reqId, read: false, created_at: new Date().toISOString()
            });
          }
        }
        showToast('✅ طلبت تأكيد من العميل');
        cmLoadMyOffers();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmWorkerMarkDone = cmWorkerMarkDone;

    // ---- العميل يعلن إن الشغل خلص (بيسأل الصنايعي أول) ----
    async function cmClientConfirmMarketDone(reqId, offerId) {
      if (!confirm('🏁 هتبعت للصنايعي إن الشغل خلص عشان يأكد — متأكد؟')) return;
      try {
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        if (!reqSnap.exists()) return;
        const rd = reqSnap.val();
        // غيّر الحالة لـ client_done_pending (بانتظار تأكيد الصنايعي)
        await update(ref(db, 'client_requests/' + reqId), {
          status: 'client_done_pending',
          client_done_requested_at: new Date().toISOString()
        });
        // ابعت إشعار للصنايعي يأكد
        const workerId = rd.accepted_worker_id || (rd.offers && offerId && rd.offers[offerId]?.worker_id);
        if (workerId) {
          await push(ref(db, 'notifications/' + workerId), {
            type: 'cm_client_says_done', title: '🏁 العميل قال إن الشغل خلص!',
            body: 'العميل أعلن إنهاء طلب: "' + (rd.title || 'طلب خدمة') + '" — أكّد إنك فعلاً خلّصت.',
            req_id: reqId, offer_id: offerId || null, read: false, created_at: new Date().toISOString()
          });
        }
        showToast('✅ تم إبلاغ الصنايعي — بينتظر تأكيده', '#C8873A');
        cmLoadMine && cmLoadMine();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmClientConfirmMarketDone = cmClientConfirmMarketDone;

    // ---- العميل يرفض إنهاء الشغل (لسه مخلصش) ----
    async function cmClientDispute(reqId) {
      try {
        await update(ref(db, 'client_requests/' + reqId), {
          status: 'accepted',
          done_requested_at: null
        });
        // إشعار الصنايعي
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        if (reqSnap.exists()) {
          const rd = reqSnap.val();
          const workerId = rd.accepted_worker_id;
          if (workerId) {
            await push(ref(db, 'notifications/' + workerId), {
              type: 'cm_dispute', title: '⚠️ العميل قال إن الشغل لسه مخلصش',
              body: 'العميل رفض تأكيد الإنهاء للطلب: ' + (rd.title || 'طلب خدمة'),
              req_id: reqId, read: false, created_at: new Date().toISOString()
            });
          }
        }
        showToast('⚠️ أبلغنا الصنايعي — الطلب رجع لحالة مقبول', '#E67E22');
        cmLoadMine && cmLoadMine();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmClientDispute = cmClientDispute;

    // ---- الصنايعي يؤكد إن الشغل خلص (بعد ما العميل يقول خلص) ----
    async function cmWorkerConfirmClientDone(reqId) {
      if (!confirm('✅ هتأكد إن الشغل خلص فعلاً وتقفل الطلب؟')) return;
      try {
        await update(ref(db, 'client_requests/' + reqId), { status: 'done', done_at: new Date().toISOString() });
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        if (reqSnap.exists()) {
          const rd = reqSnap.val();
          if (rd.user_id) {
            await push(ref(db, 'notifications/' + rd.user_id), {
              type: 'cm_done_confirmed', title: '✅ الصنايعي أكّد إن الشغل خلص!',
              body: 'تم إغلاق طلب: "' + (rd.title || 'طلب خدمة') + '" بنجاح.',
              req_id: reqId, read: false, created_at: new Date().toISOString()
            });
          }
          // خصم عمولة من محفظة الصنايعي — لو الإدارة حددت مبلغ يدوي يتخصم، وإلا يتحسب تلقائي
          try {
            const workerUid = rd.accepted_worker_id;
            const finalOffer = rd.accepted_offer_id && rd.offers ? rd.offers[rd.accepted_offer_id] : null;
            const price = parseFloat(finalOffer?.price || 0);
            if (workerUid && price > 0 && typeof window.getEffectiveCommission === 'function') {
              const wSnap = await get(walletRef(workerUid));
              const wData = wSnap.exists() ? wSnap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
              const promoResult = await window.getEffectiveCommission(workerUid, price, wData.completed_orders || 0, undefined, typeof rd.commission_amount === 'number' ? rd.commission_amount : undefined);
              const totalCommission = promoResult.commission;
              const currentBal = wData.balance || 0;
              const existingDebt = wData.pending_commission_debt || 0;
              const deductNow = Math.min(currentBal, totalCommission);
              const debtToAdd = totalCommission - deductNow;
              const newBal = currentBal - deductNow;
              const newDed = (wData.total_deducted || 0) + deductNow;
              const newDebt = existingDebt + debtToAdd;
              const completed = (wData.completed_orders || 0) + 1;
              await set(walletRef(workerUid), { ...wData, balance: newBal, total_deducted: newDed, completed_orders: completed, pending_commission_debt: newDebt });
              await update(ref(db, 'craftsmen/' + workerUid), { available: newBal > 0 });
              await push(walletTxnRef(workerUid), {
                type: 'commission', amount: totalCommission,
                deducted_now: deductNow, debt_added: debtToAdd,
                description: 'عمولة طلب سوق #' + reqId + ' (' + (rd.service || '') + ')',
                order_num: reqId, rate: promoResult.rate, order_price: price,
                promo: promoResult.promo || null, created_at: new Date().toISOString()
              });
              let notifBody = 'طلب #' + reqId + ' — ' + price + ' ج × ' + (promoResult.rate * 100).toFixed(0) + '% = ' + totalCommission + ' ج.';
              notifBody += deductNow < totalCommission
                ? ('\nتم خصم ' + deductNow + ' ج الآن — باقي ' + debtToAdd + ' ج هيتخصم لما تشحن 💳')
                : (' رصيدك: ' + newBal + ' ج');
              await push(ref(db, 'notifications/' + workerUid), {
                type: debtToAdd > 0 ? 'wallet_partial_deduction' : 'wallet_deduction',
                title: deductNow < totalCommission ? '⚠️ عمولة جزئية — في باقي عليك' : '💳 تم خصم عمولة من محفظتك',
                body: notifBody,
                read: false, created_at: new Date().toISOString()
              });
            }
          } catch (commErr) { console.error('Commission deduction error (market):', commErr); }
        }
        showToast('✅ تم إغلاق الطلب بنجاح!', '#27AE60');
        cmLoadMyOffers && cmLoadMyOffers();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmWorkerConfirmClientDone = cmWorkerConfirmClientDone;

    // ---- الصنايعي يرفض تأكيد العميل (لسه مخلصش) ----
    async function cmWorkerDenyClientDone(reqId) {
      try {
        await update(ref(db, 'client_requests/' + reqId), { status: 'accepted', client_done_requested_at: null });
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        if (reqSnap.exists()) {
          const rd = reqSnap.val();
          if (rd.user_id) {
            await push(ref(db, 'notifications/' + rd.user_id), {
              type: 'cm_worker_not_done', title: '⚠️ الصنايعي قال إنه لسه مخلصش',
              body: 'الطلب: "' + (rd.title || 'طلب خدمة') + '" رجع لحالة مقبول — هيتواصل معاك.',
              req_id: reqId, read: false, created_at: new Date().toISOString()
            });
          }
        }
        showToast('⚠️ أبلغنا العميل — الطلب رجع لحالة مقبول', '#E67E22');
        cmLoadMyOffers && cmLoadMyOffers();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.cmWorkerDenyClientDone = cmWorkerDenyClientDone;

    // ---- END CLIENT COUNTER OFFER ----

    async function cmSubmitOffer() {
      const reqId = document.getElementById('cm-offer-req-id').value;
      const price = parseInt(document.getElementById('cm-offer-price').value);
      const note = document.getElementById('cm-offer-note').value.trim();
      if (!price || price <= 0) { showToast('⚠️ اكتب سعر صحيح'); return; }

      // ✅ قفل الزرار فوراً قبل أي عملية async — يمنع تكرار العرض لو المستخدم دبس مرتين بسرعة (مشكلة الطلب اللي بيتكرر مرتين)
      const btn = document.getElementById('cm-submit-offer-btn');
      if (btn.disabled) return; // حماية إضافية لو الدالة اتنادت تاني وهي شغالة
      btn.disabled = true; btn.textContent = 'جاري الإرسال...';

      // ✅ تحقق من الرصيد — لازم يكون عنده أي رصيد > 0
      if (currentUser) {
        try {
          const wSnap = await get(walletRef(currentUser.uid));
          const wData = wSnap.exists() ? wSnap.val() : {};
          const bal = wData.balance || 0;
          const completedOrders = wData.completed_orders || 0;
          const pendingDebt = wData.pending_commission_debt || 0;
          if (bal <= 0 && completedOrders > 0) {
            showToast('❌ رصيدك صفر — اشحن محفظتك الأول 💳', '#E74C3C');
            btn.disabled = false; btn.innerHTML = '<span>💰</span> إرسال العرض';
            return;
          }
          if (pendingDebt > 0) {
            const ok = confirm('⚠️ تنبيه: عندك عمولة متأخرة ' + pendingDebt + ' ج من طلبات سابقة.\nهتتخصم أوتوماتيك من رصيدك بعد إتمام هذا الطلب.\nهتكمل؟');
            if (!ok) { btn.disabled = false; btn.innerHTML = '<span>💰</span> إرسال العرض'; return; }
          }
        } catch (e) { console.error('wallet check:', e); }
      }

      try {
        const offerRef = push(ref(db, 'client_requests/' + reqId + '/offers'));
        await set(offerRef, {
          worker_id: currentUser.uid,
          worker_name: currentProfile?.full_name || 'صنايعي',
          worker_trade: currentProfile?.trade || '',
          worker_phone: currentProfile?.phone || '',
          price, note: note || null, created_at: new Date().toISOString()
        });
        // إشعار صاحب الطلب
        const reqSnap = await get(ref(db, 'client_requests/' + reqId));
        if (reqSnap.exists() && reqSnap.val().user_id) {
          const rd = reqSnap.val();
          await push(ref(db, 'notifications/' + rd.user_id), {
            type: 'new_offer', title: '💰 وصلك عرض سعر جديد!',
            body: (currentProfile?.full_name || 'صنايعي') + ' بعتلك عرض بـ ' + price + ' جنيه لطلبك: ' + rd.title,
            req_id: reqId, read: false, created_at: new Date().toISOString()
          });
        }
        cmCloseOfferModal();
        showToast('✅ تم إرسال عرضك للعميل!');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
      finally { btn.disabled = false; btn.innerHTML = '<span>💰</span> إرسال العرض'; }
    }
    window.cmSubmitOffer = cmSubmitOffer;

    // ---- ACCEPT / REJECT OFFER ----
    let _cmAcceptInFlight = new Set();
    async function cmAcceptOffer(reqId, offerId, workerId, price) {
      const flightKey = reqId + '_' + offerId;
      if (_cmAcceptInFlight.has(flightKey)) return; // منع التنفيذ المزدوج لو المستخدم دبس "قبول" مرتين بسرعة
      if (typeof window.getBusyWorkerIds === 'function') {
        try {
          const busyMap = await window.getBusyWorkerIds();
          if (busyMap.has(workerId)) {
            showToast('🔴 الصنايعي ده مشغول بطلب تاني دلوقتي، استنى لما يخلصه أو اختار صنايعي تاني');
            return;
          }
        } catch (e) { console.error('busy check error:', e); }
      }
      if (!confirm('هتقبل عرض السعر ده؟ (' + price + ' جنيه)')) return;
      _cmAcceptInFlight.add(flightKey);
      try {
        await update(ref(db, 'client_requests/' + reqId), { status: 'accepted', accepted_offer_id: offerId, accepted_worker_id: workerId });
        await update(ref(db, 'client_requests/' + reqId + '/offers/' + offerId), {
          price: price,
          worker_counter_price: null,
          worker_counter_note: null,
          client_counter_price: null,
          counter_status: null
        });
        // إشعار الصنايعي
        await push(ref(db, 'notifications/' + workerId), {
          type: 'offer_accepted', title: '✅ العميل قبل عرضك!',
          body: (currentProfile?.full_name || 'العميل') + ' قبل عرضك بـ ' + price + ' جنيه — تواصل معاه دلوقتي 🙏',
          req_id: reqId, read: false, created_at: new Date().toISOString()
        });
        // شات تلقائي
        const chatId = [currentUser.uid, workerId].sort().join('_');
        await push(ref(db, 'chats/' + chatId + '/messages'), {
          from: currentUser.uid,
          text: '✅ قبلت عرضك (' + price + ' جنيه) — أهلاً بيك! 🙏',
          timestamp: Date.now()
        });
        showToast('✅ تم قبول العرض!');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
      finally { _cmAcceptInFlight.delete(flightKey); }
    }
    window.cmAcceptOffer = cmAcceptOffer;

    async function cmRejectOffer(reqId, offerId, workerId) {
      if (!confirm('هترفض العرض ده؟')) return;
      try {
        await update(ref(db, 'client_requests/' + reqId + '/offers/' + offerId), { rejected: true });
        await push(ref(db, 'notifications/' + workerId), {
          type: 'offer_rejected', title: '❌ تم رفض عرضك',
          body: (currentProfile?.full_name || 'العميل') + ' رفض عرضك — جرب تبعت عرض جديد.',
          req_id: reqId, read: false, created_at: new Date().toISOString()
        });
        showToast('تم رفض العرض');
      } catch (e) { console.error(e); }
    }
    window.cmRejectOffer = cmRejectOffer;

    async function cmCancelRequest(reqId) {
      if (!confirm('هتلغي الطلب ده؟')) return;
      try {
        await update(ref(db, 'client_requests/' + reqId), { status: 'cancelled' });
        showToast('تم إلغاء الطلب');
      } catch (e) { console.error(e); }
    }
    window.cmCancelRequest = cmCancelRequest;

    // ---- DETAIL MODAL ----
    async function cmOpenDetail(reqId) {
      document.getElementById('cm-detail-modal').classList.add('show');
      document.body.style.overflow = 'hidden';
      const snap = await get(ref(db, 'client_requests/' + reqId));
      if (!snap.exists()) { document.getElementById('cm-detail-body').textContent = 'مفيش تفاصيل'; return; }
      const r = snap.val(); r.id = reqId;
      const offers = r.offers ? Object.entries(r.offers).filter(([, o]) => !o.rejected) : [];
      const isWorker = currentProfile?.role === 'worker';
      const alreadyOffered = isWorker && offers.some(([, o]) => o.worker_id === currentUser?.uid);
      document.getElementById('cm-detail-title').textContent = r.title || 'تفاصيل الطلب';
      document.getElementById('cm-detail-body').innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;">
        <div class="cm-icon" style="width:48px;height:48px;flex-shrink:0;">${cmServiceIcon(r.service)}</div>
        <div>
          <div style="font-size:16px;font-weight:800;">${r.title}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:3px;">📍 ${r.area} | ${r.service}</div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.03);border-radius:9px;padding:11px 13px;border-right:3px solid rgba(200,135,58,0.28);font-size:13px;color:rgba(255,255,255,0.62);line-height:1.7;margin-bottom:13px;">${r.desc || 'لا يوجد وصف'}</div>
      ${r.details && Object.keys(r.details).length ? `<div style="background:rgba(255,255,255,0.03);border-radius:9px;padding:11px 13px;margin-bottom:13px;">
        <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:4px;">📋 تفاصيل ${r.service || 'الخدمة'}</div>
        ${formatProfessionDetailsHTML(r.details)}
      </div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:9px;margin-bottom:13px;font-size:12px;">
        ${r.budget ? `<span style="background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.25);padding:4px 12px;border-radius:20px;color:var(--gold);">💰 ${r.budget}</span>` : ''}
        ${r.timing ? `<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:4px 12px;border-radius:20px;">⏰ ${r.timing}</span>` : ''}
        <span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:4px 12px;border-radius:20px;">📅 ${cmFormatDate(r.created_at)}</span>
      </div>
      ${r.images && r.images.length > 0 ? `<div style="margin-bottom:13px;">
        <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.45);margin-bottom:7px;">📸 صور توضيحية (${r.images.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;">
          ${r.images.map(src => `<img src="${src}" onclick="GLB.open('${src}')" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:1.5px solid rgba(200,135,58,0.35);cursor:pointer;" title="اضغط للتكبير">`).join('')}
        </div>
      </div>`: ''}
      ${isWorker && r.status === 'open' ? `<button class="cm-offer-btn" style="width:100%;padding:12px;margin-bottom:13px;" onclick="cmCloseDetailModal();cmOpenOfferModal('${reqId}')" ${alreadyOffered ? 'disabled' : ''}>
        ${alreadyOffered ? '✅ بعتت عرضك قبل كده' : '💰 ابعت عرض سعر للعميل'}
      </button>`: ''}
      ${offers.length > 0 ? `<div style="font-size:13px;font-weight:700;color:var(--gold);margin-bottom:8px;">💼 العروض المستلمة (${offers.length})</div>
      ${offers.map(([, o]) => `<div class="cm-offer-item" style="margin-bottom:8px;">
        <div class="cm-offer-worker">
          <div class="cm-offer-avatar">${cmServiceIcon(o.worker_trade)}</div>
          <div><div style="font-size:13px;font-weight:700;">${o.worker_name}</div><div style="font-size:11px;color:var(--gold);">${o.worker_trade || ''}</div></div>
        </div>
        <div class="cm-offer-price">${o.price} جنيه</div>
        ${o.note ? `<div class="cm-offer-note">${o.note}</div>` : ''}
      </div>`).join('')}` : ''}
    `;
    }
    window.cmOpenDetail = cmOpenDetail;

    function cmCloseDetailModal() { document.getElementById('cm-detail-modal').classList.remove('show'); document.body.style.overflow = ''; }
    window.cmCloseDetailModal = cmCloseDetailModal;

    // ---- MOBILE NAV FOR MARKET ----
    function mobileNavMarket() {
      if (!currentUser) { showAuthPage('login'); return; }
      showPage('client-market');
      cmSwitchTab('market');
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById('mbnav-market')?.classList.add('active');
    }
    window.mobileNavMarket = mobileNavMarket;

    // ---- UTILS ----
    function cmFormatDate(iso) {
      if (!iso) return '-';
      try {
        const d = new Date(iso), now = new Date(), diff = Math.floor((now - d) / 1000);
        if (diff < 60) return 'الآن';
        if (diff < 3600) return Math.floor(diff / 60) + ' د';
        if (diff < 86400) return Math.floor(diff / 3600) + ' س';
        if (diff < 604800) return Math.floor(diff / 86400) + ' يوم';
        return d.toLocaleDateString('ar-EG');
      } catch { return '-'; }
    }
    // ---- IMAGE UPLOAD ----
    window.cmUploadedImages = [];
    function cmHandleImages(input) {
      const files = Array.from(input.files).slice(0, 4);
      const preview = document.getElementById('cm-images-preview');
      window.cmUploadedImages = [];
      preview.innerHTML = '';
      files.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = e => {
          window.cmUploadedImages.push(e.target.result);
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:relative;width:80px;height:80px;border-radius:10px;overflow:hidden;border:1.5px solid rgba(200,135,58,0.4);';
          wrap.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">
          <button onclick="cmRemoveImage(${i})" style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>`;
          wrap.id = 'cm-img-wrap-' + i;
          preview.appendChild(wrap);
        };
        reader.readAsDataURL(file);
      });
      // تحديث المنطقة
      const area = document.getElementById('cm-image-upload-area');
      if (files.length > 0) area.style.borderColor = 'rgba(200,135,58,0.7)';
    }
    window.cmHandleImages = cmHandleImages;

    function cmRemoveImage(idx) {
      window.cmUploadedImages.splice(idx, 1);
      // FIX #8: إعادة رسم كل الصور بعد الحذف عشان الـ indices تتطابق مع الـ array
      const preview = document.getElementById('cm-images-preview');
      if (!preview) return;
      preview.innerHTML = '';
      (window.cmUploadedImages || []).forEach((src, i) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:80px;height:80px;border-radius:10px;overflow:hidden;flex-shrink:0;';
        wrap.id = 'cm-img-wrap-' + i;
        wrap.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">` +
          `<button onclick="cmRemoveImage(${i})" style="position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>`;
        preview.appendChild(wrap);
      });
      const area = document.getElementById('cm-image-upload-area');
      if (area) area.style.display = (window.cmUploadedImages.length < 4) ? 'block' : 'none';
    }
    window.cmRemoveImage = cmRemoveImage;

    // ---- MY OFFERS (للصنايعي يشوف عروضه في السوق) ----
    let cmMyOffersListener = null;
    let cmAllMyOffers = []; // [{req, offerId, offer}]
    let cmMyOffersFilter = 'all';

    function cmLoadMyOffers() {
      if (!currentUser) return;
      const el = document.getElementById('cm-myoffers-list');
      if (el) el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:3rem;">جاري التحميل...</p>';
      if (cmMyOffersListener) { cmMyOffersListener(); cmMyOffersListener = null; }
      cmMyOffersListener = onValue(ref(db, 'client_requests'), snap => {
        cmAllMyOffers = [];
        if (snap.exists()) {
          Object.entries(snap.val()).forEach(([reqId, req]) => {
            if (req.offers) {
              Object.entries(req.offers).forEach(([oid, offer]) => {
                if (offer.worker_id === currentUser.uid) {
                  cmAllMyOffers.push({ req: { ...req, id: reqId }, offerId: oid, offer });
                }
              });
            }
          });
        }
        cmAllMyOffers.sort((a, b) => (b.offer.created_at || '').localeCompare(a.offer.created_at || ''));
        // update badge
        const pending = cmAllMyOffers.filter(x => !x.offer.rejected && x.req.status !== 'done' && x.req.status !== 'cancelled' && x.req.accepted_offer_id !== x.offerId).length;
        const badge = document.getElementById('cmt-myoffers-badge');
        if (badge) { badge.textContent = pending || ''; badge.classList.toggle('show', pending > 0); }
        if (cmCurrentTab === 'myoffers') cmRenderMyOffers();
      });
    }

    function cmFilterMyOffers(f, btn) {
      cmMyOffersFilter = f;
      document.querySelectorAll('#cm-myoffers-filters .cm-filter').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      cmRenderMyOffers();
    }
    window.cmFilterMyOffers = cmFilterMyOffers;

    function cmRenderMyOffers() {
      const el = document.getElementById('cm-myoffers-list');
      if (!el) return;
      let list = [...cmAllMyOffers];
      if (cmMyOffersFilter === 'pending') list = list.filter(x => !x.offer.rejected && x.req.status === 'open' && x.req.accepted_offer_id !== x.offerId);
      else if (cmMyOffersFilter === 'accepted') list = list.filter(x => x.req.accepted_offer_id === x.offerId || (x.req.accepted_worker_id === currentUser.uid && ['accepted', 'pending_client_confirm', 'client_done_pending'].includes(x.req.status)));
      else if (cmMyOffersFilter === 'rejected') list = list.filter(x => x.offer.rejected === true);
      if (!list.length) {
        const msgs = { all: 'مبعتتش أي عروض لحد دلوقتي', pending: 'مفيش عروض بانتظار الرد', accepted: 'مفيش عروض مقبولة', rejected: 'مفيش عروض مرفوضة' };
        el.innerHTML = `<div class="cm-empty"><div class="cm-empty-icon">💼</div><div class="cm-empty-title">${msgs[cmMyOffersFilter] || 'مفيش عروض'}</div><div class="cm-empty-sub">روح لكل الطلبات وابعت عرض جديد</div><button class="submit-btn" style="max-width:200px;margin:1rem auto 0;" onclick="cmSwitchTab('market')">🏪 اشوف الطلبات</button></div>`;
        return;
      }
      el.innerHTML = list.map(({ req, offerId, offer }) => {
        const isAccepted = req.accepted_offer_id === offerId || (req.accepted_worker_id === currentUser.uid && ['accepted', 'pending_client_confirm', 'client_done_pending'].includes(req.status));
        const isRejected = offer.rejected === true;
        const isPending = !isAccepted && !isRejected && req.status === 'open';
        const reqStatus = (isAccepted || req.accepted_worker_id === currentUser?.uid) && req.status === 'pending_client_confirm' ? '<span class="cm-status" style="background:rgba(200,135,58,0.2);color:#C8873A;border:1px solid rgba(200,135,58,0.4);padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">⏳ بانتظار تأكيد العميل</span>'
          : (isAccepted || req.accepted_worker_id === currentUser?.uid) && req.status === 'client_done_pending' ? '<span class="cm-status" style="background:rgba(46,204,113,0.15);color:#2ECC71;border:1px solid rgba(46,204,113,0.4);padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">🏁 العميل قال خلص — أكّد؟</span>'
            : isAccepted ? '<span class="cm-status accepted">✅ قبل عرضك!</span>'
              : isRejected ? '<span class="cm-status cancelled">❌ رُفض</span>'
                : req.status === 'done' ? '<span class="cm-status done">✅ منتهي</span>'
                  : req.status === 'cancelled' ? '<span class="cm-status cancelled">ملغي</span>'
                    : '<span class="cm-status open">⏳ بانتظار رد العميل</span>';
        // counter offer from client
        const counterHtml = offer.client_counter_price && offer.counter_status === 'pending'
          ? `<div style="background:rgba(230,126,34,0.12);border:2px solid rgba(230,126,34,0.45);border-radius:12px;padding:13px;margin:8px 0;">
            <div style="font-size:14px;font-weight:900;color:#E67E22;margin-bottom:4px;">🤝 العميل بيفاصل</div>
            <div style="font-size:22px;font-weight:900;color:#fff;margin-bottom:6px;">${offer.client_counter_price} <span style="font-size:13px;color:rgba(255,255,255,0.5);">جنيه</span></div>
            ${offer.client_counter_note ? `<div style="color:rgba(255,255,255,0.55);font-size:12px;background:rgba(255,255,255,0.04);padding:7px 10px;border-radius:8px;margin-bottom:10px;">"${offer.client_counter_note}"</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="cm-btn-accept" style="flex:1;" onclick="cmWorkerAcceptCounter('${req.id}','${offerId}','${req.user_id}','${offer.client_counter_price}')">✅ قبول ${offer.client_counter_price} جنيه</button>
              <button onclick="cmWorkerOpenCounterModal('${req.id}','${offerId}','${req.user_id}',${offer.client_counter_price})" style="flex:1;padding:9px;background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);border-radius:9px;color:#3498DB;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">↩️ فاصل بسعر تاني</button>
            </div>
          </div>`
          : offer.counter_status === 'accepted' ? `<div style="font-size:12px;color:#2ECC71;font-weight:700;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.3);border-radius:8px;padding:6px 10px;margin:6px 0;">✅ وافقت على سعر العميل (${offer.client_counter_price} جنيه)</div>`
            : offer.counter_status === 'rejected' ? `<div style="font-size:12px;color:#E74C3C;font-weight:700;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:8px;padding:6px 10px;margin:6px 0;">❌ رفضت مفاوضة العميل — العرض الأصلي: ${offer.price} جنيه</div>` : '';
        const workerName = (req.user_name || 'العميل').replace(/'/g, '&apos;');
        return `<div class="cm-card" style="${isAccepted ? 'border-color:rgba(46,204,113,0.35);background:rgba(46,204,113,0.04);' : ''}">
        <div class="cm-card-top">
          <div class="cm-icon">${cmServiceIcon(req.service)}</div>
          <div class="cm-info">
            <div class="cm-title">${req.title || 'طلب خدمة'}</div>
            <div class="cm-meta">
              <span>📍 ${req.area || '-'}</span>
              <span>📅 ${cmFormatDate(offer.created_at)}</span>
              <span>👤 ${req.user_name || 'عميل'}</span>
            </div>
          </div>
        </div>
        <div style="background:rgba(200,135,58,0.08);border:1px solid rgba(200,135,58,0.2);border-radius:10px;padding:10px 13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:2px;">عرضك</div>
            <div style="font-size:20px;font-weight:900;color:var(--gold);">${offer.price} جنيه</div>
          </div>
          ${reqStatus}
        </div>
        ${offer.note ? `<div class="cm-desc" style="margin-bottom:10px;">${offer.note}</div>` : ''}
        ${counterHtml}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${(isAccepted && req.status !== 'done' && req.status !== 'cancelled') ? `<button class="cm-btn-chat" style="flex:1;justify-content:center;display:flex;align-items:center;gap:6px;" onclick="openChatModal('${req.user_id}',{role:'client',full_name:'${workerName}',phone:'${req.user_phone || ''}'})">💬 شات مع العميل</button>` : ''}
          ${isAccepted && req.status === 'accepted' ? `<button onclick="cmWorkerMarkDone('${req.id}','${offerId}')" style="flex:1;padding:9px;background:rgba(200,135,58,0.18);border:1px solid rgba(200,135,58,0.45);border-radius:9px;color:#C8873A;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">🏁 الشغل خلص — طلب تأكيد</button>` : ''}
          ${(isAccepted || req.accepted_worker_id === currentUser?.uid) && req.status === 'pending_client_confirm' ? `<div style="background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.3);border-radius:9px;padding:9px;text-align:center;font-size:12px;color:#C8873A;font-weight:700;">⏳ في انتظار تأكيد العميل...</div>` : ''}
          ${(isAccepted || req.accepted_worker_id === currentUser?.uid) && req.status === 'client_done_pending' ? `<div style="background:rgba(46,204,113,0.08);border:2px solid rgba(46,204,113,0.4);border-radius:10px;padding:12px;width:100%;">
            <div style="text-align:center;font-size:13px;font-weight:800;color:#2ECC71;margin-bottom:10px;">🏁 العميل قال إن الشغل خلص — هل فعلاً خلّصت؟</div>
            <div style="display:flex;gap:8px;">
              <button onclick="cmWorkerConfirmClientDone('${req.id}')" style="flex:1;padding:9px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:9px;color:#2ECC71;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✅ أيوه، خلّصت</button>
              <button onclick="cmWorkerDenyClientDone('${req.id}')" style="flex:1;padding:9px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.4);border-radius:9px;color:#E74C3C;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;">❌ لأ، لسه</button>
            </div>
          </div>`: ''}
        </div>
      </div>`;
      }).join('');
    }

    window.cmLoadMyOffers = cmLoadMyOffers;
    window.cmRenderMyOffers = cmRenderMyOffers;

    // ==================== END CLIENT MARKET JS ====================


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
      if (f === 'pending') return list.filter(function (o) { return ['pending_admin', 'pending', 'price_offered', 'client_counter'].indexOf(o.status) > -1; });
      if (f === 'accepted') return list.filter(function (o) { return ['accepted', 'worker_done_pending'].indexOf(o.status) > -1; });
      return list.filter(function (o) { return o.status === f; });
    }

    var EMPTY_C = { all: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0628\u0639\u062f', pending: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u062c\u062f\u064a\u062f\u0629', accepted: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0642\u0628\u0648\u0644\u0629', done: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0646\u062c\u0632\u0629', cancelled: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0644\u063a\u064a\u0629' };
    var EMPTY_W = { all: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0628\u0639\u062f', pending: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u062c\u062f\u064a\u062f\u0629', accepted: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0642\u0628\u0648\u0644\u0629', done: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a \u0645\u0646\u062c\u0632\u0629' };

    function renderC() { var el = document.getElementById('uord-client-list'); if (!el) return; var l = filt(_co, _cf); el.innerHTML = l.length ? l.map(function (o) { return card(o, false); }).join('') : msg(EMPTY_C[_cf] || '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a'); }
    function renderW() { var el = document.getElementById('uord-worker-list'); if (!el) return; var l = filt(_wo, _wf); el.innerHTML = l.length ? l.map(function (o) { return card(o, true); }).join('') : msg(EMPTY_W[_wf] || '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a'); }

    var CM = { pending_admin: ['badge-pending', '🕓 قيد مراجعة الإدارة'], pending: ['badge-pending', '\u062c\u062f\u064a\u062f'], price_offered: ['badge-pending', '\u0639\u0631\u0636 \u0633\u0639\u0631'], client_counter: ['badge-pending', '\u0645\u0641\u0627\u0648\u0636\u0629'], accepted: ['badge-active', '\u0645\u0642\u0628\u0648\u0644'], worker_done_pending: ['badge-pending', '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u062a\u0623\u0643\u064a\u062f\u0643'], done: ['badge-done', '\u0645\u0646\u062c\u0632'], cancelled: ['badge-inactive', '\u0645\u0644\u063a\u064a'] };
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
          + '<button onclick="event.stopPropagation();clientConfirmDone(false,\'' + num + '\')" style="flex:1;padding:9px;background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.3);border-radius:9px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">\u274c \u0644\u0623\u060c \u0644\u0633\u0647</button>'
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
