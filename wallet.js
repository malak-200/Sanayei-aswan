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

    async function getEffectiveCommission(workerUid, price, completedOrders, overrideRate, overrideAmount) {
      // ⓪ لو الإدارة حددت مبلغ ثابت بالجنيه لهذا الطلب — تبقى هي الأساس، فوق أي حاجة تانية
      if (typeof overrideAmount === 'number' && !isNaN(overrideAmount) && overrideAmount >= 0) {
        const commission = Math.round(overrideAmount);
        return { commission, rate: price > 0 ? +(overrideAmount / price).toFixed(4) : 0, label: '🛠️ مبلغ محدد يدويًا من الإدارة', promo: 'admin_manual_amount' };
      }
      // ⓪ لو الإدارة حددت نسبة يدوية لهذا الطلب بالذات وقت ما حولته للصنايعي — تبقى هي الأساس، ومفيش حساب تلقائي
      if (typeof overrideRate === 'number' && !isNaN(overrideRate) && overrideRate >= 0) {
        const commission = Math.round(price * overrideRate);
        return { commission, rate: overrideRate, label: '🛠️ نسبة محددة يدويًا من الإدارة', promo: 'admin_manual' };
      }

      const now = Date.now();

      // ① جيب العروض الفعّالة من Firebase
      let activePromo = null;
      try {
        const promosSnap = await get(ref(db, 'promos'));
        if (promosSnap.exists()) {
          const promosData = promosSnap.val();
          Object.values(promosData).forEach(p => {
            if (p.active && new Date(p.start_at) <= now && new Date(p.end_at) >= now) {
              // FIX #9: لو في أكتر من عرض نشط، ناخد اللي بيوفّر الأقل نسبة على الصنايعي
              if (!activePromo || (p.rate < activePromo.rate)) {
                activePromo = p;
              }
            }
          });
        }
      } catch (e) { console.error('Promo fetch error:', e); }

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
    // ✅ expose globally so order-completion scripts can call them
    window.getEffectiveCommission = getEffectiveCommission;
    window.getTier = getTier;

    // ===== Load wallet data =====
    async function loadWallet() {
      if (!window.currentUser) return;
      const uid = window.currentUser.uid;
      const snap = await get(walletRef(uid));
      const data = snap.exists() ? snap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };

      // ✅ FIX: مزامنة completed_orders من الطلبات الفعلية
      // لو الرقم المحفوظ أقل من الطلبات الفعلية، حدّثه
      try {
        const ordersSnap = await get(ref(db, 'service_requests'));
        if (ordersSnap.exists()) {
          let actualCompleted = 0;
          ordersSnap.forEach(child => {
            const o = child.val();
            if (o.status === 'done' && o.worker_id === uid) actualCompleted++;
          });
          if (actualCompleted > (data.completed_orders || 0)) {
            data.completed_orders = actualCompleted;
            await set(walletRef(uid), { ...data, completed_orders: actualCompleted });
            await update(ref(db, 'craftsmen/' + uid), { available: (data.balance || 0) > 0 }); // يتخفى أوتوماتيك لو رصيده صفر
          }
        }
      } catch (e) { console.error('Sync completed_orders error:', e); }

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
      const pendingDebt = data.pending_commission_debt || 0;
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

      // ===== عرض الدين المعلق =====
      let debtBanner = document.getElementById('wallet-debt-banner');
      if (pendingDebt > 0) {
        if (!debtBanner) {
          debtBanner = document.createElement('div');
          debtBanner.id = 'wallet-debt-banner';
          debtBanner.style.cssText = 'margin:1rem 0;padding:14px 16px;border-radius:14px;background:rgba(230,126,34,0.12);border:1.5px solid rgba(230,126,34,0.45);display:flex;align-items:center;gap:12px;font-size:13px;font-weight:700;';
          // أضفه بعد كارت الرصيد مباشرة
          const balCard = document.getElementById('wallet-balance-card');
          if (balCard && balCard.parentNode) balCard.parentNode.insertBefore(debtBanner, balCard.nextSibling);
        }
        debtBanner.innerHTML = `
          <span style="font-size:22px;">⚠️</span>
          <div style="flex:1;">
            <div style="color:#E67E22;font-size:14px;font-weight:900;margin-bottom:3px;">عمولة متأخرة — ${toArabicNum(pendingDebt)} ج</div>
            <div style="color:rgba(255,255,255,0.55);font-size:12px;font-weight:600;">هيتخصم أوتوماتيك من أول شحنة تعملها 💳</div>
          </div>`;
        debtBanner.style.display = 'flex';
      } else if (debtBanner) {
        debtBanner.style.display = 'none';
      }

      // Low balance warning — يظهر لو الرصيد صفر (مش 50)
      const warn = document.getElementById('wallet-low-warning');
      if (warn) warn.style.display = bal <= 0 ? 'flex' : 'none';

      // Stats
      const sOrders = document.getElementById('wallet-stat-orders');
      if (sOrders) sOrders.textContent = toArabicNum(completed);
      const sCom = document.getElementById('wallet-stat-commission');
      if (sCom) sCom.textContent = (Math.round(tier.rate * 100)) + '%';
      const sNext = document.getElementById('wallet-stat-next');
      if (sNext) sNext.textContent = nextTier ? toArabicNum(nextIn) + ' طلب' : '🏆 أعلى مستوى';

      // Color balance card based on balance
      const card = document.getElementById('wallet-balance-card');
      if (card) {
        if (bal <= 0) {
          card.style.borderColor = 'rgba(192,57,43,0.5)';
          card.style.background = 'linear-gradient(135deg, rgba(192,57,43,0.15) 0%, rgba(139,0,0,0.1) 100%)';
        } else if (bal < 30) {
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
      const raw = snap.val();
      const items = Object.entries(raw).map(([key, val]) => ({ key, ...val }));
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
    window.loadWallet = loadWallet;

    // ===== Quick Amount Selection =====
    let selectedDepositAmount = 0;
    window.selectQuickAmount = function (amount, btn) {
      document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDepositAmount = amount;
      const inp = document.getElementById('wallet-deposit-input');
      if (inp) inp.value = amount;
      // Update kashier preview panel
      const preview = document.getElementById('kashier-amount-preview');
      const val = document.getElementById('kashier-amount-val');
      if (preview) preview.style.display = 'flex';
      if (val) val.textContent = amount.toLocaleString('ar-EG') + ' ج';
      updateCommissionPreview(amount);
    };

    window.onDepositInputChange = function (val) {
      document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('selected'));
      selectedDepositAmount = parseFloat(val) || 0;
      // Update kashier preview panel
      const preview = document.getElementById('kashier-amount-preview');
      const kval = document.getElementById('kashier-amount-val');
      if (preview) preview.style.display = selectedDepositAmount > 0 ? 'flex' : 'none';
      if (kval) kval.textContent = selectedDepositAmount.toLocaleString('ar-EG') + ' ج';
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

    // (duplicate selectQuickAmount / onDepositInputChange removed — defined above with updateCommissionPreview)

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
          rateLabel = (Math.round(promoResult.rate * 100)) + '%';
          promoLabel = promoResult.promo ? promoResult.label : null;
        } catch (e) {
          const tier = getTier(0);
          comm = Math.round(price * tier.rate);
          rateLabel = (Math.round(tier.rate * 100)) + '%';
        }
      } else {
        const tier = getTier(0);
        comm = Math.round(price * tier.rate);
        rateLabel = (Math.round(tier.rate * 100)) + '%';
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

    // ===== ADMIN USER FULL DETAIL MODAL (worker or client) =====
    window.adminOpenUserDetail = async function (uid, role, name) {
      let modal = document.getElementById('admin-user-detail-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-user-detail-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        modal.innerHTML = `
        <div style="background:#1C1A17;border:1.5px solid rgba(52,152,219,0.4);border-radius:20px;padding:2rem;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
            <div id="aud-title" style="font-size:18px;font-weight:900;">👁 تفصيل الحساب</div>
            <button onclick="document.getElementById('admin-user-detail-modal').style.display='none'" style="background:rgba(255,255,255,0.07);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <div id="aud-body">جاري التحميل...</div>
        </div>`;
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      const body = document.getElementById('aud-body');
      document.getElementById('aud-title').textContent = (role === 'worker' ? '👷 ' : '👤 ') + (name || 'تفصيل الحساب');
      body.innerHTML = 'جاري التحميل...';

      // كل خطوة معزولة بمحاولة/استثناء منفصلة عشان فشل جزء واحد ما يكسرش الباقي
      let profile = {}, craftsman = {}, wallet = {}, allOrders = [], allMarketOrders = [];
      try {
        const profSnap = await get(ref(db, 'profiles/' + uid));
        profile = (profSnap.exists() && typeof profSnap.val() === 'object' && profSnap.val()) ? profSnap.val() : {};
      } catch (e) { console.error('profile load error:', e); }

      if (role === 'worker') {
        try {
          const cSnap = await get(ref(db, 'craftsmen/' + uid));
          craftsman = (cSnap.exists() && typeof cSnap.val() === 'object' && cSnap.val()) ? cSnap.val() : {};
        } catch (e) { console.error('craftsman load error:', e); }
        try {
          const wSnap = await get(walletRef(uid));
          wallet = (wSnap.exists() && typeof wSnap.val() === 'object' && wSnap.val()) ? wSnap.val() : {};
        } catch (e) { console.error('wallet load error:', e); }
      }

      try {
        const ordersSnap = await get(ref(db, 'service_requests'));
        if (ordersSnap.exists()) {
          ordersSnap.forEach(c => {
            const v = c.val();
            if (v && typeof v === 'object') allOrders.push(v);
          });
        }
      } catch (e) { console.error('orders load error:', e); }

      // طلبات السوق — نجيبها للصنايعي بس
      if (role === 'worker') {
        try {
          const crSnap = await get(ref(db, 'client_requests'));
          if (crSnap.exists()) {
            Object.entries(crSnap.val()).forEach(([id, r]) => {
              if (r && r.accepted_worker_id === uid) allMarketOrders.push({ ...r, id, _isMarket: true });
            });
          }
        } catch (e) { console.error('market orders load error:', e); }
      }

      try {
        // عدد ميلي ثانية الافتراضي لو التاريخ غير صالح، عشان الترتيب ما يكسرش
        const safeTime = (d) => { const t = new Date(d).getTime(); return Number.isFinite(t) ? t : 0; };

        const userDirectOrders = allOrders
          .filter(o => o && (role === 'worker' ? o.worker_id === uid : o.user_id === uid))
          .sort((a, b) => safeTime(b.created_at) - safeTime(a.created_at));

        // دمج الطلبات المباشرة وطلبات السوق (للصنايعي بس)
        const userOrders = role === 'worker'
          ? [...userDirectOrders, ...allMarketOrders].sort((a, b) => safeTime(b.created_at) - safeTime(a.created_at))
          : userDirectOrders;

        // استخراج آمن لقائمة التقييمات — بيتعامل مع object أو array وبيشيل أي عنصر فاضي/تالف
        const extractRatings = (src) => {
          if (!src || typeof src !== 'object') return [];
          return Object.values(src).filter(r => r && typeof r === 'object');
        };
        let ratingsList = role === 'worker' ? extractRatings(craftsman.ratings_list) : extractRatings(profile.ratings_list);
        ratingsList = ratingsList.sort((a, b) => safeTime(b.created_at) - safeTime(a.created_at));

        const completedCount = userOrders.filter(o => o.status === 'done' || o.status === 'pending_client_confirm').length;
        const cancelledCount = userOrders.filter(o => o.status === 'cancelled').length;
        const directCount = userDirectOrders.length;
        const marketCount = allMarketOrders.length;

        const esc = (v) => (v === null || v === undefined) ? '' : String(v);
        const safeDate = (d) => { const t = new Date(d); return Number.isFinite(t.getTime()) ? t.toLocaleDateString('ar-EG') : ''; };

        const infoRow = (icon, label, val) => val ? `
        <div style="display:flex;gap:10px;align-items:flex-start;background:rgba(255,255,255,0.04);border-radius:10px;padding:10px 12px;">
          <span style="font-size:15px;flex-shrink:0;">${icon}</span>
          <div><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:2px;">${label}</div>
          <div style="font-size:13px;color:#fff;font-weight:600;">${esc(val)}</div></div>
        </div>` : '';

        const statBox = (val, label, color) => `
        <div style="background:${color}15;border:1px solid ${color}35;border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:900;color:${color};">${esc(val)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);">${label}</div>
        </div>`;

        const walletBal = Number.isFinite(Number(wallet.balance)) ? Number(wallet.balance) : 0;
        const walletDebt = Number.isFinite(Number(wallet.pending_commission_debt)) ? Number(wallet.pending_commission_debt) : 0;
        const walletBalanceTxt = walletBal.toLocaleString('ar-EG') + ' ج';
        const walletDebtTxt = walletDebt > 0 ? walletDebt.toLocaleString('ar-EG') + ' ج' : null;

        const ordersBreakdown = role === 'worker' && marketCount > 0
          ? `<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px;">${directCount} مباشر + ${marketCount} سوق</div>`
          : '';

        const statsHTML = role === 'worker'
          ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:14px 0;">
              <div style="background:#3498DB15;border:1px solid #3498DB35;border-radius:10px;padding:10px;text-align:center;">
                <div style="font-size:18px;font-weight:900;color:#3498DB;">${userOrders.length}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.4);">إجمالي الطلبات</div>
                ${ordersBreakdown}
              </div>
              ${statBox(completedCount, 'منجزة', '#2ECC71')}
              <div style="background:#C8873A15;border:1px solid #C8873A35;border-radius:10px;padding:10px;text-align:center;">
                <div style="font-size:18px;font-weight:900;color:#C8873A;">${walletBalanceTxt}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.4);">رصيد المحفظة</div>
                ${walletDebtTxt ? `<div style="font-size:10px;color:#E74C3C;font-weight:700;margin-top:2px;">دين: ${walletDebtTxt}</div>` : ''}
              </div>
              ${statBox(craftsman.rating || craftsman.avg_rating || '—', 'التقييم', '#9B59B6')}
            </div>`
          : `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;">
              ${statBox(userOrders.length, 'إجمالي الطلبات', '#3498DB')}
              ${statBox(completedCount, 'منجزة', '#2ECC71')}
              ${statBox(cancelledCount, 'ملغية', '#E74C3C')}
            </div>`;

        const ordersHTML = userOrders.length ? `
        <div style="font-size:13px;font-weight:800;color:var(--gold);margin:16px 0 8px;">📋 الطلبات (${userOrders.length})</div>
        ${userOrders.slice(0, 25).map(o => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:9px;padding:9px 12px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-size:12px;font-weight:700;">${esc(o._isMarket ? (o.service || o.title || 'طلب سوق') : (o.service_type || 'خدمة'))} ${o._isMarket ? '<span style="background:rgba(155,89,182,0.2);color:#9B59B6;border-radius:4px;padding:1px 5px;font-size:10px;">🏪 سوق</span>' : ''} <span style="color:rgba(255,255,255,0.3);">#${esc(o.order_number || o.id)}</span></div>
              <div style="font-size:10px;color:rgba(255,255,255,0.35);">${esc(role === 'worker' ? (o.user_name || o.client_name || '—') : (o.worker_name || '—'))} · ${o.created_at ? safeDate(o.created_at) : ''}</div>
            </div>
            <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:14px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);">${esc(o.status) || '—'}</span>
          </div>`).join('')}
        ${userOrders.length > 25 ? `<div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.3);">+${userOrders.length - 25} طلب إضافي</div>` : ''}` : '<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:12px;padding:10px;">لا يوجد طلبات</div>';

        const ratingsHTML = ratingsList.length ? `
        <div style="font-size:13px;font-weight:800;color:var(--gold);margin:16px 0 8px;">⭐ التقييمات (${ratingsList.length})</div>
        ${ratingsList.slice(0, 15).map(r => {
          const rawStars = Math.round(Number(r.stars));
          const stars = Number.isFinite(rawStars) ? Math.max(0, Math.min(5, rawStars)) : 0;
          return `
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:9px;padding:9px 12px;margin-bottom:7px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:12px;font-weight:700;">${esc(r.from_name) || '—'}</span>
              <span style="color:#C8873A;font-size:12px;">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
            </div>
            ${r.comment ? `<div style="font-size:11px;color:rgba(255,255,255,0.45);">${esc(r.comment)}</div>` : ''}
          </div>`;
        }).join('')}` : '';

        // قسم صور البطاقة (للصنايعي دايماً)
        let idCardHTML = '';
        if (role === 'worker') {
          const verified = profile.id_card_verified;
          const hasFront = !!profile.id_card_front;
          const hasBack = !!profile.id_card_back;
          const hasAny = hasFront || hasBack;
          const verifiedAt = profile.id_card_verified_at ? safeDate(profile.id_card_verified_at) : '';
          const verifiedBadge = verified === true
            ? '<span style="background:rgba(46,204,113,0.2);border:1px solid rgba(46,204,113,0.5);color:#2ECC71;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">✅ تم التحقق</span>'
            : hasAny
              ? '<span style="background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.4);color:#E74C3C;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">⏳ في انتظار المراجعة</span>'
              : '<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">لم يرفع بعد</span>';
          const frontImgHTML = hasFront
            ? '<img src="' + profile.id_card_front + '" style="width:100%;max-width:220px;border-radius:10px;border:1.5px solid rgba(200,135,58,0.35);cursor:pointer;display:block;" onclick="GLB.open(this.src)" title="اضغط لعرض كاملة">'
            : '<div style="width:100%;max-width:220px;height:80px;border-radius:10px;border:1.5px dashed rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-size:12px;">لم يرفع</div>';
          const backImgHTML = hasBack
            ? '<img src="' + profile.id_card_back + '" style="width:100%;max-width:220px;border-radius:10px;border:1.5px solid rgba(200,135,58,0.35);cursor:pointer;display:block;" onclick="GLB.open(this.src)" title="اضغط لعرض كاملة">'
            : '<div style="width:100%;max-width:220px;height:80px;border-radius:10px;border:1.5px dashed rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);font-size:12px;">لم يرفع</div>';
          const approveButtons = verified !== true
            ? '<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="adminVerifyIdCard(\'' + uid + '\', true)" style="flex:1;padding:9px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.4);color:#2ECC71;border-radius:10px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✅ قبول البطاقة</button><button onclick="adminVerifyIdCard(\'' + uid + '\', false)" style="flex:1;padding:9px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);color:#E74C3C;border-radius:10px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">❌ رفض البطاقة</button></div>'
            : '<div style="text-align:center;font-size:12px;color:#2ECC71;padding:4px;margin-top:6px;">✅ تم التحقق ' + (verifiedAt ? 'بتاريخ ' + verifiedAt : '') + '</div>';
          const imagesBlock = hasAny
            ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;"><div style="flex:1;min-width:130px;"><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:5px;">الوش</div>' + frontImgHTML + '</div><div style="flex:1;min-width:130px;"><div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:5px;">الضهر</div>' + backImgHTML + '</div></div>' + approveButtons
            : '<div style="text-align:center;padding:16px;color:rgba(255,255,255,0.3);font-size:12px;">⚠️ الصنايعي ده لم يرفع صور البطاقة بعد</div>';
          idCardHTML = '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;margin:16px 0;"><div style="font-size:13px;font-weight:800;color:var(--gold);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">🪪 البطاقة الشخصية ' + verifiedBadge + '</div>' + imagesBlock + '</div>';
        }

        body.innerHTML = `
        ${infoRow('📧', 'البريد الإلكتروني', profile.email)}
        ${infoRow('📞', 'رقم التليفون', profile.phone)}
        ${infoRow('📍', 'المنطقة', profile.area)}
        ${role === 'worker' ? infoRow('🔧', 'المهنة', profile.trade || craftsman.trade) : ''}
        ${infoRow('🕐', 'تاريخ التسجيل', profile.created_at ? safeDate(profile.created_at) : null)}
        ${role === 'worker' ? infoRow('✅', 'الحالة', craftsman.available ? 'متاح لاستقبال طلبات' : 'غير متاح') : ''}
        ${statsHTML}
        ${idCardHTML}
        ${ordersHTML}
        ${ratingsHTML}`;
      } catch (e) {
        console.error('adminOpenUserDetail render error:', e);
        body.innerHTML = '<div style="text-align:center;color:#E74C3C;padding:20px;">❌ حصل خطأ في عرض البيانات<br><span style="font-size:11px;color:rgba(255,255,255,0.4);direction:ltr;display:inline-block;margin-top:8px;">' + (e?.message || e) + '</span></div>';
      }
    };

    window.adminVerifyIdCard = async function (uid, approved) {
      const label = approved ? 'قبول وتفعيل' : 'رفض وإبقاء حساب غير نشط';
      if (!confirm('هتعمل ' + label + ' لحساب الصنايعي ده. متأكد؟')) return;
      try {
        // تحديث حالة التحقق في profile
        await update(ref(db, 'profiles/' + uid), {
          id_card_verified: approved,
          id_card_verified_at: new Date().toISOString()
        });
        // تفعيل أو تعطيل الحساب في craftsmen بناءً على القرار
        await update(ref(db, 'craftsmen/' + uid), {
          available: approved
        });
        showToast(approved ? '✅ تم قبول البطاقة وتفعيل الحساب' : '❌ تم رفض البطاقة - الحساب غير نشط', approved ? '#2ECC71' : '#E74C3C');
        // أعد تحميل نافذة التفاصيل عشان البادج يتحدث
        const titleEl = document.getElementById('aud-title');
        const currentName = titleEl?.textContent?.replace(/^[👷👤] /, '') || '';
        await window.adminOpenUserDetail(uid, 'worker', currentName);
      } catch (e) {
        showToast('حصل خطأ: ' + (e.message || e), '#E74C3C');
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
        const pendingDebt = data.pending_commission_debt || 0;
        let balAfterDeposit = (data.balance || 0) + amount;
        let debtDeducted = 0;
        if (pendingDebt > 0) {
          debtDeducted = Math.min(balAfterDeposit, pendingDebt);
          balAfterDeposit -= debtDeducted;
        }
        const newDebt = pendingDebt - debtDeducted;
        const newDep = (data.total_deposited || 0) + amount;
        await set(walletRef(uid), { ...data, balance: balAfterDeposit, total_deposited: newDep, total_deducted: (data.total_deducted || 0) + debtDeducted, pending_commission_debt: newDebt });
        await update(ref(db, 'craftsmen/' + uid), { available: balAfterDeposit > 0 }); // يظهر تاني لما يشحن
        await push(walletTxnRef(uid), {
          type: 'deposit', amount,
          description: note,
          added_by: 'admin',
          created_at: new Date().toISOString()
        });
        if (debtDeducted > 0) {
          await push(walletTxnRef(uid), {
            type: 'commission', amount: debtDeducted,
            description: 'خصم عمولة متأخرة تلقائي عند الشحن',
            added_by: 'system', created_at: new Date().toISOString()
          });
        }
        // Notify worker
        let notifBody = 'تم إضافة ' + amount + ' ج';
        if (debtDeducted > 0) notifBody += ' — وتم خصم ' + debtDeducted + ' ج عمولة متأخرة تلقائياً';
        notifBody += ' — رصيدك الجديد: ' + balAfterDeposit + ' ج';
        await push(ref(db, 'notifications/' + uid), {
          type: 'wallet_deposit',
          title: '💳 تم إضافة رصيد لمحفظتك!',
          body: notifBody,
          read: false,
          created_at: new Date().toISOString()
        });
        document.getElementById('adm-wallet-bal').textContent = balAfterDeposit.toLocaleString('ar-EG') + ' ج';
        document.getElementById('adm-wallet-add-amount').value = '';
        document.getElementById('adm-wallet-add-note').value = '';
        showToast(debtDeducted > 0 ? '✅ تم إضافة ' + amount + ' ج وخصم ' + debtDeducted + ' ج دين عمولة تلقائي' : '✅ تم إضافة ' + amount + ' ج بنجاح', '#2ECC71');
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
        const pendingDebt = data.pending_commission_debt || 0;
        // أضف الرصيد الجديد أولاً
        let balAfterDeposit = (data.balance || 0) + amount;
        // لو عنده دين معلق، اخصمه من الشحنة الجديدة
        let debtDeducted = 0;
        if (pendingDebt > 0) {
          debtDeducted = Math.min(balAfterDeposit, pendingDebt);
          balAfterDeposit -= debtDeducted;
        }
        const newDebt = pendingDebt - debtDeducted;
        await set(walletRef(uid), { ...data, balance: balAfterDeposit, total_deposited: (data.total_deposited || 0) + amount, total_deducted: (data.total_deducted || 0) + debtDeducted, pending_commission_debt: newDebt });
        await update(ref(db, 'craftsmen/' + uid), { available: balAfterDeposit > 0 }); // يظهر تاني لما يشحن
        await push(walletTxnRef(uid), {
          type: 'deposit', amount,
          description: 'شحن عبر كاشير — مؤكد من الأدمن',
          added_by: 'admin', kashier_key: key,
          created_at: new Date().toISOString()
        });
        if (debtDeducted > 0) {
          await push(walletTxnRef(uid), {
            type: 'commission', amount: debtDeducted,
            description: 'خصم عمولة متأخرة تلقائي عند الشحن',
            added_by: 'system', created_at: new Date().toISOString()
          });
        }
        // Mark as confirmed
        await update(ref(db, 'wallet_pending/' + key), { status: 'confirmed', confirmed_at: new Date().toISOString() });
        // Notify worker
        let notifBody = 'تم إضافة ' + amount + ' ج لمحفظتك بعد تأكيد الدفع';
        if (debtDeducted > 0) notifBody += ' — وتم خصم ' + debtDeducted + ' ج عمولة متأخرة تلقائياً';
        notifBody += ' — رصيدك الجديد: ' + balAfterDeposit + ' ج';
        await push(ref(db, 'notifications/' + uid), {
          type: 'wallet_deposit',
          title: '🎉 تم شحن محفظتك!',
          body: notifBody,
          read: false, created_at: new Date().toISOString()
        });
        showToast(debtDeducted > 0 ? '✅ تم الشحن وخصم ' + debtDeducted + ' ج عمولة متأخرة' : '✅ تم تأكيد الدفع وإضافة الرصيد', '#2ECC71');
        loadAdminPendingPayments();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ', '#E74C3C'); }
    };

  })();
  // ==================== END WALLET SYSTEM ====================


