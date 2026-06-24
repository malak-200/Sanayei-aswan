    // ===== RATING SYSTEM =====
    let _ratingContext = null; // { type, orderNum }
    let _selectedStars = 0;
    const starLabels = ['', 'ضعيف جداً 😕', 'ضعيف 😐', 'كويس 🙂', 'كويس جداً 😊', 'ممتاز! 🤩'];

    function openRatingModal(type, orderNum) {
      _ratingContext = { type, orderNum };
      _selectedStars = 0;
      document.getElementById('rating-comment').value = '';
      document.getElementById('rating-star-label').textContent = '';
      document.querySelectorAll('.rating-star').forEach(s => s.classList.remove('active'));
      const isWorker = type === 'client_rates_worker';
      document.getElementById('rating-modal-emoji').textContent = isWorker ? '🔧' : '👤';
      document.getElementById('rating-modal-title').textContent = isWorker ? 'قيّم الصنايعي' : 'قيّم العميل';
      document.getElementById('rating-modal-sub').textContent = isWorker ? 'إزاي كانت خدمة الصنايعي؟' : 'إزاي كان تعامل العميل؟';
      document.getElementById('rating-modal').style.display = 'flex';
    }
    window.openRatingModal = openRatingModal;

    function closeRatingModal() {
      document.getElementById('rating-modal').style.display = 'none';
      _ratingContext = null;
    }
    window.closeRatingModal = closeRatingModal;

    function setRatingStar(n) {
      _selectedStars = n;
      document.querySelectorAll('.rating-star').forEach((s, i) => {
        s.classList.toggle('active', i < n);
      });
      document.getElementById('rating-star-label').textContent = starLabels[n] || '';
    }
    window.setRatingStar = setRatingStar;

    async function submitRating() {
      if (!_ratingContext) return;
      if (_selectedStars === 0) { alert('من فضلك اختار عدد النجوم'); return; }
      const btn = document.getElementById('rating-submit-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
      try {
        const { type, orderNum } = _ratingContext;
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (!snap.exists()) { closeRatingModal(); return; }
        const order = snap.val();
        const comment = document.getElementById('rating-comment').value.trim();
        const ratingData = { stars: _selectedStars, comment, order_num: orderNum, created_at: new Date().toISOString() };

        if (type === 'client_rates_worker' && order.worker_id) {
          // سجّل التقييم في ملف الصنايعي
          await push(ref(db, 'craftsmen/' + order.worker_id + '/ratings_list'), {
            ...ratingData, from: currentUser?.uid || 'guest', from_name: order.client_name || 'عميل'
          });
          // احسب المتوسط الجديد
          const rSnap = await get(ref(db, 'craftsmen/' + order.worker_id + '/ratings_list'));
          if (rSnap.exists()) {
            const list = Object.values(rSnap.val());
            const avg = list.reduce((a, r) => a + r.stars, 0) / list.length;
            await update(ref(db, 'craftsmen/' + order.worker_id), { rating: +avg.toFixed(1), reviews: list.length });
          }
          // علّم الطلب كأن العميل قيّم
          await update(ref(db, 'service_requests/' + orderNum), { client_rated: true });
          // ابعت إشعار للصنايعي
          await push(ref(db, 'notifications/' + order.worker_id), {
            type: 'new_rating', title: 'حصلت على تقييم جديد ⭐',
            body: (order.client_name || 'عميل') + ' قيّمك بـ ' + _selectedStars + ' نجوم',
            read: false, created_at: new Date().toISOString()
          });
          // بعد تقييم الصنايعي — اعرض للصنايعي يقيّم العميل
          if (order.worker_id && currentUser) {
            const alreadyRated = order.worker_rated;
            if (!alreadyRated) {
              // إشعار للصنايعي إنه يقيّم العميل
              await push(ref(db, 'notifications/' + order.worker_id), {
                type: 'rate_client', title: 'قيّم العميل 📝',
                body: 'قيّم ' + (order.client_name || 'العميل') + ' على طلب ' + orderNum,
                order_num: orderNum, read: false, created_at: new Date().toISOString()
              });
            }
          }
        } else if (type === 'worker_rates_client' && order.user_id) {
          // تقييم الصنايعي للعميل
          await push(ref(db, 'profiles/' + order.user_id + '/ratings_list'), {
            ...ratingData, from: currentUser?.uid || 'worker', from_name: currentProfile?.full_name || 'صنايعي'
          });
          // احسب متوسط تقييم العميل
          const rSnap = await get(ref(db, 'profiles/' + order.user_id + '/ratings_list'));
          if (rSnap.exists()) {
            const list = Object.values(rSnap.val());
            const avg = list.reduce((a, r) => a + r.stars, 0) / list.length;
            await update(ref(db, 'profiles/' + order.user_id), { avg_rating: +avg.toFixed(1), rating_count: list.length });
          }
          await update(ref(db, 'service_requests/' + orderNum), { worker_rated: true });
          // إشعار للعميل
          await push(ref(db, 'notifications/' + order.user_id), {
            type: 'new_rating', title: 'حصلت على تقييم من الصنايعي ⭐',
            body: (currentProfile?.full_name || 'الصنايعي') + ' قيّمك بـ ' + _selectedStars + ' نجوم',
            read: false, created_at: new Date().toISOString()
          });
          // لو العميل مفتوح صفحة البروفايل بتاعته، حدّث التعليقات
          loadClientRatings();
        }
        closeRatingModal();
        showToast('تم إرسال تقييمك بنجاح! ⭐');
        loadClientOrders();
      } catch (e) {
        alert('حصل خطأ في إرسال التقييم');
      } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-star"></i> إرسال التقييم';
      }
    }
    window.submitRating = submitRating;

    // ===== TOAST (عام — للعمليات) =====
    function showToast(msg, color) {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:' + (color || '#1E8449') + ';color:#fff;padding:12px 24px;border-radius:12px;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);white-space:nowrap;transition:opacity 0.3s;';
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
    }
    window.showToast = showToast;

    // ===== NOTIFICATION TOAST (فوق يسار — للإشعارات) =====
    let _notifToastOffset = 0;
    function showNotifToast(icon, title, body, accentColor) {
      const color = accentColor || '#C8873A';
      const id = 'ntoast_' + Date.now();
      const top = 20 + _notifToastOffset;
      _notifToastOffset += 90;

      const el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed',
        'top:' + top + 'px',
        'left:20px',
        'width:320px',
        'max-width:calc(100vw - 40px)',
        'background:rgba(28,26,23,0.97)',
        'border:1px solid ' + color + '55',
        'border-left:4px solid ' + color,
        'border-radius:14px',
        'padding:14px 16px',
        'z-index:99999',
        'box-shadow:0 8px 32px rgba(0,0,0,0.55)',
        'display:flex',
        'align-items:flex-start',
        'gap:12px',
        'font-family:Cairo,sans-serif',
        'direction:rtl',
        'transform:translateX(-360px)',
        'opacity:0',
        'transition:transform 0.35s cubic-bezier(0.22,1,0.36,1),opacity 0.35s'
      ].join(';');

      el.innerHTML =
        '<div style="font-size:26px;flex-shrink:0;line-height:1;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + title + '</div>' +
        (body ? '<div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + body + '</div>' : '') +
        '</div>' +
        '<button onclick="document.getElementById(\'' + id + '\')?.remove()" style="background:none;border:none;color:rgba(255,255,255,0.3);font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;margin-top:1px;">✕</button>';

      document.body.appendChild(el);

      // Slide in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transform = 'translateX(0)';
          el.style.opacity = '1';
        });
      });

      // Auto dismiss
      setTimeout(() => {
        el.style.transform = 'translateX(-360px)';
        el.style.opacity = '0';
        setTimeout(() => { el.remove(); _notifToastOffset = Math.max(0, _notifToastOffset - 90); }, 380);
      }, 5000);
    }
    window.showNotifToast = showNotifToast;

    // ألوان حسب النوع
    function notifAccentColor(type) {
      const map = {
        worker_accepted: '#2ECC71', counter_accepted: '#2ECC71', order_done: '#27AE60',
        price_offered: '#9B59B6', client_counter: '#E67E22',
        price_rejected: '#E74C3C', done_rejected: '#E74C3C', order_update: '#E74C3C',
        confirm_done: '#C8873A', new_rating: '#F1C40F',
        admin_reply: '#3498DB', new_message: '#3498DB',
        worker_not_done_yet: '#E67E22', client_says_done: '#2ECC71',
        cm_client_says_done: '#2ECC71', new_offer: '#9B59B6',
        cm_client_counter: '#E67E22', cm_counter_accepted: '#2ECC71', cm_worker_counter: '#E67E22',
        cm_worker_done: '#2ECC71', cm_dispute: '#E74C3C', cm_done_confirmed: '#27AE60',
        cm_worker_not_done: '#E67E22', offer_accepted: '#2ECC71', offer_rejected: '#E74C3C',
      };
      return map[type] || '#C8873A';
    }
    window.notifAccentColor = notifAccentColor;


    // ===== CLIENT ORDERS PAGE =====
    let allClientOrders = [];
    let currentClientOrderFilter = 'all';

    async function loadClientOrders() {
      if (!currentUser) return;
      const listEl = document.getElementById('client-orders-list');
      if (!listEl) return;
      listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">جاري التحميل...</p>';
      try {
        const snap = await get(ref(db, 'service_requests'));
        if (!snap.exists()) { allClientOrders = []; renderClientOrders(); return; }
        allClientOrders = Object.values(snap.val())
          .filter(o => o.user_id === currentUser.uid)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderClientOrders();
      } catch (e) { if (listEl) listEl.innerHTML = '<p style="color:#E74C3C;text-align:center;padding:2rem;">حصل خطأ في التحميل</p>'; }
    }
    window.loadClientOrders = loadClientOrders;

    function filterClientOrders(status) {
      currentClientOrderFilter = status;
      document.querySelectorAll('[id^="cord-tab-"]').forEach(b => b.classList.remove('active'));
      const tab = document.getElementById('cord-tab-' + status);
      if (tab) tab.classList.add('active');
      renderClientOrders();
    }
    window.filterClientOrders = filterClientOrders;

    function renderClientOrders() {
      const listEl = document.getElementById('client-orders-list');
      if (!listEl) return;
      const filtered = currentClientOrderFilter === 'all'
        ? allClientOrders
        : currentClientOrderFilter === 'accepted'
          ? allClientOrders.filter(o => ['price_offered', 'client_counter', 'accepted', 'worker_done_pending', 'client_initiated_done'].includes(o.status))
          : allClientOrders.filter(o => o.status === currentClientOrderFilter);
      if (!filtered.length) {
        listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">لا توجد طلبات في هذه الفئة</p>';
        return;
      }

      // ترتيب حسب الأولوية: الأهم أولاً
      const priorityOrder = { worker_done_pending: 0, price_offered: 1, worker_counter: 2, client_counter: 3, pending: 4, accepted: 5, done: 6, cancelled: 7 };
      const sorted = [...filtered].sort((a, b) => {
        const pa = priorityOrder[a.status] ?? 9;
        const pb = priorityOrder[b.status] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      // شريط ملخص سريع
      const counts = { price_offered: 0, worker_counter: 0, worker_done_pending: 0, pending: 0, accepted: 0, done: 0, cancelled: 0 };
      filtered.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
      const urgentCount = counts.price_offered + counts.worker_done_pending + counts.worker_counter;
      const summaryBar = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;">
        ${urgentCount > 0 ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.3);border-radius:20px;">
          <span style="width:7px;height:7px;background:#E74C3C;border-radius:50%;display:inline-block;animation:pulse-dot 1.2s infinite;"></span>
          <span style="font-size:12px;font-weight:800;color:#E74C3C;">${urgentCount} يحتاج ردك</span>
        </div>` : ''}
        ${counts.pending > 0 ? `<div style="padding:4px 10px;background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.25);border-radius:20px;font-size:12px;font-weight:700;color:#F39C12;">${counts.pending} بانتظار صنايعي</div>` : ''}
        ${counts.accepted > 0 ? `<div style="padding:4px 10px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.25);border-radius:20px;font-size:12px;font-weight:700;color:#2ECC71;">${counts.accepted} جاري</div>` : ''}
        ${counts.done > 0 ? `<div style="padding:4px 10px;background:rgba(39,174,96,0.08);border:1px solid rgba(39,174,96,0.2);border-radius:20px;font-size:12px;font-weight:700;color:#27AE60;">${counts.done} منجز</div>` : ''}
        <div style="margin-right:auto;font-size:12px;color:rgba(255,255,255,0.3);align-self:center;">${filtered.length} طلب إجمالي</div>
      </div>`;

      const statusColors = { pending: '#F39C12', price_offered: '#9B59B6', client_counter: '#E67E22', worker_counter: '#3498DB', accepted: '#2ECC71', worker_done_pending: '#C8873A', client_initiated_done: '#27AE60', done: '#27AE60', cancelled: '#E74C3C' };
      const statusTxt = { pending: '⏳ جديد', price_offered: '💰 عرض سعر جديد!', client_counter: '🤝 عرض مضاد منك!', worker_counter: '↩️ الصنايعي رد بسعر جديد!', accepted: '✓ مقبول', worker_done_pending: '⚠️ ينتظر تأكيدك', client_initiated_done: '⏳ بانتظار تأكيد الصنايعي', done: '✓ منجز', cancelled: '✗ ملغي' };
      const statusBorderHighlight = { worker_done_pending: 'rgba(200,135,58,0.5)', price_offered: 'rgba(155,89,182,0.45)', worker_counter: 'rgba(52,152,219,0.45)', pending: 'rgba(243,156,18,0.3)', client_counter: 'rgba(230,126,34,0.4)', accepted: 'rgba(46,204,113,0.25)', done: 'rgba(39,174,96,0.18)', cancelled: 'rgba(231,76,60,0.2)' };
      const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️', 'دلفري': '🚚' };

      const cards = sorted.map(o => {
        const color = statusColors[o.status] || '#F39C12';
        const txt = statusTxt[o.status] || '⏳';
        const borderColor = statusBorderHighlight[o.status] || 'rgba(255,255,255,0.08)';
        const icon = Object.entries(emojiMap).find(([k]) => (o.service_type || '').includes(k))?.[1] || '🔧';
        const isPriceOffered = o.status === 'price_offered';
        const isWorkerDone = o.status === 'worker_done_pending';
        const canRate = o.status === 'done' && !o.client_rated;
        const isUrgent = ['price_offered', 'worker_done_pending', 'worker_counter'].includes(o.status);
        const orderSafe = o.order_number;
        const svcSafe = (o.service_type || '').replace(/'/g, '');
        const timeAgo = (() => {
          const diff = Date.now() - new Date(o.created_at).getTime();
          const h = Math.floor(diff / 3600000);
          const d = Math.floor(diff / 86400000);
          if (d > 0) return `منذ ${d} يوم`;
          if (h > 0) return `منذ ${h} ساعة`;
          return 'منذ قليل';
        })();
        let extra = '';
        if (isPriceOffered) {
          const note = o.offered_price_note ? `<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:4px;">📝 ${o.offered_price_note}</div>` : '';
          extra = `<div style="background:rgba(155,89,182,0.1);border:2px solid rgba(155,89,182,0.4);border-radius:12px;padding:14px;margin-top:10px;">
        <div style="text-align:center;margin-bottom:10px;">
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:2px;">💰 عرض سعر من الصنايعي</div>
          <div style="font-size:26px;font-weight:900;color:#9B59B6;">${o.offered_price} جنيه</div>
          ${note}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button onclick="event.stopPropagation();clientAcceptPrice('${orderSafe}')" style="flex:1;min-width:70px;padding:9px 4px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✓ موافق</button>
          <button onclick="event.stopPropagation();openCounterOfferModal('${orderSafe}','${o.offered_price}')" style="flex:1;min-width:70px;padding:9px 4px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.45);border-radius:8px;color:#E67E22;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">🤝 فاصل</button>
          <button onclick="event.stopPropagation();clientRejectPrice('${orderSafe}')" style="flex:1;min-width:70px;padding:9px 4px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✗ رفض</button>
        </div>
      </div>`;
        } else if (o.status === 'client_counter') {
          extra = `<div style="background:rgba(230,126,34,0.08);border:2px solid rgba(230,126,34,0.35);border-radius:12px;padding:12px;margin-top:10px;text-align:center;">
        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:4px;">🤝 عرضك المضاد</div>
        <div style="font-size:24px;font-weight:900;color:#E67E22;">${o.client_counter_price} جنيه</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:4px;">⏳ بانتظار رد الصنايعي...</div>
      </div>`;
        } else if (o.status === 'worker_counter') {
          const wcNote = o.worker_counter_note ? `<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:4px;">📝 ${o.worker_counter_note}</div>` : '';
          extra = `<div style="background:rgba(52,152,219,0.08);border:2px solid rgba(52,152,219,0.4);border-radius:12px;padding:14px;margin-top:10px;">
        <div style="text-align:center;margin-bottom:10px;">
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:2px;">↩️ الصنايعي رد بسعر جديد</div>
          <div style="font-size:26px;font-weight:900;color:#3498DB;">${o.worker_counter_price} جنيه</div>
          ${wcNote}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button onclick="event.stopPropagation();clientAcceptWorkerCounter('${orderSafe}')" style="flex:1;min-width:70px;padding:9px 4px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✓ موافق</button>
          <button onclick="event.stopPropagation();openCounterOfferModal('${orderSafe}','${o.worker_counter_price}')" style="flex:1;min-width:70px;padding:9px 4px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.45);border-radius:8px;color:#E67E22;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">🤝 فاصل تاني</button>
          <button onclick="event.stopPropagation();clientRejectPrice('${orderSafe}')" style="flex:1;min-width:70px;padding:9px 4px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✗ رفض</button>
        </div>
      </div>`;
        }
        if (isWorkerDone) {
          extra = `<div style="background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.35);border-radius:10px;padding:12px;margin-top:10px;">
        <p style="color:#C8873A;font-size:13px;font-weight:800;margin-bottom:8px;text-align:center;">⚠️ الصنايعي قال إنه خلّص — هل تأكد؟</p>
        <div style="display:flex;gap:8px;">
          <button onclick="openConfirmDoneModal('${orderSafe}','${svcSafe}')" style="flex:1;padding:10px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.4);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✓ أيوه اتنجز</button>
          <button onclick="clientConfirmDone(false,'${orderSafe}')" style="flex:1;padding:10px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.3);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✗ لا، لسه</button>
        </div></div>`;
        }
        if (o.status === 'accepted') {
          extra += `<button onclick="clientInitDone('${orderSafe}')" style="width:100%;padding:9px;background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.25);border-radius:9px;color:rgba(46,204,113,0.7);font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;margin-top:8px;">🏁 الشغل خلص؟ — أبلّغ الصنايعي</button>`;
        }
        if (canRate) {
          extra += `<button onclick="openRatingModal('client_rates_worker','${orderSafe}')" style="width:100%;padding:9px;background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.3);border-radius:9px;color:#C8873A;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;margin-top:8px;">⭐ قيّم الصنايعي</button>`;
        }
        return `<div style="background:rgba(255,255,255,0.04);border:1.5px solid ${borderColor};border-radius:14px;padding:16px;transition:border-color 0.2s;${isUrgent ? 'box-shadow:0 0 0 1px ' + color + '22;' : ''}" onmouseover="this.style.borderColor='rgba(200,135,58,0.5)'" onmouseout="this.style.borderColor='${borderColor}'">
      ${isUrgent ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding:6px 10px;background:rgba(200,135,58,0.07);border-radius:8px;border-right:3px solid ${color};">
        <span style="font-size:11px;font-weight:800;color:${color};">🔔 يحتاج ردك الآن</span>
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:3px;">${o.service_type || 'خدمة'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);">${o.order_number} · ${timeAgo}</div>
          ${o.worker_name ? `<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px;">👷 ${o.worker_name}${['accepted', 'worker_done_pending', 'client_initiated_done', 'done'].includes(o.status) && o.worker_phone ? ' · 📞 ' + o.worker_phone : ''}</div>` : ''}
          ${o.area ? `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px;">📍 ${o.area}</div>` : ''}
          ${o.description ? `<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;">${o.description}</div>` : ''}
        </div>
        <span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0;">${txt}</span>
      </div>
      <button onclick="openClientOrderDetail('${orderSafe}')" style="width:100%;margin-top:10px;padding:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:9px;color:rgba(255,255,255,0.6);font-family:Cairo,sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(200,135,58,0.1)';this.style.color='#C8873A';this.style.borderColor='rgba(200,135,58,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.color='rgba(255,255,255,0.6)';this.style.borderColor='rgba(255,255,255,0.09)'">🔍 تفاصيل الطلب</button>
      ${extra}
    </div>`;
      }).join('');

      listEl.innerHTML = summaryBar + cards;
    }
    window.renderClientOrders = renderClientOrders;

    function showEditModal(type) {
      const isWorker = type === 'worker';
      const p = currentProfile || {};
      const body = document.getElementById('edit-modal-body');
      const inp = (val, t = 'text', icon = 'fa-user') => `<div class="input-wrap"><input type="${t}" value="${val || ''}" style="width:100%;padding:12px 40px 12px 14px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#fff;font-family:Cairo,sans-serif;font-size:14px;outline:none;"><i class="fas ${icon} input-icon"></i></div>`;
      const grp = (label, content) => `<div class="auth-input-group"><label>${label}</label>${content}</div>`;
      body.innerHTML = isWorker ? [
        grp('الاسم الكامل', inp(p.full_name, 'text', 'fa-user')),
        grp('رقم التليفون', inp(p.phone, 'tel', 'fa-phone')),
        grp('الإيميل', inp(p.email, 'email', 'fa-envelope')),
        grp('منطقة العمل', inp(p.work_area, 'text', 'fa-map-marker-alt')),
        grp('سعر الساعة (جنيه)', inp(p.price_per_hour, 'number', 'fa-coins')),
        grp('التخصص الرئيسي', inp(p.trade, 'text', 'fa-tools')),
        grp('المهارات (افصل بينها بفاصلة)', `<div class="input-wrap"><input type="text" value="${(p.tags || []).join(', ')}" style="width:100%;padding:12px 40px 12px 14px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#fff;font-family:Cairo,sans-serif;font-size:14px;outline:none;"><i class="fas fa-tag input-icon"></i></div>`),
        grp('نبذة عن نفسك', `<textarea style="width:100%;padding:12px 14px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#fff;font-family:Cairo,sans-serif;font-size:14px;outline:none;resize:vertical;min-height:80px;">${p.bio || ''}</textarea>`)
      ].join('') : [
        grp('الاسم الكامل', inp(p.full_name, 'text', 'fa-user')),
        grp('رقم التليفون', inp(p.phone, 'tel', 'fa-phone')),
        grp('الإيميل', inp(p.email, 'email', 'fa-envelope')),
        grp('العنوان', inp(p.address, 'text', 'fa-home'))
      ].join('');
      document.getElementById('edit-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
    window.showEditModal = showEditModal;

    function closeEditModal() {
      document.getElementById('edit-modal').style.display = 'none';
      document.body.style.overflow = '';
    }
    window.closeEditModal = closeEditModal;

    async function saveProfile() {
      if (!currentUser) return;
      const isWorker = currentProfile?.role === 'worker';
      const inputs = document.querySelectorAll('#edit-modal-body input, #edit-modal-body textarea');
      const updates = {};
      if (isWorker) {
        updates.full_name = inputs[0]?.value; updates.phone = inputs[1]?.value;
        updates.email = inputs[2]?.value; updates.work_area = inputs[3]?.value;
        updates.price_per_hour = inputs[4]?.value;
        updates.trade = inputs[5]?.value || '';
        const tagsRaw = inputs[6]?.value || '';
        updates.tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
        updates.bio = inputs[7]?.value || '';
      } else {
        updates.full_name = inputs[0]?.value; updates.phone = inputs[1]?.value;
        updates.email = inputs[2]?.value; updates.address = inputs[3]?.value;
      }
      try {
        await update(ref(db, 'profiles/' + currentUser.uid), updates);
        closeEditModal();
        await loadCurrentProfile();
        const toast = document.createElement('div');
        toast.textContent = '✅ تم حفظ التعديلات بنجاح!';
        toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1E8449;color:#fff;padding:12px 24px;border-radius:12px;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
      } catch (e) { alert('حصل خطأ في الحفظ'); }
    }
    window.saveProfile = saveProfile;

    async function updateAvailability(checkbox) {
      const label = checkbox.closest('.availability-toggle').querySelector('.toggle-label');
      // لو بيحاول يشغل الحالة، تحقق من الرصيد أول
      if (checkbox.checked && currentUser) {
        try {
          const wSnap = await get(walletRef(currentUser.uid));
          const bal = wSnap.exists() ? (wSnap.val().balance || 0) : 0;
          if (bal <= 0) {
            checkbox.checked = false;
            label.textContent = '🔴 الحالة: مش متاح دلوقتي';
            showToast('❌ مش تقدر تشغل الحالة — رصيدك صفر، اشحن محفظتك الأول 💳', '#E74C3C');
            return;
          }
        } catch (e) { console.error(e); }
      }
      label.textContent = checkbox.checked ? '🟢 الحالة: متاح للعمل دلوقتي' : '🔴 الحالة: مش متاح دلوقتي';
      if (currentUser) {
        await update(ref(db, 'craftsmen/' + currentUser.uid), { available: checkbox.checked });
      }
    }
    window.updateAvailability = updateAvailability;


    // ===== CRAFTSMAN MODAL =====
    async function openProfile(idx) {
      const c = craftsmen[idx];
      if (!c) return;

      // --- Avatar ---
      const avatarWrap = document.getElementById('modal-avatar-wrap');
      if (c.photo) {
        avatarWrap.innerHTML = `<img src="${c.photo}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;">`;
        avatarWrap.style.fontSize = '0';
      } else {
        avatarWrap.innerHTML = c.emoji || '🔧';
        avatarWrap.style.fontSize = '3rem';
      }

      // --- Basic info ---
      document.getElementById('modal-name').textContent = c.name;
      document.getElementById('modal-trade').textContent = c.trade;
      document.getElementById('modal-area').textContent = '📍 ' + c.area;

      // --- Stats ---
      const rating = parseFloat(c.rating) || 5;
      document.getElementById('modal-rating-num').textContent = rating.toFixed(1) + ' ★';
      document.getElementById('modal-reviews-num').textContent = c.reviews || 0;

      // --- Stars row ---
      const fullStars = Math.floor(rating);
      const halfStar = rating % 1 >= 0.5 ? '½' : '';
      const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
      document.getElementById('modal-stars-row').textContent = '★'.repeat(fullStars) + halfStar + '☆'.repeat(emptyStars);
      document.getElementById('modal-reviews-label').textContent = (c.reviews || 0) + ' تقييم من العملاء';

      // --- Status badge ---
      const statusEl = document.getElementById('modal-status');
      statusEl.className = 'available-badge ' + (c.available ? 'yes' : 'busy');
      statusEl.textContent = c.available ? '🟢 متاح الآن' : '🔴 مشغول';

      const statusTop = document.getElementById('modal-status-top');
      statusTop.innerHTML = `<span class="available-badge ${c.available ? 'yes' : 'busy'}" style="font-size:11px;">${c.available ? '🟢 متاح' : '🔴 مشغول'}</span>`;

      // --- Bio ---
      const bioSection = document.getElementById('modal-bio-section');
      const bioEl = document.getElementById('modal-bio');
      if (c.bio && c.bio.trim()) {
        bioEl.textContent = c.bio.trim();
        bioSection.style.display = 'block';
      } else {
        bioSection.style.display = 'none';
      }

      // --- Tags ---
      document.getElementById('modal-tags').innerHTML = (c.tags || []).map(t => `<span class="tag">${t}</span>`).join('') || '<span style="color:rgba(255,255,255,0.3);font-size:13px;">لا توجد تخصصات مضافة</span>';

      // --- Book button ---
      document.getElementById('modal-book-btn').onclick = () => { closeModal(); bookCraftsman(c); };

      // --- Show modal ---
      const modal = document.getElementById('craftsman-modal');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      // --- Load ratings from Firebase ---
      const ratingsList = document.getElementById('modal-ratings-list');
      ratingsList.innerHTML = '<div style="text-align:center;padding:1.5rem;color:rgba(255,255,255,0.25);font-size:13px;">⏳ جاري تحميل التقييمات...</div>';
      try {
        const snap = await get(ref(db, 'craftsmen/' + c.id + '/ratings_list'));
        if (!snap.exists()) {
          ratingsList.innerHTML = '<div style="text-align:center;padding:1.2rem;color:rgba(255,255,255,0.25);font-size:13px;">لا توجد تقييمات بعد</div>';
        } else {
          const list = Object.values(snap.val())
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 15);
          ratingsList.innerHTML = list.map(r => {
            const s = parseInt(r.stars) || 0;
            const stars = '★'.repeat(s) + '☆'.repeat(5 - s);
            const comment = (r.comment || '').toString().trim();
            const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
            return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:13px;padding:13px 15px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,rgba(200,135,58,0.25),rgba(200,135,58,0.06));border:1px solid rgba(200,135,58,0.2);display:flex;align-items:center;justify-content:center;font-size:15px;">👤</div>
              <div>
                <div style="font-size:13px;font-weight:700;color:#fff;">${r.from_name || 'عميل'}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.3);">${date}</div>
              </div>
            </div>
            <div style="color:#C8873A;font-size:15px;letter-spacing:2px;">${stars}</div>
          </div>
          ${comment ? `<div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.7;border-right:2px solid rgba(200,135,58,0.4);padding-right:10px;margin-top:4px;font-style:italic;">"${comment}"</div>` : ''}
        </div>`;
          }).join('');
        }
      } catch (e) {
        ratingsList.innerHTML = '<div style="text-align:center;padding:1rem;color:rgba(255,255,255,0.25);font-size:13px;">تعذر تحميل التقييمات</div>';
      }

      // --- Load Portfolio (معرض الأعمال) ---
      const portSection = document.getElementById('modal-portfolio-section');
      const portGrid    = document.getElementById('modal-portfolio-grid');
      portSection.style.display = 'none';
      portGrid.innerHTML = '';
      try {
        const portSnap = await get(ref(db, 'portfolio/' + c.id));
        if (portSnap.exists()) {
          const photos = Object.entries(portSnap.val())
            .map(([key, d]) => ({ key, ...d }))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          if (photos.length > 0) {
            portSection.style.display = 'block';
            portGrid.innerHTML = photos.map((p, i) => `
              <div onclick="openPortfolioLightbox('${p.img.replace(/'/g,"\\'")}','${(p.caption||'صورة '+(i+1)).replace(/'/g,"\\'")}'')"
                style="aspect-ratio:1;border-radius:12px;overflow:hidden;cursor:pointer;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);transition:transform .2s,border-color .2s;"
                onmouseover="this.style.transform='scale(1.04)';this.style.borderColor='rgba(200,135,58,0.5)'"
                onmouseout="this.style.transform='scale(1)';this.style.borderColor='rgba(255,255,255,0.08)'">
                <img src="${p.img}" alt="عمل ${i+1}" loading="lazy"
                  style="width:100%;height:100%;object-fit:cover;display:block;">
              </div>`).join('');
          }
        }
      } catch (e) { /* portfolio load failed silently */ }
    }
    window.openProfile = openProfile;

    function openProfileById(id) {
      const idx = craftsmen.findIndex(c => (c.id || c.user_id) === id);
      if (idx !== -1) openProfile(idx);
    }
    window.openProfileById = openProfileById;

    function bookCraftsmanById(id) {
      const c = craftsmen.find(c => (c.id || c.user_id) === id);
      if (c) bookCraftsman(c);
    }
    window.bookCraftsmanById = bookCraftsmanById;

    function closeModal() {
      document.getElementById('craftsman-modal').style.display = 'none';
      document.body.style.overflow = '';
    }
    window.closeModal = closeModal;

    async function bookCraftsman(c) {
      if (currentProfile?.role === 'worker') { alert('الصنايعي مش بيقدر يطلب خدمة!'); return; }
      const workerId = c.user_id || c.id;
      // فحص فوري ولحظي وقت الحجز نفسه — حتى لو القايمة اللي قدام العميل لسه متحدّثتش
      if (typeof window.getBusyWorkerIds === 'function') {
        try {
          const busyMap = await window.getBusyWorkerIds();
          if (busyMap.has(workerId)) {
            alert('🔴 للأسف الصنايعي "' + (c.name || '') + '" بقى مشغول بطلب تاني دلوقتي.\nاختار صنايعي تاني متاح.');
            if (typeof window.loadCraftsmen === 'function') window.loadCraftsmen(); // حدّث القايمة عشان يختفي فورًا
            return;
          }
        } catch (e) { console.error('busy check error:', e); }
      }
      window._targetWorkerId = workerId;
      window._targetWorkerName = c.name || '';
      showPage('request');
      setTimeout(() => {
        const sel = document.getElementById('req-service');
        for (let opt of sel.options) { if (opt.text.includes(c.trade)) { sel.value = opt.value; break; } }
        showTargetWorkerBanner(c.name || '', c.trade || '');
        renderProfessionExtraFields('req-extra-fields', sel.value);
        updateDescPlaceholder('req-desc', sel.value);
      }, 100);
    }
    window.bookCraftsman = bookCraftsman;

    // ===== PROFILE MENU =====
    function toggleProfileMenu() {
      const dd = document.getElementById('nav-dropdown');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    }
    window.toggleProfileMenu = toggleProfileMenu;

    function closeProfileMenu() { document.getElementById('nav-dropdown').style.display = 'none'; }
    window.closeProfileMenu = closeProfileMenu;

    document.addEventListener('click', function (e) {
      const wrap = document.getElementById('nav-profile-wrap');
      if (wrap && !wrap.contains(e.target)) closeProfileMenu();
    });

    // ===== LOGOUT BUTTONS =====
    document.querySelectorAll('.btn-logout').forEach(btn => {
      btn.addEventListener('click', doLogout);
    });


    // ===== LOAD WORKER RATINGS =====
    async function loadWorkerRatings() {
      if (!currentUser) return;
      const el = document.getElementById('worker-ratings-list');
      if (!el) return;
      try {
        const snap = await get(ref(db, 'craftsmen/' + currentUser.uid + '/ratings_list'));
        if (!snap.exists()) {
          el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1.5rem;font-size:14px;">لا توجد تقييمات بعد</p>';
          return;
        }
        const list = Object.values(snap.val())
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 10);
        el.innerHTML = list.map(r => {
          const starsCount = parseInt(r.stars) || 0;
          const stars = '★'.repeat(starsCount) + '☆'.repeat(5 - starsCount);
          const commentText = (r.comment || '').toString().trim();
          return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;margin-bottom:10px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
            + '<span style="color:#C8873A;font-size:18px;letter-spacing:3px;">' + stars + '</span>'
            + '<span style="font-size:11px;color:rgba(255,255,255,0.35);">' + new Date(r.created_at).toLocaleDateString('ar-EG') + '</span>'
            + '</div>'
            + '<div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:6px;">👤 ' + (r.from_name || 'عميل') + '</div>'
            + (commentText.length > 0
              ? '<div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:6px;font-style:italic;background:rgba(200,135,58,0.08);border-right:3px solid #C8873A;padding:8px 10px;border-radius:6px;">"' + commentText + '"</div>'
              : '<div style="font-size:12px;color:rgba(255,255,255,0.25);margin-top:4px;font-style:italic;">لم يترك تعليقاً</div>')
            + '</div>';
        }).join('');
      } catch (e) { console.error('loadWorkerRatings error:', e); }
    }
    window.loadWorkerRatings = loadWorkerRatings;


    // ===== CLIENT ORDER DETAIL MODAL =====
    let _detailModalListener = null;
    let _detailPollingTimer = null;
    function openClientOrderDetail(orderNum) {
      window._openDetailOrderNum = orderNum;
      if (_detailModalListener) { _detailModalListener(); _detailModalListener = null; }
      if (_detailPollingTimer) { clearInterval(_detailPollingTimer); _detailPollingTimer = null; }
      // استمع على node الطلب المحدد مباشرة
      _detailModalListener = onValue(ref(db, 'service_requests/' + orderNum), (snap) => {
        if (!snap.exists()) return;
        const fresh = snap.val();
        if (!fresh) return;
        const idx = allClientOrders.findIndex(x => x.order_number === orderNum);
        if (idx !== -1) allClientOrders[idx] = fresh;
        else allClientOrders.push(fresh);
        _renderClientOrderDetail(fresh);
      });
      // polling احتياطي كل 8 ثواني
      _detailPollingTimer = setInterval(async () => {
        if (!window._openDetailOrderNum) { clearInterval(_detailPollingTimer); _detailPollingTimer = null; return; }
        try {
          const snap = await get(ref(db, 'service_requests/' + orderNum));
          if (snap.exists()) {
            const fresh = snap.val();
            const idx = allClientOrders.findIndex(x => x.order_number === orderNum);
            if (idx !== -1) allClientOrders[idx] = fresh;
            else allClientOrders.push(fresh);
            _renderClientOrderDetail(fresh);
          }
        } catch (e) { }
      }, 8000);
    }
    function _renderClientOrderDetail(o) {
      if (!o) return;

      const statusColors = { pending_admin: '#F39C12', pending: '#F39C12', price_offered: '#9B59B6', client_counter: '#E67E22', worker_counter: '#3498DB', accepted: '#2ECC71', worker_done_pending: '#C8873A', client_initiated_done: '#27AE60', done: '#27AE60', cancelled: '#E74C3C' };
      const statusTxt = { pending_admin: '⏳ جديد — ينتظر صنايعي', pending: '⏳ جديد', price_offered: '💰 عرض سعر جديد!', client_counter: '🤝 بينتظر ردك!', worker_counter: '↩️ الصنايعي رد بسعر!', accepted: '✓ مقبول', worker_done_pending: '⚠️ ينتظر تأكيدك', client_initiated_done: '⏳ بانتظار تأكيد الصنايعي', done: '✓ منجز', cancelled: '✗ ملغي' };
      const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️', 'دلفري': '🚚' };

      const icon = Object.entries(emojiMap).find(([k]) => (o.service_type || '').includes(k))?.[1] || '🔧';
      const color = statusColors[o.status] || '#F39C12';
      const txt = statusTxt[o.status] || '⏳';

      document.getElementById('cod-icon').textContent = icon;
      document.getElementById('cod-title').textContent = o.service_type || 'خدمة';
      document.getElementById('cod-status-badge').innerHTML =
        `<span style="background:rgba(255,255,255,0.06);color:${color};border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">${txt}</span>`;

      const row = (icon, label, val) => val ? `
    <div style="display:flex;gap:12px;align-items:flex-start;background:rgba(255,255,255,0.04);border-radius:11px;padding:12px 14px;">
      <span style="font-size:18px;flex-shrink:0;">${icon}</span>
      <div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:3px;">${label}</div>
        <div style="font-size:14px;color:#fff;font-weight:600;line-height:1.5;">${val}</div>
      </div>
    </div>` : '';

      const isPriceOffered = o.status === 'price_offered';
      const isWorkerDone = o.status === 'worker_done_pending';
      const canRate = o.status === 'done' && !o.client_rated;
      const orderSafe = o.order_number;
      const svcSafe = (o.service_type || '').replace(/'/g, '');

      const canChat = ['accepted', 'worker_done_pending'].includes(o.status) && o.worker_id;
      const workerIdSafe = o.worker_id || '';
      const workerNameSafe = (o.worker_name || 'الصنايعي').replace(/'/g, '');
      let actionHTML = '';
      if (isPriceOffered) {
        const priceNote = o.offered_price_note ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:6px;line-height:1.6;">📝 ${o.offered_price_note}</div>` : '';
        actionHTML += `
      <div style="background:rgba(155,89,182,0.1);border:2px solid rgba(155,89,182,0.4);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:4px;">الصنايعي بعتلك عرض سعر</div>
          <div style="font-size:30px;font-weight:900;color:#9B59B6;">${o.offered_price} <span style="font-size:16px;">جنيه</span></div>
          ${priceNote}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button onclick="clientAcceptPrice('${orderSafe}');closeClientOrderDetail()" style="flex:1;min-width:80px;padding:11px 8px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:10px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✓ موافق</button>
          <button onclick="openCounterOfferModal('${orderSafe}','${o.offered_price}');closeClientOrderDetail()" style="flex:1;min-width:80px;padding:11px 8px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.45);border-radius:10px;color:#E67E22;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">🤝 فاصل</button>
          <button onclick="clientRejectPrice('${orderSafe}');closeClientOrderDetail()" style="flex:1;min-width:80px;padding:11px 8px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:10px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✗ رفض</button>
        </div>
      </div>`;
      }
      if (o.status === 'client_counter') {
        actionHTML += `
      <div style="background:rgba(230,126,34,0.08);border:2px solid rgba(230,126,34,0.35);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;align-items:center;">
        <div style="font-size:12px;color:rgba(255,255,255,0.4);">عرضك المضاد</div>
        <div style="font-size:28px;font-weight:900;color:#E67E22;">${o.client_counter_price} <span style="font-size:14px;">جنيه</span></div>
        <div style="font-size:12px;color:rgba(255,255,255,0.4);">⏳ بانتظار رد الصنايعي...</div>
      </div>`;
      }
      if (o.status === 'worker_counter') {
        const wcNote = o.worker_counter_note ? `<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:4px;">📝 ${o.worker_counter_note}</div>` : '';
        actionHTML += `
      <div style="background:rgba(52,152,219,0.08);border:2px solid rgba(52,152,219,0.4);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:4px;">↩️ الصنايعي رد بسعر جديد</div>
          <div style="font-size:28px;font-weight:900;color:#3498DB;">${o.worker_counter_price} <span style="font-size:14px;">جنيه</span></div>
          ${wcNote}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button onclick="clientAcceptWorkerCounter('${orderSafe}');closeClientOrderDetail()" style="flex:1;min-width:80px;padding:11px 8px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:10px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✓ موافق</button>
          <button onclick="openCounterOfferModal('${orderSafe}','${o.worker_counter_price}');closeClientOrderDetail()" style="flex:1;min-width:80px;padding:11px 8px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.45);border-radius:10px;color:#E67E22;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">🤝 فاصل تاني</button>
          <button onclick="clientRejectPrice('${orderSafe}');closeClientOrderDetail()" style="flex:1;min-width:80px;padding:11px 8px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:10px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✗ رفض</button>
        </div>
      </div>`;
      }
      if (canChat) {
        actionHTML += `<button onclick="closeClientOrderDetail();openChatWithUser('${workerIdSafe}','${workerNameSafe}','worker')" style="width:100%;padding:12px;background:rgba(26,82,118,0.2);border:1px solid rgba(26,82,118,0.5);border-radius:11px;color:#5DADE2;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:2px;">💬 تكلم مع الصنايعي</button>`;
      }
      if (isWorkerDone) {
        actionHTML += `<div style="background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.3);border-radius:12px;padding:14px;">
      <p style="color:#C8873A;font-size:13px;font-weight:700;margin-bottom:10px;text-align:center;">الصنايعي قال إنه خلّص — هل تأكد؟</p>
      <div style="display:flex;gap:8px;">
        <button onclick="closeClientOrderDetail();openConfirmDoneModal('${orderSafe}','${svcSafe}')" style="flex:1;padding:10px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.4);border-radius:9px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✓ أيوه اتنجز</button>
        <button onclick="closeClientOrderDetail();clientConfirmDone(false,'${orderSafe}')" style="flex:1;padding:10px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.3);border-radius:9px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✗ لا، لسه</button>
      </div></div>`;
      }
      if (canRate) {
        actionHTML += `<button onclick="closeClientOrderDetail();openRatingModal('client_rates_worker','${orderSafe}')" style="width:100%;padding:12px;background:rgba(200,135,58,0.15);border:1px solid rgba(200,135,58,0.35);border-radius:11px;color:#C8873A;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">⭐ قيّم الصنايعي</button>`;
      }

      let imgsHTML = '';
      if (o.images && o.images.length) {
        imgsHTML = `<div style="background:rgba(255,255,255,0.04);border-radius:11px;padding:12px 14px;">
      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:8px;">📷 صور المشكلة</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${o.images.map(img => `<img src="${img}" style="width:80px;height:80px;object-fit:cover;border-radius:9px;border:2px solid rgba(200,135,58,0.3);cursor:zoom-in;" onclick="openLightbox(this.src)">`).join('')}</div>
    </div>`;
      }

      const showWorkerPhone = ['accepted', 'worker_done_pending', 'client_initiated_done', 'done'].includes(o.status) && o.worker_phone;
      const workerInfoHTML = o.worker_name ? `
    <div style="display:flex;gap:12px;align-items:flex-start;background:rgba(255,255,255,0.04);border-radius:11px;padding:12px 14px;">
      <span style="font-size:18px;flex-shrink:0;">👷</span>
      <div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:3px;">الصنايعي</div>
        <div style="font-size:14px;color:#fff;font-weight:600;line-height:1.5;">${o.worker_name}</div>
        ${showWorkerPhone ? `<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:4px;">📞 ${o.worker_phone}</div>` : ''}
      </div>
    </div>` : '';

      document.getElementById('cod-body').innerHTML =
        row('📋', 'رقم الطلب', o.order_number) +
        row('📅', 'تاريخ الطلب', new Date(o.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })) +
        workerInfoHTML +
        row('📍', 'المنطقة', o.area || null) +
        row('🏠', 'العنوان', o.address || null) +
        row('🕐', 'الوقت المفضل', o.preferred_time || null) +
        row('📝', 'وصف المشكلة', o.description || null) +
        imgsHTML +
        actionHTML;

      document.getElementById('client-order-detail-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
    window.openClientOrderDetail = openClientOrderDetail;

    function closeClientOrderDetail() {
      document.getElementById('client-order-detail-modal').style.display = 'none';
      document.body.style.overflow = '';
      window._openDetailOrderNum = null;
      if (_detailModalListener) { _detailModalListener(); _detailModalListener = null; }
      if (_detailPollingTimer) { clearInterval(_detailPollingTimer); _detailPollingTimer = null; }
    }
    window.closeClientOrderDetail = closeClientOrderDetail;


