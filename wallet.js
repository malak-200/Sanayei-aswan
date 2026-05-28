// ===== COUNTER OFFER (NEGOTIATION) =====
    function openCounterOfferModal(orderNum, workerPrice) {
      document.getElementById('counter-offer-order-num').value = orderNum;
      document.getElementById('counter-offer-amount').value = '';
      document.getElementById('counter-offer-note').value = '';
      document.getElementById('counter-modal-sub').textContent = 'سعر الصنايعي: ' + workerPrice + ' جنيه';
      document.getElementById('counter-offer-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.getElementById('counter-offer-amount').focus(), 200);
    }
    window.openCounterOfferModal = openCounterOfferModal;

    function closeCounterOfferModal() {
      document.getElementById('counter-offer-modal').style.display = 'none';
      document.body.style.overflow = '';
    }
    window.closeCounterOfferModal = closeCounterOfferModal;

    async function submitCounterOffer() {
      const orderNum = document.getElementById('counter-offer-order-num').value;
      const price = parseInt(document.getElementById('counter-offer-amount').value);
      const note = document.getElementById('counter-offer-note').value.trim();
      if (!price || price <= 0) { alert('اكتب سعر صحيح!'); return; }

      const btn = document.querySelector('#counter-offer-modal button[onclick="submitCounterOffer()"]');
      if (btn) { btn.disabled = true; btn.textContent = 'جاري الإرسال...'; }

      try {
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'client_counter',
          client_counter_price: price,
          client_counter_note: note || null
        });

        // إشعار الصنايعي عبر الشات
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists() && snap.val().worker_id && currentUser) {
          const order = snap.val();
          const chatId = [currentUser.uid, order.worker_id].sort().join('_');
          await set(push(ref(db, 'chats/' + chatId + '/messages')), {
            from: currentUser.uid,
            text: '🤝 العميل بيفاصل في طلب ' + orderNum +
              '\nعرضه: ' + price + ' جنيه' +
              (note ? '\nملاحظة: ' + note : '') +
              '\n\nوافق أو رد بسعر جديد من صفحة طلباتك.',
            timestamp: Date.now()
          });
          // ✅ Firebase notification للصنايعي
          await push(ref(db, 'notifications/' + order.worker_id), {
            type: 'client_counter', title: '🤝 العميل بيفاصل على السعر!',
            body: 'العميل عرض ' + price + ' جنيه بدل عرضك في طلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — وافق أو رد بسعر جديد.',
            order_num: orderNum, read: false, created_at: new Date().toISOString()
          });
        }

        closeCounterOfferModal();
      } catch (e) {
        console.error(e);
        alert('حصل خطأ، حاول تاني.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<span>🤝</span> إرسال عرضي للصنايعي'; }
      }
    }
    window.submitCounterOffer = submitCounterOffer;

    async function workerAcceptCounter(orderNum) {
      // ✅ شرط الـ 50 ج — مع استثناء أول طلب مجاني
      if (currentUser) {
        try {
          const wSnap = await get(walletRef(currentUser.uid));
          const wData = wSnap.exists() ? wSnap.val() : {};
          const wBal = wData.balance || 0;
          const completedOrders = wData.completed_orders || 0;

          if (wBal < 50) {
            // أول طلب مجاناً دايماً لأي حساب جديد
            if (completedOrders !== 0) {
              alert('❌ رصيدك في المحفظة أقل من 50 ج!\nمينفعش تقبل طلبات دلوقتي.\nاشحن رصيدك الأول من صفحة المحفظة 💳');
              return;
            }
            // لو completed === 0 → اكمل بدون شرط رصيد
          }
        } catch (e) { console.error('Wallet check error:', e); }
      }
      try {
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (!snap.exists()) return;
        const order = snap.val();
        // اعتبر السعر المتفق عليه هو عرض العميل
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'accepted',
          offered_price: order.client_counter_price,
          client_counter_price: null,
          client_counter_note: null,
          worker_id: currentUser.uid,
          worker_name: currentProfile?.full_name || order.worker_name || 'الصنايعي'
        });
        // إشعار العميل
        if (order.user_id && currentUser) {
          const chatId = [currentUser.uid, order.user_id].sort().join('_');
          await set(push(ref(db, 'chats/' + chatId + '/messages')), {
            from: currentUser.uid,
            text: '✅ وافقت على سعرك (' + order.client_counter_price + ' جنيه) للطلب رقم ' + orderNum + '\nهنبدأ الشغل قريباً إن شاء الله 🙏',
            timestamp: Date.now()
          });
          // ✅ Firebase notification للعميل
          await push(ref(db, 'notifications/' + order.user_id), {
            type: 'counter_accepted', title: '✅ الصنايعي وافق على سعرك!',
            body: 'الصنايعي قبل عرضك (' + order.client_counter_price + ' جنيه) لطلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — الشغل هيبدأ قريباً 🙏',
            order_num: orderNum, read: false, created_at: new Date().toISOString()
          });
        }
        // لو في صفحة التفاصيل — حدّثها
        const detailPage = document.getElementById('page-request-detail');
        if (detailPage && detailPage.classList.contains('active')) openRequestDetail(orderNum);
      } catch (e) { console.error(e); alert('حصل خطأ، حاول تاني.'); }
    }
    window.workerAcceptCounter = workerAcceptCounter;
    // ===== END COUNTER OFFER =====