// ==================== PAYMENT SETTINGS SYSTEM ====================
(function () {
  const SETTINGS_PATH = 'platform_settings/payment_numbers';

  // ===== Load settings when admin opens the tab =====
  window.loadPaymentSettings = async function () {
    const snap = await get(ref(db, SETTINGS_PATH));
    const data = snap.exists() ? snap.val() : {};

    const instapayInput = document.getElementById('settings-instapay-input');
    const cashInput     = document.getElementById('settings-cash-input');

    if (instapayInput) instapayInput.value = data.instapay || '';
    if (cashInput)     cashInput.value     = data.cash     || '';

    updateSettingsPreview(data.instapay || null, data.cash || null);
  };

  function updateSettingsPreview(instapay, cash) {
    const preview = document.getElementById('settings-preview');
    const pi      = document.getElementById('settings-preview-instapay');
    const pc      = document.getElementById('settings-preview-cash');
    if (!preview) return;
    if (instapay || cash) {
      preview.style.display = 'block';
      if (pi) pi.textContent = instapay || '—';
      if (pc) pc.textContent = cash     || '—';
    } else {
      preview.style.display = 'none';
    }
  }

  // ===== Save =====
  window.adminSavePaymentSettings = async function () {
    const instapay = (document.getElementById('settings-instapay-input')?.value || '').trim();
    const cash     = (document.getElementById('settings-cash-input')?.value     || '').trim();

    if (!instapay && !cash) {
      showToast('⚠️ أدخل رقم واحد على الأقل', '#E67E22'); return;
    }

    const btn = document.getElementById('settings-save-btn');
    if (btn) { btn.textContent = '⏳ جاري الحفظ...'; btn.disabled = true; }

    try {
      await set(ref(db, SETTINGS_PATH), {
        instapay: instapay || null,
        cash:     cash     || null,
        updated_at: new Date().toISOString()
      });

      // Update the wallet page live without reload
      applyPaymentNumbersToWalletPage(instapay, cash);

      updateSettingsPreview(instapay, cash);
      showToast('✅ تم حفظ الأرقام بنجاح', '#2ECC71');
    } catch (e) {
      console.error(e);
      showToast('❌ حصل خطأ أثناء الحفظ', '#E74C3C');
    } finally {
      if (btn) { btn.innerHTML = '<span>💾</span> حفظ الأرقام'; btn.disabled = false; }
    }
  };

  // ===== Apply numbers to wallet page in real-time =====
  function applyPaymentNumbersToWalletPage(instapay, cash) {
    // Update all elements showing the instapay number
    document.querySelectorAll('[data-payment="instapay"]').forEach(el => {
      el.textContent = instapay || '—';
    });
    // Update all elements showing the cash number
    document.querySelectorAll('[data-payment="cash"]').forEach(el => {
      el.textContent = cash || '—';
    });
    // Update copy buttons
    document.querySelectorAll('[data-copy="instapay"]').forEach(el => {
      el.setAttribute('onclick', `navigator.clipboard.writeText('${instapay}').then(()=>showToast('✅ تم نسخ الرقم','#6EC85A'))`);
    });
    document.querySelectorAll('[data-copy="cash"]').forEach(el => {
      el.setAttribute('onclick', `navigator.clipboard.writeText('${cash}').then(()=>showToast('✅ تم نسخ الرقم','#C8873A'))`);
    });
  }

  // ===== Load from Firebase on page load & apply to wallet page =====
  window.initPaymentSettings = async function () {
    try {
      const snap = await get(ref(db, SETTINGS_PATH));
      const data = snap.exists() ? snap.val() : {};
      const instapay = data.instapay || '01282493963';
      const cash     = data.cash     || '01207366950';
      applyPaymentNumbersToWalletPage(instapay, cash);
    } catch (e) { console.error('Payment settings load error:', e); }
  };

  // Hook into adminTab to load settings when user clicks the tab
  // نفذ مباشرةً بدون load listener لأن السكريبت في آخر الصفحة
  (function () {
    const _origAdminTab = window.adminTab;
    window.adminTab = function (tab) {
      if (typeof _origAdminTab === 'function') _origAdminTab(tab);
      if (tab === 'settings') window.loadPaymentSettings();
    };
  })();

})();
// ==================== END PAYMENT SETTINGS SYSTEM ====================