// ==================== WALLET SYSTEM ====================
  (function () {
    // ===== Commission Tiers =====
    const COMMISSION_TIERS = [
      { label: 'برونزي', min: 0, max: 9, rate: 0.10, badge: 'bronze' },
      { label: 'فضي', min: 10, max: 29, rate: 0.08, badge: 'silver' },
      { label: 'ذهبي', min: 30, max: 59, rate: 0.06, badge: 'gold' },
      { label: 'بلاتيني', min: 60, max: 9999, rate: 0.04, badge: 'platinum' }
    ];

    function getTier(completedOrders) {
      return COMMISSION_TIERS.find(t => completedOrders >= t.min && completedOrders <= t.max) || COMMISSION_TIERS[0];
    }

    // ===== PROMO: حساب العمولة مع مراعاة العروض =====
    // - أول طلب للصنايعي الجديد: بلاش (0%)
    // - أول شهر من التسجيل: عمولة ثابتة 5%
    // ===== Firebase helpers (declared early for promo function) =====
    function walletRef(uid) { return ref(db, 'wallets/' + uid); }
    function walletTxnRef(uid) { return ref(db, 'wallet_transactions/' + uid); }

    async function getEffectiveCommission(workerUid, price, completedOrders) {
      const now = Date.now();

      // ① جيب العروض الفعّالة من Firebase
      let activePromo = null;
      let firstOrderFreeEnabled = false;
      try {
        const promosSnap = await get(ref(db, 'promos'));
        if (promosSnap.exists()) {
          const promosData = promosSnap.val();
          Object.values(promosData).forEach(p => {
            if (p.active && new Date(p.start_at) <= now && new Date(p.end_at) >= now) {
              activePromo = p;
              if (p.first_order_free) firstOrderFreeEnabled = true;
            }
          });
        }
      } catch (e) { console.error('Promo fetch error:', e); }

      // ② أول طلب مجاناً — دايماً لكل حساب جديد بغض النظر عن العروض
      if ((completedOrders || 0) === 0) {
        return { commission: 0, rate: 0, label: '🎁 أول طلب مجاناً', promo: 'first_order' };
      }

      // ③ عرض نشط من لوحة الأدمن
      if (activePromo) {
        const rate = activePromo.rate / 100;
        const commission = Math.round(price * rate);
        return { commission, rate, label: '🌟 ' + activePromo.name + ' (' + activePromo.rate + '%)', promo: 'platform_promo' };
      }

      // ④ عادي: حسب الـ tier
      const tier = getTier(completedOrders);
      const commission = Math.round(price * tier.rate);
      return { commission, rate: tier.rate, label: tier.label, promo: null };
    }

    // ===== Load wallet data =====
    async function loadWallet() {
      if (!window.currentUser) return;
      const uid = window.currentUser.uid;
      const snap = await get(walletRef(uid));
      const data = snap.exists() ? snap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
      renderWallet(data);
      loadTransactions(uid);
      renderCommissionTiers(data.completed_orders || 0);
    }

    function toArabicNum(n) {
      return n.toLocaleString('ar-EG');
    }

    function renderWallet(data) {
      const bal = data.balance || 0;
      const dep = data.total_deposited || 0;
      const ded = data.total_deducted || 0;
      const completed = data.completed_orders || 0;
      const tier = getTier(completed);
      const nextTier = COMMISSION_TIERS.find(t => t.min > completed);
      const nextIn = nextTier ? (nextTier.min - completed) : 0;

      // Balance
      const balEl = document.getElementById('wallet-balance-display');
      if (balEl) balEl.textContent = toArabicNum(bal) + ' ج';

      const depBadge = document.getElementById('wallet-total-earned-badge');
      if (depBadge) depBadge.textContent = '↑ إجمالي الإيداع: ' + toArabicNum(dep) + ' ج';
      const dedBadge = document.getElementById('wallet-total-deducted-badge');
      if (dedBadge) dedBadge.textContent = '↓ إجمالي العمولة: ' + toArabicNum(ded) + ' ج';

      // Low balance warning
      const warn = document.getElementById('wallet-low-warning');
      if (warn) warn.style.display = bal < 50 ? 'flex' : 'none';

      // Stats
      const sOrders = document.getElementById('wallet-stat-orders');
      if (sOrders) sOrders.textContent = toArabicNum(completed);
      const sCom = document.getElementById('wallet-stat-commission');
      if (sCom) sCom.textContent = (tier.rate * 100) + '%';
      const sNext = document.getElementById('wallet-stat-next');
      if (sNext) sNext.textContent = nextTier ? toArabicNum(nextIn) + ' طلب' : '🏆 أعلى مستوى';

      // Color balance card based on balance
      const card = document.getElementById('wallet-balance-card');
      if (card) {
        if (bal <= 0) {
          card.style.borderColor = 'rgba(192,57,43,0.5)';
          card.style.background = 'linear-gradient(135deg, rgba(192,57,43,0.15) 0%, rgba(139,0,0,0.1) 100%)';
        } else if (bal < 50) {
          card.style.borderColor = 'rgba(230,126,34,0.5)';
          card.style.background = 'linear-gradient(135deg, rgba(230,126,34,0.15) 0%, rgba(200,100,0,0.1) 100%)';
        } else {
          card.style.borderColor = 'rgba(200,135,58,0.4)';
          card.style.background = 'linear-gradient(135deg, rgba(200,135,58,0.18) 0%, rgba(139,94,37,0.12) 100%)';
        }
      }

      // Update commission example
      const exEl = document.getElementById('commission-example');
      if (exEl) {
        const ex = 300;
        const comm = Math.round(ex * tier.rate);
        exEl.innerHTML = `لو سعر طلبك <strong style="color:var(--gold);">300 ج</strong> ومستواك الحالي <strong style="color:var(--gold);">${tier.label}</strong> (${tier.rate * 100}%):<br>العمولة = <strong style="color:#E74C3C;">${comm} ج</strong> — يبقى هتاخد صافي <strong style="color:#2ECC71;">${ex - comm} ج</strong>`;
      }
    }

    function renderCommissionTiers(completedOrders) {
      const tbody = document.getElementById('commission-tiers-tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      COMMISSION_TIERS.forEach(t => {
        const isCurrent = completedOrders >= t.min && completedOrders <= t.max;
        const rangeLabel = t.max >= 9999 ? t.min + '+' : t.min + ' – ' + t.max;
        const tr = document.createElement('tr');
        if (isCurrent) tr.style.background = 'rgba(200,135,58,0.07)';
        tr.innerHTML = `
        <td><span class="tier-badge ${t.badge}">${t.label}</span></td>
        <td style="font-weight:600;">${rangeLabel} طلب</td>
        <td style="font-weight:800;color:var(--gold);">${t.rate * 100}%</td>
        <td>${isCurrent ? '<span style="font-size:11px;font-weight:700;color:#2ECC71;">✓ مستواك الحالي</span>' : ''}</td>
      `;
        tbody.appendChild(tr);
      });
    }

    async function loadTransactions(uid) {
      const snap = await get(walletTxnRef(uid));
      const container = document.getElementById('wallet-txn-list');
      if (!container) return;
      if (!snap.exists()) {
        container.innerHTML = '<div style="text-align:center;padding:3rem 1rem;color:rgba(255,255,255,0.3);"><div style="font-size:3rem;margin-bottom:10px;">📋</div><div style="font-size:14px;">لا يوجد معاملات بعد</div></div>';
        return;
      }
      const items = [];
      snap.forEach(child => items.push({ key: child.key, ...child.val() }));
      items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      container.innerHTML = items.map(tx => {
        const isPlus = tx.type === 'deposit';
        const isCommission = tx.type === 'commission';
        const icon = isPlus ? '💳' : isCommission ? '📊' : '💸';
        const iconClass = isPlus ? 'deposit' : isCommission ? 'commission' : 'deduction';
        const amountClass = isPlus ? 'plus' : 'minus';
        const sign = isPlus ? '+' : '-';
        const dt = tx.created_at ? new Date(tx.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="txn-item">
        <div class="txn-icon ${iconClass}">${icon}</div>
        <div class="txn-body">
          <div class="txn-title">${tx.description || (isPlus ? 'إيداع رصيد' : 'خصم عمولة')}</div>
          <div class="txn-date">${dt}${tx.order_num ? ' · طلب #' + tx.order_num : ''}</div>
        </div>
        <div class="txn-amount ${amountClass}">${sign}${toArabicNum(tx.amount)} ج</div>
      </div>`;
      }).join('');
    }

    // ===== Quick Amount Selection =====
    let selectedDepositAmount = 0;
    window.selectQuickAmount = function (amount, btn) {
      document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDepositAmount = amount;
      const inp = document.getElementById('wallet-deposit-input');
      if (inp) inp.value = amount;
      updateCommissionPreview(amount);
    };

    window.onDepositInputChange = function (val) {
      document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('selected'));
      selectedDepositAmount = parseFloat(val) || 0;
      updateCommissionPreview(selectedDepositAmount);
    };

    function updateCommissionPreview(amount) {
      const preview = document.getElementById('commission-preview');
      if (!preview) return;
      if (!amount || amount <= 0) { preview.style.display = 'none'; return; }
      preview.style.display = 'block';
      const uid = window.currentUser?.uid;
      if (!uid) return;
      get(walletRef(uid)).then(snap => {
        const data = snap.exists() ? snap.val() : {};
        const completed = data.completed_orders || 0;
        const tier = getTier(completed);
        const bal = (data.balance || 0) + amount;
        const commission = Math.round(amount * tier.rate);
        const after = bal - commission;
        document.getElementById('cp-order-price').textContent = toArabicNum(amount) + ' ج';
        document.getElementById('cp-rate').textContent = (tier.rate * 100) + '%';
        document.getElementById('cp-commission').textContent = toArabicNum(commission) + ' ج';
        document.getElementById('cp-after').textContent = toArabicNum(Math.max(0, after)) + ' ج';
      });
    }

    // ===== Deposit =====
    // ===== Kashier Integration =====
    const KASHIER_MERCHANT_ID = 'MID-46330-772';
    const KASHIER_MODE = 'test'; // 'test' or 'live'
    const KASHIER_SECRET = '5ef015b930feabfe08eb4a09f5a8e06b$ac90a6461f8fa1db2fdb70beb393b1771ac0fbd68bfb60374a7df319908d9d3f67157c215fc72cd02b19e38af0c4d1f1';

    async function generateKashierHash(merchantId, orderId, amount, currency) {
      // حساب HMAC-SHA256 في المتصفح مباشرة بدون سيرفر خارجي
      const message = `?merchantId=${merchantId}&orderId=${orderId}&amount=${amount}&currency=${currency}&mode=${KASHIER_MODE}`;
      const encoder = new TextEncoder();
      const keyData = encoder.encode(KASHIER_SECRET);
      const msgData = encoder.encode(message);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
      return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    window.selectQuickAmount = function (amount, btn) {
      document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDepositAmount = amount;
      const inp = document.getElementById('wallet-deposit-input');
      if (inp) inp.value = amount;
      const preview = document.getElementById('kashier-amount-preview');
      const val = document.getElementById('kashier-amount-val');
      if (preview) preview.style.display = 'flex';
      if (val) val.textContent = amount.toLocaleString('ar-EG') + ' ج';
    };

    window.onDepositInputChange = function (v) {
      document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('selected'));
      selectedDepositAmount = parseFloat(v) || 0;
      const preview = document.getElementById('kashier-amount-preview');
      const val = document.getElementById('kashier-amount-val');
      if (preview) preview.style.display = selectedDepositAmount > 0 ? 'flex' : 'none';
      if (val) val.textContent = selectedDepositAmount.toLocaleString('ar-EG') + ' ج';
    };

    window.goToKashier = async function () {
      if (!window.currentUser) { showToast('سجّل دخولك الأول', '#E74C3C'); return; }
      const amount = selectedDepositAmount;
      if (!amount || amount < 10) { showToast('اختار مبلغ صحيح (10 ج على الأقل)', '#E74C3C'); return; }

      const uid = window.currentUser.uid;
      const workerName = window.currentProfile?.full_name || 'صنايعي';
      // Generate unique order ID
      const orderId = 'W-' + uid.slice(0, 8) + '-' + Date.now();
      const currency = 'EGP';
      // Format amount to 2 decimal places (Kashier requirement)
      const amountFormatted = parseFloat(amount).toFixed(2);

      // Save pending payment in Firebase so admin can see it
      try {
        await set(ref(db, 'wallet_pending/' + orderId), {
          uid: uid,
          worker_name: workerName,
          amount: amount,
          order_id: orderId,
          status: 'pending',
          created_at: new Date().toISOString()
        });
      } catch (e) { console.error('Firebase save error:', e); }

      // Build Kashier payment URL with hash
      const returnUrl = window.location.href.split('?')[0] + '?wallet_return=1&order=' + orderId;
      const failureUrl = window.location.href.split('?')[0] + '?wallet_fail=1&order=' + orderId;
      const description = 'شحن محفظة صنايعي - ' + workerName;

      let hash = '';
      try {
        hash = await generateKashierHash(KASHIER_MERCHANT_ID, orderId, amountFormatted, currency);
      } catch (e) { console.error('Hash error:', e); showToast('❌ خطأ في الاتصال بسيرفر الدفع', '#E74C3C'); return; }

      // Kashier checkout URL (الصيغة الرسمية)
      const params = new URLSearchParams({
        merchantId: KASHIER_MERCHANT_ID,
        orderId: orderId,
        amount: amountFormatted,
        currency: currency,
        hash: hash,
        merchantRedirect: returnUrl,
        failureRedirect: failureUrl,
        description: description,
        display: 'en',
        mode: KASHIER_MODE,
        metaData: JSON.stringify({ uid, amount }),
      });
      const kashierUrl = 'https://checkout.kashier.io/?' + params.toString();

      // Show pending notice
      const notice = document.getElementById('wallet-pending-notice');
      const noticeText = document.getElementById('wallet-pending-text');
      if (notice) { notice.style.display = 'block'; }
      if (noticeText) noticeText.textContent = 'طلب شحن ' + amount + ' ج — رقم العملية: ' + orderId + ' — جاري تحويلك لكاشير...';

      showToast('🔄 جاري تحويلك لصفحة الدفع...', '#3498DB');
      setTimeout(() => { window.open(kashierUrl, '_blank'); }, 800);
    };

    // Check if returned from Kashier
    window.checkKashierReturn = function () {
      const params = new URLSearchParams(window.location.search);
      if (params.get('wallet_return') === '1') {
        const orderId = params.get('order');
        showToast('✅ تم الدفع! الأدمن هيضيفلك الرصيد قريباً', '#2ECC71', 5000);
        // Clean URL
        history.replaceState({}, '', window.location.pathname);
        if (typeof showPage === 'function') setTimeout(() => showPage('wallet'), 500);
      } else if (params.get('wallet_fail') === '1') {
        showToast('❌ لم يتم إتمام الدفع — حاول تاني', '#E74C3C', 5000);
        history.replaceState({}, '', window.location.pathname);
        if (typeof showPage === 'function') setTimeout(() => showPage('wallet'), 500);
      }
    };
    setTimeout(window.checkKashierReturn, 1000);

    // ===== Commission Simulation (مع العروض) =====
    window.simulateCommission = async function () {
      const price = parseFloat(document.getElementById('sim-order-price')?.value);
      const result = document.getElementById('sim-result');
      if (!result) return;
      if (!price || price <= 0) { result.style.display = 'none'; return; }
      const uid = window.currentUser?.uid;
      let comm, rateLabel, promoLabel = null;
      if (uid) {
        try {
          const snap = await get(walletRef(uid));
          const data = snap.exists() ? snap.val() : {};
          const promoResult = await getEffectiveCommission(uid, price, data.completed_orders || 0);
          comm = promoResult.commission;
          rateLabel = (promoResult.rate * 100) + '%';
          promoLabel = promoResult.promo ? promoResult.label : null;
        } catch (e) {
          const tier = getTier(0);
          comm = Math.round(price * tier.rate);
          rateLabel = (tier.rate * 100) + '%';
        }
      } else {
        const tier = getTier(0);
        comm = Math.round(price * tier.rate);
        rateLabel = (tier.rate * 100) + '%';
      }
      document.getElementById('sim-rate').textContent = promoLabel ? promoLabel : rateLabel;
      document.getElementById('sim-commission').textContent = toArabicNum(comm) + ' ج';
      document.getElementById('sim-net').textContent = toArabicNum(price - comm) + ' ج';
      // لو فيه عرض — لوّن الخصم باللون الأخضر
      const commEl = document.getElementById('sim-commission');
      if (commEl) commEl.style.color = promoLabel ? '#2ECC71' : '#E74C3C';
      result.style.display = 'block';
    };

    // ===== Tab Switching =====
    window.switchWalletTab = function (tab, btn) {
      document.querySelectorAll('.wallet-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.wallet-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const el = document.getElementById('wtab-' + tab);
      if (el) el.classList.add('active');
    };

    // ===== Auto-deduct commission when order is marked done =====
    // Hook into clientConfirmDone — wrap the original
    const _origClientConfirmDone = window.clientConfirmDone;
    window.clientConfirmDone = async function (confirmed, directOrderNum) {
      // Capture order number BEFORE running original (which clears the var)
      const orderNum = directOrderNum || window._confirmDoneOrderNum || window._lastConfirmDoneOrderNum;
      // Run original first
      if (_origClientConfirmDone) await _origClientConfirmDone(confirmed, directOrderNum);
      // If confirmed, deduct commission from WORKER wallet
      if (confirmed) {
        if (!orderNum) return;
        try {
          const snap = await get(ref(db, 'service_requests/' + orderNum));
          if (!snap.exists()) return;
          const order = snap.val();
          // منع الخصم المزدوج
          if (order.commission_deducted) return;
          const workerUid = order.worker_id;
          if (!workerUid) return;
          const price = parseFloat(order.final_price || order.budget || order.price || 0);
          if (!price) return;
          // سجّل إن العمولة اتخصمت قبل ما ننفذ الخصم
          await update(ref(db, 'service_requests/' + orderNum), { commission_deducted: true });
          const wSnap = await get(walletRef(workerUid));
          const wData = wSnap.exists() ? wSnap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
          const completed = (wData.completed_orders || 0) + 1;
          // ✅ احسب العمولة مع مراعاة العروض (أول طلب بلاش، أول شهر 5%)
          const promoResult = await getEffectiveCommission(workerUid, price, wData.completed_orders || 0);
          const commission = promoResult.commission;
          const newBal = Math.max(0, (wData.balance || 0) - commission);
          const newDed = (wData.total_deducted || 0) + commission;
          await set(walletRef(workerUid), { ...wData, balance: newBal, total_deducted: newDed, completed_orders: completed });
          await push(walletTxnRef(workerUid), {
            type: 'commission',
            amount: commission,
            description: promoResult.promo === 'first_order'
              ? '🎁 أول طلب مجاناً — طلب #' + orderNum
              : promoResult.promo === 'first_month'
                ? '🌟 عرض الشهر الأول (5%) — طلب #' + orderNum + ' (' + (order.service_type || '') + ')'
                : 'عمولة طلب #' + orderNum + ' (' + (order.service_type || '') + ')',
            order_num: orderNum,
            rate: promoResult.rate,
            order_price: price,
            promo: promoResult.promo || null,
            created_at: new Date().toISOString()
          });
          // Notify worker
          const notifBody = promoResult.promo === 'first_order'
            ? '🎁 أول طلب مجاناً! مفيش عمولة على طلب #' + orderNum + '. رصيدك: ' + newBal + ' ج'
            : promoResult.promo === 'first_month'
              ? '🌟 عرض الشهر الأول: طلب #' + orderNum + ' — سعر ' + price + ' ج × 5% = ' + commission + ' ج. رصيدك: ' + newBal + ' ج'
              : 'طلب #' + orderNum + ' — سعر ' + price + ' ج × ' + (promoResult.rate * 100) + '% = ' + commission + ' ج. رصيدك الجديد: ' + newBal + ' ج';
          await push(ref(db, 'notifications/' + workerUid), {
            type: 'wallet_deduction',
            title: promoResult.promo === 'first_order' ? '🎁 أول طلب مجاناً!' : '💳 تم خصم عمولة من محفظتك',
            body: notifBody,
            read: false,
            created_at: new Date().toISOString()
          });
          // Refresh wallet page if open
          if (document.getElementById('page-wallet')?.classList.contains('active')) loadWallet();
        } catch (e) { console.error('Wallet deduction error:', e); }
      }
    };

    // Also hook workerConfirmClientDone
    const _origWorkerConfirmClientDone = window.workerConfirmClientDone;
    window.workerConfirmClientDone = async function (orderNum) {
      if (_origWorkerConfirmClientDone) await _origWorkerConfirmClientDone(orderNum);
      // Commission deducted from worker (current user)
      if (!window.currentUser) return;
      try {
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (!snap.exists()) return;
        const order = snap.val();
        // منع الخصم المزدوج
        if (order.commission_deducted) return;
        // worker_id من الطلب أو من currentUser (لأن الصنايعي هو اللي أكد)
        const workerUid = order.worker_id || window.currentUser.uid;
        const price = parseFloat(order.final_price || order.budget || order.price || 0);
        if (!price) return;
        // سجّل إن العمولة اتخصمت قبل ما ننفذ الخصم
        await update(ref(db, 'service_requests/' + orderNum), { commission_deducted: true });
        const wSnap = await get(walletRef(workerUid));
        const wData = wSnap.exists() ? wSnap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
        const completed = (wData.completed_orders || 0) + 1;
        // ✅ احسب العمولة مع مراعاة العروض (أول طلب بلاش، أول شهر 5%)
        const promoResult = await getEffectiveCommission(workerUid, price, wData.completed_orders || 0);
        const commission = promoResult.commission;
        const newBal = Math.max(0, (wData.balance || 0) - commission);
        const newDed = (wData.total_deducted || 0) + commission;
        await set(walletRef(workerUid), { ...wData, balance: newBal, total_deducted: newDed, completed_orders: completed });
        await push(walletTxnRef(workerUid), {
          type: 'commission', amount: commission,
          description: promoResult.promo === 'first_order'
            ? '🎁 أول طلب مجاناً — طلب #' + orderNum
            : promoResult.promo === 'first_month'
              ? '🌟 عرض الشهر الأول (5%) — طلب #' + orderNum + ' (' + (order.service_type || '') + ')'
              : 'عمولة طلب #' + orderNum + ' (' + (order.service_type || '') + ')',
          order_num: orderNum, rate: promoResult.rate, order_price: price,
          promo: promoResult.promo || null,
          created_at: new Date().toISOString()
        });
        const toastMsg = promoResult.promo === 'first_order'
          ? '🎁 أول طلب مجاناً — مفيش عمولة!'
          : promoResult.promo === 'first_month'
            ? '🌟 عرض الشهر الأول: تم خصم ' + commission + ' ج فقط (5%)'
            : '💳 تم خصم عمولة ' + commission + ' ج من محفظتك';
        showToast(toastMsg, promoResult.promo ? '#2ECC71' : '#C8873A');
        if (document.getElementById('page-wallet')?.classList.contains('active')) loadWallet();
      } catch (e) { console.error('Wallet deduction error:', e); }
    };

    // ===== Hook into showPage to load wallet data =====
    const _origShowPage = window.showPage;
    window.showPage = async function (name) {
      if (_origShowPage) await _origShowPage(name);
      if (name === 'wallet') {
        if (window.currentUser) loadWallet();
        else showToast('سجّل دخولك عشان تشوف محفظتك', '#E74C3C');
      }
    };

    // ===== ADMIN WALLET FUNCTIONS =====
    window.adminOpenWallet = async function (uid, name) {
      // Build modal
      let modal = document.getElementById('admin-wallet-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-wallet-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        modal.innerHTML = `
        <div style="background:#1C1A17;border:1.5px solid rgba(200,135,58,0.4);border-radius:20px;padding:2rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
            <div style="font-size:18px;font-weight:900;">💳 محفظة الصنايعي</div>
            <button onclick="document.getElementById('admin-wallet-modal').style.display='none'" style="background:rgba(255,255,255,0.07);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <div id="adm-wallet-name" style="font-size:14px;color:var(--gold);font-weight:700;margin-bottom:1rem;"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:1.5rem;">
            <div style="background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.25);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:22px;font-weight:900;color:var(--gold);" id="adm-wallet-bal">—</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);">الرصيد الحالي</div>
            </div>
            <div style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.2);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:22px;font-weight:900;color:#2ECC71;" id="adm-wallet-orders">—</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);">طلبات منجزة</div>
            </div>
          </div>
          <div style="margin-bottom:1rem;">
            <label style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px;">إضافة رصيد يدوي (بعد تأكيد الدفع من كاشير)</label>
            <input type="number" id="adm-wallet-add-amount" placeholder="المبلغ بالجنيه" min="1"
              style="width:100%;padding:12px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:#111;color:#fff;font-family:Cairo,sans-serif;font-size:16px;font-weight:700;outline:none;margin-bottom:8px;">
            <input type="text" id="adm-wallet-add-note" placeholder="ملاحظة (مثال: دفعة كاشير #12345)" 
              style="width:100%;padding:10px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:#111;color:#fff;font-family:Cairo,sans-serif;font-size:13px;outline:none;">
          </div>
          <button id="adm-wallet-add-btn" onclick="adminAddWalletBalance()"
            style="width:100%;padding:14px;background:var(--gold);color:#1C1A17;border:none;border-radius:12px;font-size:15px;font-weight:800;font-family:Cairo,sans-serif;cursor:pointer;margin-bottom:1rem;">
            ✅ إضافة الرصيد
          </button>
          <div id="adm-wallet-txns" style="margin-top:1rem;"></div>
        </div>`;
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      modal._uid = uid;
      document.getElementById('adm-wallet-name').textContent = '👷 ' + name;

      // Load wallet data
      const snap = await get(walletRef(uid));
      const data = snap.exists() ? snap.val() : { balance: 0, completed_orders: 0 };
      document.getElementById('adm-wallet-bal').textContent = (data.balance || 0).toLocaleString('ar-EG') + ' ج';
      document.getElementById('adm-wallet-orders').textContent = data.completed_orders || 0;

      // Load transactions
      const txSnap = await get(walletTxnRef(uid));
      const txContainer = document.getElementById('adm-wallet-txns');
      if (txSnap.exists()) {
        const txns = [];
        txSnap.forEach(c => txns.push(c.val()));
        txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        txContainer.innerHTML = '<div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);margin-bottom:8px;">آخر المعاملات</div>' +
          txns.slice(0, 10).map(tx => {
            const isPlus = tx.type === 'deposit';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);margin-bottom:6px;font-size:12px;">
            <div>
              <div style="font-weight:700;margin-bottom:1px;">${tx.description || (isPlus ? 'إيداع' : 'عمولة')}</div>
              <div style="color:rgba(255,255,255,0.3);">${tx.created_at ? new Date(tx.created_at).toLocaleDateString('ar-EG') : ''}</div>
            </div>
            <div style="font-weight:900;font-size:14px;color:${isPlus ? '#2ECC71' : '#E74C3C'}">${isPlus ? '+' : '-'}${tx.amount} ج</div>
          </div>`;
          }).join('');
      } else {
        txContainer.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:13px;padding:10px;">لا يوجد معاملات</div>';
      }
    };

    window.adminAddWalletBalance = async function () {
      const modal = document.getElementById('admin-wallet-modal');
      const uid = modal?._uid;
      if (!uid) return;
      const amount = parseFloat(document.getElementById('adm-wallet-add-amount')?.value);
      const note = document.getElementById('adm-wallet-add-note')?.value || 'إيداع يدوي من الأدمن';
      if (!amount || amount <= 0) { showToast('أدخل مبلغ صحيح', '#E74C3C'); return; }
      try {
        const snap = await get(walletRef(uid));
        const data = snap.exists() ? snap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
        const newBal = (data.balance || 0) + amount;
        const newDep = (data.total_deposited || 0) + amount;
        await set(walletRef(uid), { ...data, balance: newBal, total_deposited: newDep });
        await push(walletTxnRef(uid), {
          type: 'deposit', amount,
          description: note,
          added_by: 'admin',
          created_at: new Date().toISOString()
        });
        // Notify worker
        await push(ref(db, 'notifications/' + uid), {
          type: 'wallet_deposit',
          title: '💳 تم إضافة رصيد لمحفظتك!',
          body: 'تم إضافة ' + amount + ' ج — رصيدك الجديد: ' + newBal + ' ج',
          read: false,
          created_at: new Date().toISOString()
        });
        document.getElementById('adm-wallet-bal').textContent = newBal.toLocaleString('ar-EG') + ' ج';
        document.getElementById('adm-wallet-add-amount').value = '';
        document.getElementById('adm-wallet-add-note').value = '';
        showToast('✅ تم إضافة ' + amount + ' ج بنجاح', '#2ECC71');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ', '#E74C3C'); }
    };

    // ===== ADMIN PENDING PAYMENTS PANEL =====
    window.loadAdminPendingPayments = async function () {
      const container = document.getElementById('adm-pending-payments');
      if (!container) return;
      const snap = await get(ref(db, 'wallet_pending'));
      if (!snap.exists()) {
        container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;font-size:13px;">لا يوجد طلبات شحن معلقة</div>';
        return;
      }
      const items = [];
      snap.forEach(c => items.push({ key: c.key, ...c.val() }));
      items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      container.innerHTML = items.map(p => `
      <div style="background:rgba(255,255,255,0.04);border:1px solid ${p.status === 'confirmed' ? 'rgba(46,204,113,0.3)' : 'rgba(230,126,34,0.3)'};border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;">
          <div style="font-weight:800;font-size:14px;margin-bottom:3px;">👷 ${p.worker_name || '—'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);">رقم العملية: ${p.order_id}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.4);">${p.created_at ? new Date(p.created_at).toLocaleString('ar-EG') : ''}</div>
        </div>
        <div style="font-size:22px;font-weight:900;color:var(--gold);">${(p.amount || 0).toLocaleString('ar-EG')} ج</div>
        <div>
          ${p.status === 'confirmed'
          ? '<span style="font-size:12px;padding:4px 12px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.3);border-radius:20px;color:#2ECC71;font-weight:700;">✅ تم التأكيد</span>'
          : `<button onclick="adminConfirmPayment('${p.key}','${p.uid}',${p.amount},'${p.worker_name || ''}')"
                style="padding:8px 16px;background:var(--gold);color:#1C1A17;border:none;border-radius:10px;font-size:13px;font-weight:800;font-family:Cairo,sans-serif;cursor:pointer;">
                ✅ تأكيد وإضافة رصيد
              </button>`}
        </div>
      </div>`).join('');
    };

    window.adminConfirmPayment = async function (key, uid, amount, workerName) {
      if (!confirm('تأكيد إضافة ' + amount + ' ج لمحفظة ' + workerName + '؟')) return;
      try {
        // Add to wallet
        const snap = await get(walletRef(uid));
        const data = snap.exists() ? snap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
        const newBal = (data.balance || 0) + amount;
        await set(walletRef(uid), { ...data, balance: newBal, total_deposited: (data.total_deposited || 0) + amount });
        await push(walletTxnRef(uid), {
          type: 'deposit', amount,
          description: 'شحن عبر كاشير — مؤكد من الأدمن',
          added_by: 'admin', kashier_key: key,
          created_at: new Date().toISOString()
        });
        // Mark as confirmed
        await update(ref(db, 'wallet_pending/' + key), { status: 'confirmed', confirmed_at: new Date().toISOString() });
        // Notify worker
        await push(ref(db, 'notifications/' + uid), {
          type: 'wallet_deposit',
          title: '🎉 تم شحن محفظتك!',
          body: 'تم إضافة ' + amount + ' ج لمحفظتك بعد تأكيد الدفع — رصيدك الجديد: ' + newBal + ' ج',
          read: false, created_at: new Date().toISOString()
        });
        showToast('✅ تم تأكيد الدفع وإضافة الرصيد', '#2ECC71');
        loadAdminPendingPayments();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ', '#E74C3C'); }
    };

  })();
  // ==================== END WALLET SYSTEM ====================