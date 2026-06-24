    // ========== ADMIN DASHBOARD ==========
    // OWNER_EMAIL, OWNER_UID_KEY, isOwner() — معرفين في firebase.js

    let _permListener = null;

    // دالة تطبيق الصلاحيات على التابات فوراً
    function applyPermSections(allowedSections) {
      document.querySelectorAll('.admin-nav-item[id^="atab-"]').forEach(btn => {
        const key = btn.id.replace('atab-', '');
        btn.style.display = allowedSections.includes(key) ? '' : 'none';
      });
      // لو التاب الحالي اتقفل — روح لأول تاب مسموح
      const activeBtn = document.querySelector('.admin-nav-item.active');
      if (activeBtn) {
        const activeKey = activeBtn.id.replace('atab-', '');
        if (!allowedSections.includes(activeKey)) {
          const first = allowedSections[0];
          if (first) adminTab(first);
        }
      }
    }

    // listener real-time على صلاحيات المستخدم الحالي
    function startPermListener() {
      if (_permListener) { _permListener(); _permListener = null; }
      if (!currentUser || isOwner()) return;
      _permListener = onValue(ref(db, 'admin_permissions/' + currentUser.uid), (snap) => {
        const adminPage = document.getElementById('page-admin');
        if (!snap.exists() || !snap.val().is_admin) {
          // اتسحبت منه الصلاحية — اطرده
          showPage('home');
          showToast('تم إلغاء صلاحياتك من الأدمن', '#E74C3C');
          return;
        }
        const perms = snap.val();
        // تحقق من الصفحة الحالية
        const allowedPages = perms.allowed_pages || [];
        if (allowedPages.length > 0) {
          const activePage = document.querySelector('.page.active');
          if (activePage) {
            const currentPageName = activePage.id.replace('page-', '');
            if (!allowedPages.includes(currentPageName) && currentPageName !== 'auth' && currentPageName !== 'admin') {
              showToast('⛔ تم إلغاء صلاحية هذه الصفحة', '#E74C3C');
              showPage(allowedPages[0] || 'home');
            }
          }
        }
        if (adminPage && adminPage.classList.contains('active')) {
          const allowedSections = perms.sections || [];
          applyPermSections(allowedSections);
        }
      });
    }

    async function goToAdmin() {
      if (!currentUser) { showAuthPage('login'); return; }
      if (!isOwner()) {
        // هل عنده صلاحية أدمن فرعي؟
        const permSnap = await get(ref(db, 'admin_permissions/' + currentUser.uid));
        if (!permSnap.exists() || !permSnap.val().is_admin) {
          alert('⛔ ممنوع — هذه الصفحة للمالك فقط'); return;
        }
        const perms = permSnap.val();
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-admin').classList.add('active');
        window.scrollTo(0, 0);
        const allowedSections = perms.sections || [];
        applyPermSections(allowedSections);
        // افتح أول تاب مسموح
        const firstAllowed = allowedSections[0] || 'overview';
        adminTab(firstAllowed);
        if (allowedSections.includes('overview')) loadAdminData();
        // شغّل real-time listener عشان يتحدث فوراً
        startPermListener();
        return;
      }
      // الأدمن الأصلي — كل الصلاحيات
      if (_permListener) { _permListener(); _permListener = null; }
      document.querySelectorAll('.admin-nav-item[id^="atab-"]').forEach(btn => btn.style.display = '');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-admin').classList.add('active');
      window.scrollTo(0, 0);
      adminTab('overview');
      loadAdminData();
      if (typeof loadAdminPendingPayments === 'function') setTimeout(loadAdminPendingPayments, 800);
    }
    window.goToAdmin = goToAdmin;

    let _adminData = { workers: [], clients: [], orders: [], ratings: [] };

    // ===== ADMIN REALTIME LISTENERS =====
    let _adminListeners = {};
    function stopAdminListeners() {
      Object.values(_adminListeners).forEach(unsub => { try { unsub(); } catch (e) { } });
      _adminListeners = {};
    }

    function startAdminRealtimeListeners() {
      stopAdminListeners();

      // 1) Profiles listener
      _adminListeners.profiles = onValue(ref(db, 'profiles'), async (profSnap) => {
        const profiles = profSnap.exists() ? profSnap.val() : {};
        // جيب craftsmen snapshot وwallets snapshot مع بعض
        const [craftsSnap, walletsSnap] = await Promise.all([
          get(ref(db, 'craftsmen')),
          get(ref(db, 'wallets'))
        ]);
        const craftsmen = craftsSnap.exists() ? craftsSnap.val() : {};
        const wallets = walletsSnap.exists() ? walletsSnap.val() : {};
        _adminData.workers = Object.entries(profiles)
          .filter(([, p]) => p.role === 'worker')
          .map(([uid, p]) => ({ ...p, uid, craftsmanData: craftsmen[uid] || {}, walletData: wallets[uid] || {} }));
        _adminData.clients = Object.entries(profiles)
          .filter(([, p]) => p.role === 'client')
          .map(([uid, p]) => ({ ...p, uid }));
        // حدّث الأقسام
        renderAdminOverview();
        renderAdminWorkers();
        renderAdminClients();
        renderAdminActivity();
        showAdminToast('👤 تحديث في المستخدمين');
      });

      // 2) Orders listener
      _adminListeners.orders = onValue(ref(db, 'service_requests'), (snap) => {
        const orders = snap.exists() ? Object.entries(snap.val()).map(([k, v]) => ({ ...v, _key: k })) : [];
        _adminData.orders = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderAdminOverview();
        renderAdminOrders();
        renderAdminActivity();
        showAdminToast('📋 طلب جديد أو تحديث');
      });

      // 3) Craftsmen listener (للتقييمات والتوفر)
      _adminListeners.craftsmen = onValue(ref(db, 'craftsmen'), (snap) => {
        const craftsmen = snap.exists() ? snap.val() : {};
        // حدّث craftsmanData في workers
        _adminData.workers = _adminData.workers.map(w => ({
          ...w, craftsmanData: craftsmen[w.uid] || {}
        }));
        // اجمع التقييمات
        const allRatings = [];
        _adminData.workers.forEach(w => {
          if (w.craftsmanData?.ratings_list) {
            Object.values(w.craftsmanData.ratings_list).forEach(r =>
              allRatings.push({ ...r, worker_name: w.full_name })
            );
          }
        });
        _adminData.ratings = allRatings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderAdminOverview();
        renderAdminWorkers();
        renderAdminRatings();
        showAdminToast('⭐ تحديث في الصنايعية');
      });

      // 4) Messages listener
      _adminListeners.messages = onValue(ref(db, 'contact_messages'), (snap) => {
        if (!snap.exists()) return;
        const msgs = Object.values(snap.val());
        const unread = msgs.filter(m => !m.read).length;
        const badge = document.getElementById('admin-msg-badge');
        if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'flex' : 'none'; }
        // لو قسم الرسائل مفتوح، حدّثه
        const msgSec = document.getElementById('asec-messages');
        if (msgSec?.classList.contains('active')) loadAdminMessages();
        if (unread > 0) showAdminToast('💬 رسالة جديدة من عميل!', '#C8873A');
      });

      // 5) Registrations (new users)
      _adminListeners.regs = onValue(ref(db, 'profiles'), () => { }); // مغطى فوق
    }
    window.startAdminRealtimeListeners = startAdminRealtimeListeners;

    // toast خاص بلوحة المالك
    let _adminToastTimeout;
    function showAdminToast(msg, color) {
      const adminPage = document.getElementById('page-admin');
      if (!adminPage?.classList.contains('active')) return;
      let toast = document.getElementById('admin-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'admin-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(28,26,23,0.97);border:1px solid rgba(200,135,58,0.4);color:#fff;padding:10px 20px;border-radius:12px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5);transition:opacity 0.3s;pointer-events:none;';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.borderColor = color || 'rgba(200,135,58,0.4)';
      toast.style.opacity = '1';
      clearTimeout(_adminToastTimeout);
      _adminToastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    }

    async function loadAdminData() {
      // أول تحميل — بعدين الـ listeners بتشتغل تلقائي
      try {
        const [profSnap, ordSnap, craftsSnap] = await Promise.all([
          get(ref(db, 'profiles')),
          get(ref(db, 'service_requests')),
          get(ref(db, 'craftsmen'))
        ]);
        const profiles = profSnap.exists() ? profSnap.val() : {};
        const orders = ordSnap.exists() ? Object.entries(ordSnap.val()).map(([k, v]) => ({ ...v, _key: k })) : [];
        const craftsmen = craftsSnap.exists() ? craftsSnap.val() : {};
        _adminData.workers = Object.entries(profiles)
          .filter(([, p]) => p.role === 'worker')
          .map(([uid, p]) => ({ ...p, uid, craftsmanData: craftsmen[uid] || {} }));
        _adminData.clients = Object.entries(profiles)
          .filter(([, p]) => p.role === 'client')
          .map(([uid, p]) => ({ ...p, uid }));
        _adminData.orders = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const allRatings = [];
        _adminData.workers.forEach(w => {
          if (w.craftsmanData?.ratings_list)
            Object.values(w.craftsmanData.ratings_list).forEach(r => allRatings.push({ ...r, worker_name: w.full_name }));
        });
        _adminData.ratings = allRatings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderAdminOverview();
        renderAdminWorkers();
        renderAdminClients();
        renderAdminOrders();
        renderAdminRatings();
        renderAdminActivity();
        // تحديث بادج الحسابات الجديدة
        const pendingNewAccounts = _adminData.workers.filter(w => w.id_card_front && w.id_card_verified !== true && w.account_active !== false).length;
        const naBadge = document.getElementById('atab-new-accounts-badge');
        if (naBadge) { if (pendingNewAccounts > 0) { naBadge.textContent = pendingNewAccounts; naBadge.style.display = 'flex'; } else { naBadge.style.display = 'none'; } }
        // شغّل الـ listeners بعد التحميل الأول
        startAdminRealtimeListeners();
        startAdminMarketListener();
      } catch (e) { console.error('admin load error', e); }
    }

    function adminTab(tab) {
      document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      const btn = document.getElementById('atab-' + tab);
      if (btn) {
        btn.classList.add('active');
        // على الموبايل شريط التابات بيتمرر أفقياً، فلازم نتأكد إن الزر اللي اتدغط عليه يظهر بالكامل في الشاشة
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
      const sec = document.getElementById('asec-' + tab);
      if (sec) sec.classList.add('active');
      // ارجع لأعلى المحتوى عند تغيير التاب (مهم على الموبايل عشان المستخدم يشوف العنوان الجديد فوراً)
      const mainEl = document.querySelector('.admin-main');
      if (mainEl) mainEl.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (tab === 'permissions') loadPermissionsTab();
      if (tab === 'market') adminRenderMarket();
      if (tab === 'new-accounts') loadNewAccountsTab();
    }
    window.adminTab = adminTab;

    // ===== NEW ACCOUNTS TAB =====
    let _naAllWorkers = [];
    let _naCurrentFilter = 'pending';

    window.loadNewAccountsTab = async function() {
      const container = document.getElementById('na-cards-container');
      if (!container) return;
      container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.2);padding:40px;font-size:14px;">⏳ جاري التحميل...</div>';
      try {
        const [profSnap, craftsSnap] = await Promise.all([
          get(ref(db, 'profiles')),
          get(ref(db, 'craftsmen'))
        ]);
        const profiles = profSnap.exists() ? profSnap.val() : {};
        const craftsmen = craftsSnap.exists() ? craftsSnap.val() : {};
        const today = new Date().toDateString();
        _naAllWorkers = Object.entries(profiles)
          .filter(([, p]) => p.role === 'worker')
          .map(([uid, p]) => ({ ...p, uid, craftsmanData: craftsmen[uid] || {} }))
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        // حساب الإحصائيات
        const pending   = _naAllWorkers.filter(w => w.id_card_front && w.id_card_verified !== true && w.account_active !== false).length;
        const approved  = _naAllWorkers.filter(w => w.id_card_verified === true && w.id_card_verified_at && new Date(w.id_card_verified_at).toDateString() === today).length;
        const rejected  = _naAllWorkers.filter(w => w.account_active === false && w.id_card_verified_at && new Date(w.id_card_verified_at).toDateString() === today).length;
        const noCard    = _naAllWorkers.filter(w => !w.id_card_front).length;

        const setT = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
        setT('na-count-pending',  pending);
        setT('na-count-approved', approved);
        setT('na-count-rejected', rejected);
        setT('na-count-no-card',  noCard);

        // تحديث بادج السايد بار
        const badge = document.getElementById('atab-new-accounts-badge');
        if (badge) {
          if (pending > 0) { badge.textContent = pending; badge.style.display = 'flex'; }
          else { badge.style.display = 'none'; }
        }
        filterNewAccounts(_naCurrentFilter);
      } catch(e) {
        console.error(e);
        container.innerHTML = '<div style="text-align:center;color:#E74C3C;padding:40px;">❌ حصل خطأ أثناء التحميل</div>';
      }
    };

    window.filterNewAccounts = function(filter) {
      _naCurrentFilter = filter;
      // تلوين التابز
      ['pending','no-card','approved','rejected','all'].forEach(f => {
        const btn = document.getElementById('na-tab-' + f);
        if (!btn) return;
        const isActive = f === filter;
        const colors = { pending:'#E67E22', 'no-card':'#5DADE2', approved:'#2ECC71', rejected:'#E74C3C', all:'#C8873A' };
        btn.style.background = isActive ? `rgba(${hexToRgb(colors[f] || '#C8873A')},0.18)` : 'transparent';
        btn.style.borderColor = isActive ? (colors[f] || '#C8873A') : 'rgba(255,255,255,0.1)';
        btn.style.color = isActive ? (colors[f] || '#C8873A') : 'rgba(255,255,255,0.4)';
      });
      let list;
      if (filter === 'pending')   list = _naAllWorkers.filter(w => w.id_card_front && w.id_card_verified !== true && w.account_active !== false);
      else if (filter === 'no-card')  list = _naAllWorkers.filter(w => !w.id_card_front);
      else if (filter === 'approved') list = _naAllWorkers.filter(w => w.id_card_verified === true);
      else if (filter === 'rejected') list = _naAllWorkers.filter(w => w.account_active === false);
      else list = _naAllWorkers;
      renderNewAccountsCards(list, filter);
    };

    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `${r},${g},${b}`;
    }

    function renderNewAccountsCards(list, filter) {
      const container = document.getElementById('na-cards-container');
      if (!container) return;
      if (!list.length) {
        const msgs = { pending:'لا يوجد حسابات تنتظر المراجعة 🎉', 'no-card':'كل الصنايعية رفعوا بطاقاتهم ✅', approved:'لا يوجد حسابات مقبولة', rejected:'لا يوجد حسابات مرفوضة', all:'لا يوجد صنايعية مسجلين' };
        container.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.25);padding:50px;font-size:14px;">${msgs[filter] || 'لا يوجد نتائج'}</div>`;
        return;
      }
      container.innerHTML = list.map(w => {
        const statusColor = w.id_card_verified === true ? '#2ECC71'
          : w.account_active === false ? '#E74C3C'
          : w.id_card_front ? '#E67E22'
          : '#5DADE2';
        const statusText = w.id_card_verified === true ? '✅ تم القبول'
          : w.account_active === false ? '❌ مرفوض'
          : w.id_card_front ? '⏳ بينتظر المراجعة'
          : '🪪 لم يرفع البطاقة بعد';
        const regDate = w.created_at ? new Date(w.created_at).toLocaleDateString('ar-EG', { year:'numeric', month:'short', day:'numeric' }) : '-';
        const verDate = w.id_card_verified_at ? new Date(w.id_card_verified_at).toLocaleDateString('ar-EG', { year:'numeric', month:'short', day:'numeric' }) : null;
        return `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:18px 20px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;">
          <!-- أيقونة -->
          <div style="width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,rgba(200,135,58,0.25),rgba(200,135,58,0.08));border:1px solid rgba(200,135,58,0.25);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">👷</div>
          <!-- بيانات -->
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:15px;font-weight:800;color:#fff;">${w.full_name || '-'}</span>
              <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:700;background:${statusColor}22;border:1px solid ${statusColor}55;color:${statusColor};">${statusText}</span>
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:8px;">${w.email || '-'}</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;">
              <span style="font-size:12px;color:rgba(255,255,255,0.5);">🔧 ${w.trade || '-'}</span>
              <span style="font-size:12px;color:rgba(255,255,255,0.5);">📍 ${w.area || w.work_area || '-'}</span>
              <span style="font-size:12px;color:rgba(255,255,255,0.5);">📅 سجّل ${regDate}</span>
              ${verDate ? `<span style="font-size:12px;color:rgba(255,255,255,0.4);">🕐 راجع ${verDate}</span>` : ''}
            </div>
            ${w.id_card_front ? `
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
              <img src="${w.id_card_front}" onclick="GLB.open(this.src)" title="الوجه الأمامي"
                style="width:90px;height:56px;object-fit:cover;border-radius:8px;border:1.5px solid rgba(200,135,58,0.35);cursor:pointer;">
              ${w.id_card_back ? `<img src="${w.id_card_back}" onclick="GLB.open(this.src)" title="الوجه الخلفي"
                style="width:90px;height:56px;object-fit:cover;border-radius:8px;border:1.5px solid rgba(200,135,58,0.35);cursor:pointer;">` : ''}
            </div>` : '<div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.25);">🪪 لم يرفع صور البطاقة بعد</div>'}
          </div>
          <!-- أزرار -->
          <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;min-width:130px;">
            <button onclick="adminOpenUserDetail('${w.uid}','worker','${(w.full_name||'').replace(/'/g,'')}')"
              style="padding:9px 14px;background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);border-radius:10px;color:#5DADE2;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;width:100%;">
              👁 عرض التفاصيل
            </button>
            ${w.id_card_front && w.id_card_verified !== true && w.account_active !== false ? `
            <button onclick="naQuickApprove('${w.uid}','${(w.full_name||'').replace(/'/g,'')}')"
              style="padding:9px 14px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.4);border-radius:10px;color:#2ECC71;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;width:100%;">
              ✅ قبول البطاقة
            </button>
            <button onclick="naQuickReject('${w.uid}','${(w.full_name||'').replace(/'/g,'')}')"
              style="padding:9px 14px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:10px;color:#E74C3C;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;width:100%;">
              ❌ رفض البطاقة
            </button>` : ''}
            ${w.id_card_verified === true ? `
            <button onclick="naQuickReject('${w.uid}','${(w.full_name||'').replace(/'/g,'')}')"
              style="padding:9px 14px;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:10px;color:#E74C3C;font-family:'Cairo',sans-serif;font-size:11px;font-weight:700;cursor:pointer;width:100%;">
              ↩️ إلغاء القبول
            </button>` : ''}
            ${w.account_active === false ? `
            <button onclick="naQuickApprove('${w.uid}','${(w.full_name||'').replace(/'/g,'')}')"
              style="padding:9px 14px;background:rgba(46,204,113,0.12);border:1px solid rgba(46,204,113,0.3);border-radius:10px;color:#2ECC71;font-family:'Cairo',sans-serif;font-size:11px;font-weight:700;cursor:pointer;width:100%;">
              ↩️ إعادة التفعيل
            </button>` : ''}
          </div>
        </div>`;
      }).join('');
    }

    window.naQuickApprove = async function(uid, name) {
      if (!confirm('قبول بطاقة ' + name + ' وتفعيل الحساب؟')) return;
      try {
        await update(ref(db, 'profiles/' + uid), { id_card_verified: true, account_active: true, id_card_verified_at: new Date().toISOString() });
        await update(ref(db, 'craftsmen/' + uid), { available: false }); // الصنايعي يفعّل نفسه لما يشحن
        await push(ref(db, 'notifications/' + uid), { type:'account_approved', title:'🎉 تم قبول حسابك!', body:'تم التحقق من بطاقتك وتفعيل حسابك. اشحن محفظتك وابدأ استقبال الطلبات.', read:false, created_at:new Date().toISOString() });
        showToast('✅ تم قبول حساب ' + name, '#2ECC71');
        loadNewAccountsTab();
      } catch(e) { showToast('❌ خطأ: ' + e.message, '#E74C3C'); }
    };

    window.naQuickReject = async function(uid, name) {
      if (!confirm('رفض بطاقة ' + name + ' وإيقاف الحساب؟')) return;
      try {
        await update(ref(db, 'profiles/' + uid), { id_card_verified: false, account_active: false, id_card_verified_at: new Date().toISOString() });
        await update(ref(db, 'craftsmen/' + uid), { available: false });
        await push(ref(db, 'notifications/' + uid), { type:'account_rejected', title:'❌ تم رفض صور البطاقة', body:'للأسف، تم رفض صور البطاقة الشخصية. تواصل مع الأدمن لمعرفة السبب.', read:false, created_at:new Date().toISOString() });
        showToast('❌ تم رفض حساب ' + name, '#E74C3C');
        loadNewAccountsTab();
      } catch(e) { showToast('❌ خطأ: ' + e.message, '#E74C3C'); }
    };
    // ===== END NEW ACCOUNTS TAB =====

    function renderAdminOverview() {
      const { workers, clients, orders, ratings } = _adminData;
      const avail = workers.filter(w => w.craftsmanData?.available).length;
      const done = orders.filter(o => o.status === 'done').length;
      const cancelled = orders.filter(o => o.status === 'cancelled').length;
      const pending = orders.filter(o => ['pending_admin', 'pending', 'price_offered', 'client_counter'].includes(o.status)).length;
      const avgRating = ratings.length ? (ratings.reduce((a, r) => a + (r.stars || 0), 0) / ratings.length).toFixed(1) : '-';

      // today & week counts
      const now = new Date();
      const todayStr = now.toDateString();
      const weekAgo = new Date(now - 7 * 86400000);
      const todayOrders = orders.filter(o => o.created_at && new Date(o.created_at).toDateString() === todayStr).length;
      const weekOrders = orders.filter(o => o.created_at && new Date(o.created_at) >= weekAgo).length;
      const cancelRate = orders.length ? Math.round((cancelled / orders.length) * 100) + '%' : '0%';

      setText('adm-count-workers', workers.length);
      setText('adm-workers-badge', workers.length + ' صنايعي');
      setText('adm-count-workers-avail', avail);
      setText('adm-count-clients', clients.length);
      setText('adm-clients-badge', clients.length + ' عميل');
      setText('adm-total-users', workers.length + clients.length);
      setText('adm-count-orders', orders.length);
      setText('adm-pending-badge', pending + ' معلّق');
      setText('adm-count-done', done);
      setText('adm-avg-rating', avgRating);
      setText('adm-ratings-badge', ratings.length + ' تقييم');
      setText('adm-count-ratings', ratings.length);
      setText('adm-count-today', todayOrders);
      setText('adm-count-week', weekOrders + ' طلب');
      setText('adm-count-cancelled', cancelled);
      setText('adm-cancel-rate', cancelRate);

      // Orders status chart
      const statuses = { pending: 0, accepted: 0, done: 0, cancelled: 0 };
      orders.forEach(o => {
        const k = o.status === 'pending_admin' ? 'pending' : o.status;
        if (statuses[k] !== undefined) statuses[k]++;
      });
      const maxV = Math.max(...Object.values(statuses), 1);
      const colors = { pending: '#C8873A', accepted: '#2E86C1', done: '#27AE60', cancelled: '#E74C3C' };
      const labels = { pending: 'معلّق', accepted: 'مقبول', done: 'منجز', cancelled: 'ملغي' };
      const chartEl = document.getElementById('adm-orders-chart');
      if (chartEl) {
        chartEl.innerHTML = Object.entries(statuses).map(([k, v]) =>
          `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);">${v}</div>
        <div style="width:100%;height:${Math.max(6, (v / maxV) * 64)}px;background:${colors[k]};border-radius:5px 5px 0 0;opacity:0.85;"></div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4);">${labels[k]}</div>
      </div>`
        ).join('');
      }

      // Top services
      const svcCount = {};
      orders.forEach(o => { svcCount[o.service_type] = (svcCount[o.service_type] || 0) + 1; });
      const topSvcs = Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const maxSvc = topSvcs[0]?.[1] || 1;
      const svcEl = document.getElementById('adm-top-services');
      if (svcEl) {
        svcEl.innerHTML = topSvcs.map(([name, count]) =>
          `<div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:4px;">
          <span>${name || '-'}</span><span>${count}</span>
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;">
          <div style="height:100%;width:${(count / maxSvc) * 100}%;background:linear-gradient(90deg,#C8873A,#8B5E25);border-radius:3px;"></div>
        </div>
      </div>`
        ).join('') || '<p style="color:rgba(255,255,255,0.3);font-size:13px;">لا توجد طلبات</p>';
      }

      // Recent orders
      const tbody = document.getElementById('adm-recent-orders');
      if (tbody) {
        tbody.innerHTML = _adminData.orders.slice(0, 10).map(o => `
      <tr>
        <td><code style="color:#C8873A;font-size:12px;">#${o.order_number || o._key?.slice(-6) || '-'}</code></td>
        <td>${o.client_name || '-'}</td>
        <td>${o.service_type || '-'}</td>
        <td style="font-size:12px;color:rgba(255,255,255,0.5);">${o.area || o.address || '-'}</td>
        <td>${o.worker_name ? `<span style="color:#C8873A;font-size:12px;">🔧 ${o.worker_name}</span>` : '<span style="color:rgba(255,255,255,0.3);font-size:11px;">غير محدد</span>'}</td>
        <td>${o.offered_price || o.client_counter_price ? `<span style="color:#1ABC9C;font-weight:700;font-size:12px;">${o.offered_price || o.client_counter_price} ج</span>` : '-'}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="color:rgba(255,255,255,0.4);font-size:11px;">${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا توجد طلبات</td></tr>';
      }
    }

    function renderAdminWorkers(_list) {
      const list = _list || _adminData.workers;
      const tbody = document.getElementById('adm-workers-body');
      if (!tbody) return;
      // update mini stats
      const avail = _adminData.workers.filter(w => w.craftsmanData?.available).length;
      const busy = _adminData.workers.length - avail;
      const rated = _adminData.workers.filter(w => w.craftsmanData?.rating_count > 0).length;
      const setText2 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setText2('adm-w-mini-total', _adminData.workers.length);
      setText2('adm-w-mini-avail', avail);
      setText2('adm-w-mini-busy', busy);
      setText2('adm-w-mini-rated', rated);
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا يوجد صنايعية</td></tr>'; return; }
      // طلبات الخدمة المباشرة
      const workerOrders = {};
      _adminData.orders.forEach(o => { if (o.worker_id) workerOrders[o.worker_id] = (workerOrders[o.worker_id] || 0) + 1; });
      // طلبات السوق — نضيف فوق الطلبات المباشرة
      if (_adminData.marketOrders) {
        _adminData.marketOrders.forEach(r => {
          if (r.accepted_worker_id) workerOrders[r.accepted_worker_id] = (workerOrders[r.accepted_worker_id] || 0) + 1;
        });
      }
      tbody.innerHTML = list.map((w, i) => {
        const bal = Number(w.walletData?.balance ?? 0);
        const debt = Number(w.walletData?.pending_commission_debt ?? 0);
        const balTxt = bal.toLocaleString('ar-EG') + ' ج';
        const debtCell = debt > 0
          ? `<div style="font-size:11px;color:#E74C3C;font-weight:700;margin-top:2px;">دين: ${debt.toLocaleString('ar-EG')} ج</div>`
          : '';
        const balColor = bal > 0 ? '#2ECC71' : 'rgba(255,255,255,0.35)';
        return `
    <tr>
      <td style="color:rgba(255,255,255,0.3);font-size:11px;">${i + 1}</td>
      <td><strong>${w.full_name || '-'}</strong><br><span style="font-size:11px;color:rgba(255,255,255,0.35);">${w.email || ''}</span></td>
      <td><span style="background:rgba(200,135,58,0.1);color:#C8873A;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;">${w.trade || w.craftsmanData?.trade || '-'}</span></td>
      <td>${w.area || '-'}</td>
      <td><span style="color:#C8873A;">★</span> ${w.craftsmanData?.avg_rating || '-'} <span style="font-size:11px;color:rgba(255,255,255,0.3);">(${w.craftsmanData?.rating_count || 0})</span></td>
      <td>${w.craftsmanData?.available ? '<span class="badge badge-active">● متاح</span>' : '<span class="badge badge-inactive">● غير متاح</span>'}</td>
      <td style="text-align:center;"><span style="background:rgba(255,255,255,0.06);padding:2px 10px;border-radius:6px;font-size:13px;font-weight:700;">${workerOrders[w.uid] || 0}</span></td>
      <td style="text-align:center;">
        <div style="font-size:13px;font-weight:900;color:${balColor};">${balTxt}</div>
        ${debtCell}
      </td>
      <td style="font-size:11px;color:rgba(255,255,255,0.35);">${w.created_at ? new Date(w.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="admin-btn" onclick="adminOpenUserDetail('${w.uid}','worker','${(w.full_name || '').replace(/'/g, '')}')" style="background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);color:#5DADE2;">👁 تفصيل</button>
        ${w.craftsmanData?.available
          ? `<button class="admin-btn admin-btn-warn" onclick="adminToggleWorker('${w.uid}', false)">⏸ إيقاف</button>`
          : `<button class="admin-btn admin-btn-success" onclick="adminToggleWorker('${w.uid}', true)">▶ تفعيل</button>`}
        <button class="admin-btn" onclick="adminOpenWallet('${w.uid}','${(w.full_name || '').replace(/'/g, '')}')" style="background:rgba(200,135,58,0.15);border:1px solid rgba(200,135,58,0.4);color:#C8873A;">💳 محفظة</button>
        <button class="admin-btn admin-btn-danger" onclick="adminDeleteUser('${w.uid}', 'worker', '${(w.full_name || '').replace(/'/g, '')}')">🗑 حذف</button>
        <button class="admin-btn" onclick="adminBlockUser('${w.uid}','${(w.full_name || '').replace(/'/g, '')}','${w.email || ''}')" style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);color:#E74C3C;">🚫 بلوك</button>
      </td>
    </tr>`;
      }).join('');
    }

    function renderAdminClients(_list) {
      const list = _list || _adminData.clients;
      const tbody = document.getElementById('adm-clients-body');
      if (!tbody) return;
      // mini stats
      const now2 = new Date();
      const weekAgo2 = new Date(now2 - 7 * 86400000);
      const clientOrders = {};
      const clientLastOrder = {};
      _adminData.orders.forEach(o => {
        if (o.user_id) {
          clientOrders[o.user_id] = (clientOrders[o.user_id] || 0) + 1;
          if (!clientLastOrder[o.user_id] || new Date(o.created_at) > new Date(clientLastOrder[o.user_id]))
            clientLastOrder[o.user_id] = o.created_at;
        }
      });
      const activeClients = _adminData.clients.filter(c => clientOrders[c.uid] > 0).length;
      const newClients = _adminData.clients.filter(c => c.created_at && new Date(c.created_at) >= weekAgo2).length;
      const setText2 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setText2('adm-c-mini-total', _adminData.clients.length);
      setText2('adm-c-mini-active', activeClients);
      setText2('adm-c-mini-new', newClients);
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا يوجد عملاء</td></tr>'; return; }
      tbody.innerHTML = list.map((c, i) => `
    <tr>
      <td style="color:rgba(255,255,255,0.3);font-size:11px;">${i + 1}</td>
      <td><strong>${c.full_name || '-'}</strong><br><span style="font-size:11px;color:rgba(255,255,255,0.35);">${c.email || ''}</span></td>
      <td>${c.area || '-'}</td>
      <td style="text-align:center;"><span style="background:rgba(255,255,255,0.06);padding:2px 10px;border-radius:6px;font-size:13px;font-weight:700;">${clientOrders[c.uid] || 0}</span></td>
      <td style="font-size:11px;color:rgba(255,255,255,0.4);">${clientLastOrder[c.uid] ? new Date(clientLastOrder[c.uid]).toLocaleDateString('ar-EG') : '-'}</td>
      <td style="font-size:12px;color:rgba(255,255,255,0.4);">${c.created_at ? new Date(c.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      <td><button class="admin-btn" onclick="adminOpenUserDetail('${c.uid}','client','${(c.full_name || '').replace(/'/g, '')}')" style="background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);color:#5DADE2;">👁 تفصيل</button>
          <button class="admin-btn admin-btn-danger" onclick="adminDeleteUser('${c.uid}', 'client', '${(c.full_name || '').replace(/'/g, '')}')">🗑 حذف</button>
          <button class="admin-btn" onclick="adminBlockUser('${c.uid}','${(c.full_name || '').replace(/'/g, '')}','${c.email || ''}')" style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);color:#E74C3C;margin-top:4px;">🚫 بلوك</button></td>
    </tr>`).join('');
    }

    function renderAdminOrders(_list) {
      const list = _list || _adminData.orders;
      const tbody = document.getElementById('adm-orders-body');
      if (!tbody) return;
      // mini stats
      const setText2 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      const allOrders = _adminData.orders;
      const pendingAdminCount = allOrders.filter(o => o.status === 'pending_admin').length;
      setText2('adm-ord-mini-pending-admin', pendingAdminCount);
      setText2('adm-ord-mini-pending', allOrders.filter(o => ['pending', 'price_offered', 'client_counter'].includes(o.status)).length);
      setText2('adm-ord-mini-accepted', allOrders.filter(o => ['accepted', 'worker_done_pending'].includes(o.status)).length);
      setText2('adm-ord-mini-done', allOrders.filter(o => o.status === 'done').length);
      setText2('adm-ord-mini-cancelled', allOrders.filter(o => o.status === 'cancelled').length);
      const totalRevenue = allOrders.filter(o => o.status === 'done').reduce((acc, o) => acc + (parseFloat(o.offered_price || o.client_counter_price || 0)), 0);
      setText2('adm-ord-mini-revenue', totalRevenue > 0 ? totalRevenue.toLocaleString('ar-EG') + ' ج' : '-');

      // ===== الإحصائيات المالية =====
      (async () => {
        try {
          // ── طلبات عادية منجزة ──
          const regularDone = allOrders.filter(o => o.status === 'done');
          const regularRev  = regularDone.reduce((s, o) => s + parseFloat(o.offered_price || o.client_counter_price || 0), 0);

          // ── طلبات السوق منجزة ──
          const marketOrders = Object.values(_adminMarketAll || {});
          const marketDone   = marketOrders.filter(r => r.status === 'done');
          const marketRev    = marketDone.reduce((s, r) => {
            const offer = r.accepted_offer_id && r.offers ? r.offers[r.accepted_offer_id] : null;
            return s + parseFloat(offer?.price || 0);
          }, 0);

          // ── محافظ الصنايعية ──
          const wallSnap = await get(ref(db, 'wallets'));
          const wallets  = wallSnap.exists() ? Object.values(wallSnap.val()) : [];
          const commissionCollected = wallets.reduce((s, w) => s + parseFloat(w.total_deducted || 0), 0);
          const commissionPending   = wallets.reduce((s, w) => s + parseFloat(w.pending_commission_debt || 0), 0);
          const commissionTotal     = commissionCollected + commissionPending;

          const fmt = n => n > 0 ? n.toLocaleString('ar-EG', {maximumFractionDigits:0}) + ' ج' : '-';
          setText2('fin-regular-revenue',      fmt(regularRev));
          setText2('fin-regular-count',        regularDone.length + ' طلب');
          setText2('fin-market-revenue',       fmt(marketRev));
          setText2('fin-market-count',         marketDone.length + ' طلب');
          setText2('fin-total-revenue',        fmt(regularRev + marketRev));
          setText2('fin-total-count',          (regularDone.length + marketDone.length) + ' طلب');
          setText2('fin-commission-collected', fmt(commissionCollected));
          setText2('fin-commission-pending',   fmt(commissionPending));
          setText2('fin-commission-total',     fmt(commissionTotal));
        } catch(e) { console.error('fin stats error', e); }
      })();
      // badge على التبويب الجانبي
      const ordBadge = document.getElementById('atab-orders-badge');
      if (ordBadge) { ordBadge.textContent = pendingAdminCount || ''; ordBadge.style.display = pendingAdminCount > 0 ? 'inline-flex' : 'none'; }
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا توجد طلبات</td></tr>'; return; }
      tbody.innerHTML = list.slice(0, 50).map((o, i) => `
    <tr>
      <td style="color:rgba(255,255,255,0.3);font-size:11px;">${i + 1}</td>
      <td><code style="color:#C8873A;font-size:12px;">#${o.order_number || o._key?.slice(-6) || '-'}</code></td>
      <td>${o.client_name || '-'}</td>
      <td>${o.service_type || '-'}</td>
      <td style="font-size:12px;color:rgba(255,255,255,0.5);">${o.area || '-'}</td>
      <td>${o.worker_name ? `<span style="font-size:12px;">🔧 ${o.worker_name}</span>` : '<span style="color:rgba(255,255,255,0.3);font-size:11px;">-</span>'}</td>
      <td>${o.offered_price || o.client_counter_price ? `<span style="color:#1ABC9C;font-weight:700;">${o.offered_price || o.client_counter_price} ج</span>` : '-'}</td>
      <td>${statusBadge(o.status)}</td>
      <td style="font-size:11px;color:rgba(255,255,255,0.4);">${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        ${o.status === 'pending_admin' ? `<button class="admin-btn" style="background:rgba(52,152,219,0.18);border:1px solid rgba(52,152,219,0.5);color:#3498DB;font-weight:800;" onclick="adminOpenAssignModal('${o._key}')">🛠️ تعيين</button>` : ''}
        ${o.worker_id && o.user_id ? `<button class="admin-btn" style="background:rgba(26,188,156,0.15);border:1px solid rgba(26,188,156,0.4);color:#1ABC9C;" onclick="adminViewChat('${o.user_id}','${o.worker_id}','${(o.client_name||'عميل').replace(/'/g,'')}','${(o.worker_name||'صنايعي').replace(/'/g,'')}')">💬 شات</button>` : ''}
        <button class="admin-btn admin-btn-danger" onclick="adminDeleteOrder('${o._key}')">🗑</button>
      </td>
    </tr>`).join('');
    }

    // ===== ADMIN: ASSIGN WORKER + SET MANUAL COMMISSION (service_requests) =====
    let _adminAssignOrderKey = null;
    let _adminAssignSuggested = null;

    // بتجيب IDs كل الصنايعية المشغولين دلوقتي بطلب شغّال (سواء من النظام المباشر أو السوق)
    // عشان نمنع أي صنايعي ياخد طلب جديد لحد ما يخلص اللي معاه ويتأكد إنه خلصه
    async function getBusyWorkerIds() {
      const busy = new Map(); // workerId -> { source, title }
      const inProgressDirect = ['accepted', 'worker_done_pending', 'client_initiated_done'];
      const inProgressMarket = ['accepted', 'pending_client_confirm', 'client_done_pending'];
      try {
        const srSnap = await get(ref(db, 'service_requests'));
        if (srSnap.exists()) {
          Object.values(srSnap.val()).forEach(o => {
            if (o.worker_id && inProgressDirect.includes(o.status)) {
              busy.set(o.worker_id, { source: 'direct', title: o.service_type || 'طلب', orderNum: o.order_number });
            }
          });
        }
      } catch (e) { console.error('getBusyWorkerIds (direct) error:', e); }
      try {
        const crSnap = await get(ref(db, 'client_requests'));
        if (crSnap.exists()) {
          Object.values(crSnap.val()).forEach(r => {
            if (r.accepted_worker_id && inProgressMarket.includes(r.status)) {
              busy.set(r.accepted_worker_id, { source: 'market', title: r.title || r.service || 'طلب' });
            }
          });
        }
      } catch (e) { console.error('getBusyWorkerIds (market) error:', e); }
      return busy;
    }
    window.getBusyWorkerIds = getBusyWorkerIds;

    let _adminAssignBusyMap = new Map();

    async function adminOpenAssignModal(orderKey) {
      try {
        const order = _adminData.orders.find(o => o._key === orderKey);
        if (!order) { showAdminToast('❌ مالقيتش الطلب ده'); return; }
        _adminAssignOrderKey = orderKey;
        _adminAssignSuggested = order.requested_worker_id ? { id: order.requested_worker_id, name: order.requested_worker_name || 'صنايعي' } : null;

        document.getElementById('adm-assign-order-num').textContent = '# ' + (order.order_number || orderKey);
        document.getElementById('adm-assign-order-summary').innerHTML =
          '<div><strong>' + (order.service_type || 'خدمة') + '</strong></div>' +
          '<div>👤 ' + (order.client_name || '-') + ' — 📞 ' + (order.client_phone || '-') + '</div>' +
          '<div>📍 ' + (order.area || '') + (order.address ? ' — ' + order.address : '') + '</div>' +
          (order.description ? '<div style="margin-top:4px;color:rgba(255,255,255,0.5);">📝 ' + order.description + '</div>' : '') +
          (order.details && Object.keys(order.details).length ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">' + formatProfessionDetailsHTML(order.details) + '</div>' : '');

        const suggestedBox = document.getElementById('adm-assign-suggested-box');
        if (_adminAssignSuggested) {
          suggestedBox.style.display = 'block';
          document.getElementById('adm-assign-suggested-name').textContent = '🔧 ' + _adminAssignSuggested.name;
        } else {
          suggestedBox.style.display = 'none';
        }

        const select = document.getElementById('adm-assign-worker-select');
        select.innerHTML = '<option value="">⏳ بنتأكد من المشغولين دلوقتي...</option>';
        const workers = [..._adminData.workers].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
        _adminAssignBusyMap = await getBusyWorkerIds();
        select.innerHTML = '<option value="">— اختار صنايعي —</option>' + workers.map(w => {
          const busy = _adminAssignBusyMap.get(w.uid);
          const statusTag = busy ? '🔴 مشغول بطلب حالي' : (w.craftsmanData?.available ? '🟢' : '🔴');
          return `<option value="${w.uid}" ${busy ? 'disabled' : ''}>${(w.full_name || 'صنايعي')} — ${(w.trade || w.craftsmanData?.trade || '')} ${statusTag}</option>`;
        }).join('');
        document.getElementById('adm-assign-tier-preview').style.display = 'none';
        if (_adminAssignSuggested && workers.some(w => w.uid === _adminAssignSuggested.id)) {
          if (_adminAssignBusyMap.has(_adminAssignSuggested.id)) {
            showAdminToast('⚠️ الصنايعي المقترح "' + _adminAssignSuggested.name + '" مشغول بطلب حالي دلوقتي');
          } else {
            select.value = _adminAssignSuggested.id;
            adminPreviewWorkerTier();
          }
        }

        document.getElementById('adm-assign-amount').value = '';
        document.getElementById('adm-assign-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
      } catch (e) {
        console.error('adminOpenAssignModal error:', e);
        alert('⚠️ خطأ تشخيصي: ' + e.message);
      }
    }
    window.adminOpenAssignModal = adminOpenAssignModal;

    function adminCloseAssignModal() {
      document.getElementById('adm-assign-modal').style.display = 'none';
      document.body.style.overflow = '';
      _adminAssignOrderKey = null;
      _adminAssignSuggested = null;
    }
    window.adminCloseAssignModal = adminCloseAssignModal;

    function adminUseSuggestedWorker() {
      if (!_adminAssignSuggested) return;
      if (_adminAssignBusyMap.has(_adminAssignSuggested.id)) { showAdminToast('⚠️ الصنايعي ده مشغول بطلب حالي دلوقتي'); return; }
      const select = document.getElementById('adm-assign-worker-select');
      const exists = Array.from(select.options).some(o => o.value === _adminAssignSuggested.id);
      if (!exists) { showAdminToast('⚠️ الصنايعي المقترح مش موجود في القايمة'); return; }
      select.value = _adminAssignSuggested.id;
      adminPreviewWorkerTier();
    }
    window.adminUseSuggestedWorker = adminUseSuggestedWorker;

    // بتعرض نسبة العمولة اللي وصلها الصنايعي حسب مستواه الحالي (للمعاينة بس — مش هي اللي هتتطبق)
    async function adminPreviewWorkerTier() {
      const box = document.getElementById('adm-assign-tier-preview');
      const workerId = document.getElementById('adm-assign-worker-select').value;
      if (!workerId) { box.style.display = 'none'; return; }
      try {
        box.style.display = 'block';
        box.textContent = '⏳ بنجيب مستوى الصنايعي...';
        const wSnap = await get(walletRef(workerId));
        const wData = wSnap.exists() ? wSnap.val() : { completed_orders: 0 };
        const completed = wData.completed_orders || 0;
        let preview;
        if (typeof window.getEffectiveCommission === 'function') {
          preview = await window.getEffectiveCommission(workerId, 100, completed);
        } else if (typeof window.getTier === 'function') {
          const t = window.getTier(completed);
          preview = { rate: t.rate, label: t.label };
        }
        if (preview) {
          box.textContent = '📊 مستوى الصنايعي الحالي: ' + preview.label + ' — نسبته المعتادة ' + (preview.rate * 100).toFixed(0) + '% (' + completed + ' طلب منجز)';
        } else {
          box.style.display = 'none';
        }
      } catch (e) {
        console.error('adminPreviewWorkerTier error:', e);
        box.style.display = 'none';
      }
    }
    window.adminPreviewWorkerTier = adminPreviewWorkerTier;

    async function adminConfirmAssign() {
      if (!_adminAssignOrderKey) return;
      const orderKey = _adminAssignOrderKey;
      const workerId = document.getElementById('adm-assign-worker-select').value;
      const amountInput = document.getElementById('adm-assign-amount').value;
      const amountVal = parseFloat(amountInput);

      if (!workerId) { showAdminToast('⚠️ اختار صنايعي الأول'); return; }
      if (amountInput === '' || isNaN(amountVal) || amountVal < 0) { showAdminToast('⚠️ اكتب قيمة عمولة صحيحة بالجنيه'); return; }

      const worker = _adminData.workers.find(w => w.uid === workerId);
      const order = _adminData.orders.find(o => o._key === orderKey);
      if (!worker || !order) { showAdminToast('❌ حصل خطأ، حاول تاني'); return; }

      const btn = document.getElementById('adm-assign-confirm-btn');
      btn.disabled = true; btn.textContent = 'جاري التأكد...';
      // فحص أخير قبل الحفظ — لو الصنايعي بقى مشغول بطلب من لحظة فتح الفورم لحد دلوقتي
      const freshBusy = await getBusyWorkerIds();
      if (freshBusy.has(workerId)) {
        showAdminToast('🔴 الصنايعي ده بقى مشغول بطلب تاني، اختار حد غيره');
        btn.disabled = false; btn.innerHTML = '<span>✅</span> أرسل الطلب للصنايعي';
        adminOpenAssignModal(orderKey);
        return;
      }
      btn.textContent = 'جاري الإرسال...';
      try {
        await update(ref(db, 'service_requests/' + orderKey), {
          worker_id: workerId,
          worker_name: worker.full_name || 'صنايعي',
          worker_phone: worker.phone || '',
          status: 'pending',
          commission_amount_override: amountVal,
          commission_set_by_admin: true,
          commission_set_at: new Date().toISOString()
        });
        await push(ref(db, 'notifications/' + workerId), {
          type: 'new_request',
          title: 'طلب خدمة جديد! 🔔',
          body: (order.client_name || 'عميل') + ' عايز ' + (order.service_type || 'خدمة') + ' في ' + (order.area || order.address || ''),
          client_id: order.user_id || null,
          client_name: order.client_name || '',
          order_num: orderKey,
          read: false,
          created_at: new Date().toISOString()
        });
        showAdminToast('✅ تم إرسال الطلب للصنايعي');
        adminCloseAssignModal();
      } catch (e) {
        console.error(e);
        showAdminToast('❌ حصل خطأ، حاول تاني');
      } finally {
        btn.disabled = false; btn.innerHTML = '<span>✅</span> أرسل الطلب للصنايعي';
      }
    }
    window.adminConfirmAssign = adminConfirmAssign;

    function renderAdminRatings(filterStars) {
      const el = document.getElementById('adm-ratings-list');
      const summaryEl = document.getElementById('adm-ratings-summary');
      if (!el) return;
      // Render summary bar
      if (summaryEl) {
        if (!filterStars) {
        const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        _adminData.ratings.forEach(r => { if (r.stars >= 1 && r.stars <= 5) dist[r.stars]++; });
        const maxD = Math.max(...Object.values(dist), 1);
        summaryEl.innerHTML = `<div style="font-size:13px;font-weight:800;color:rgba(255,255,255,0.6);margin-bottom:12px;">توزيع التقييمات (${_adminData.ratings.length} تقييم)</div>` +
          [5, 4, 3, 2, 1].map(s => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <div style="width:36px;flex-shrink:0;text-align:right;font-size:12px;color:#C8873A;font-weight:700;">${'★'.repeat(s)}</div>
            <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;direction:ltr;">
              <div style="height:100%;width:${(dist[s] / maxD) * 100}%;background:linear-gradient(90deg,#C8873A,#E09940);border-radius:4px;"></div>
            </div>
            <div style="width:24px;flex-shrink:0;font-size:12px;color:rgba(255,255,255,0.5);text-align:center;">${dist[s]}</div>
          </div>`).join('');
        summaryEl.style.display = 'block';
        } else {
          summaryEl.innerHTML = '';
          summaryEl.style.display = 'none';
        }
      }
      const list = filterStars ? _adminData.ratings.filter(r => r.stars === filterStars) : _adminData.ratings;
      if (!list.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">لا توجد تقييمات</p>'; return; }
      el.innerHTML = list.slice(0, 40).map(r => {
        const stars = '★'.repeat(r.stars || 0) + '☆'.repeat(5 - (r.stars || 0));
        const starColor = r.stars >= 4 ? '#27AE60' : r.stars >= 3 ? '#C8873A' : '#E74C3C';
        return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px 16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:#fff;white-space:nowrap;">👤 ${r.from_name || '-'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.3);">→</div>
          <div style="font-size:13px;font-weight:700;color:#C8873A;white-space:nowrap;">🔧 ${r.worker_name || '-'}</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.3);flex-shrink:0;direction:ltr;white-space:nowrap;">${r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : ''}</div>
      </div>
      <div style="color:${starColor};font-size:18px;letter-spacing:3px;margin-bottom:6px;">${stars}</div>
      ${r.comment ? `<div style="font-size:13px;color:rgba(255,255,255,0.6);font-style:italic;background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:8px;border-right:3px solid rgba(200,135,58,0.4);">"${r.comment}"</div>` : ''}
    </div>`;
      }).join('');
    }
    window.filterAdminRatings = function (stars) {
      document.querySelectorAll('[id^="adm-rat-tab-"]').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderColor = 'rgba(255,255,255,0.1)';
        b.style.color = 'rgba(255,255,255,0.4)';
      });
      const active = document.getElementById('adm-rat-tab-' + stars);
      if (active) { active.style.background = 'rgba(200,135,58,0.15)'; active.style.borderColor = '#C8873A'; active.style.color = '#C8873A'; active.style.fontWeight = '800'; }
      renderAdminRatings(stars === 0 ? null : stars);
    };

    function renderAdminActivity(filterType) {
      const tbody = document.getElementById('adm-activity-body');
      if (!tbody) return;
      // Build events from orders
      const statusLabels = { pending_admin: 'طلب جديد', pending: 'طلب جديد', price_offered: 'عرض سعر', client_counter: 'مفاوضة', accepted: 'مقبول', worker_done_pending: 'انتظار التأكيد', done: 'منجز', cancelled: 'ملغي' };
      const statusColors = { pending_admin: '#3498DB', pending: '#C8873A', price_offered: '#E67E22', client_counter: '#9B59B6', accepted: '#2E86C1', worker_done_pending: '#1ABC9C', done: '#27AE60', cancelled: '#E74C3C' };
      const orderEvents = _adminData.orders.slice(0, 20).map(o => ({
        type: 'order',
        icon: o.status === 'done' ? '🏁' : o.status === 'cancelled' ? '❌' : o.status === 'accepted' ? '✅' : '📋',
        iconBg: `rgba(${o.status === 'done' ? '30,132,73' : o.status === 'cancelled' ? '192,57,43' : o.status === 'accepted' ? '46,134,193' : '200,135,58'},0.15)`,
        event: statusLabels[o.status] || o.status,
        user: o.client_name || 'عميل',
        detail: `${o.service_type || '-'} — ${o.area || '-'}${o.worker_name ? ' → ' + o.worker_name : ''}`,
        time: o.created_at || '',
        color: statusColors[o.status] || '#C8873A'
      }));
      const marketEvents = [];
      Object.values(_adminMarketAll).slice(0, 15).forEach(r => {
        marketEvents.push({ type: 'order', icon: '🏪', iconBg: 'rgba(155,89,182,0.15)', event: 'طلب سوق', user: r.user_name || 'عميل', detail: `${r.title || r.service || 'خدمة'} — ${r.area || ''}`, time: r.created_at || '', color: '#9B59B6' });
        if (r.offers) {
          Object.values(r.offers).forEach(o => {
            marketEvents.push({ type: 'order', icon: '💼', iconBg: 'rgba(230,126,34,0.15)', event: 'عرض سوق', user: o.worker_name || 'صنايعي', detail: `${o.price} جنيه على "${r.title || r.service || 'طلب'}"`, time: o.created_at || '', color: '#E67E22' });
          });
        }
      });
      const ratingEvents = _adminData.ratings.slice(0, 10).map(r => ({
        type: 'rating', icon: '⭐', iconBg: 'rgba(200,135,58,0.15)', event: 'تقييم جديد', user: r.from_name || '-', detail: `${'★'.repeat(r.stars || 0)} على ${r.worker_name || '-'}${r.comment ? ' — "' + r.comment.slice(0, 40) + '"' : ''}`, time: r.created_at || '', color: '#C8873A'
      }));
      let allEvents = [...orderEvents, ...marketEvents, ...ratingEvents].sort((a, b) => (b.time || '').localeCompare(a.time || '')).slice(0, 50);
      if (filterType && filterType !== '') allEvents = allEvents.filter(e => e.type === filterType);
      if (!allEvents.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا يوجد نشاط</td></tr>'; return; }
      tbody.innerHTML = allEvents.map((e, i) => `<tr>
        <td style="color:rgba(255,255,255,0.25);font-size:11px;">${i + 1}</td>
        <td><div style="display:flex;align-items:center;gap:8px;"><div style="width:30px;height:30px;border-radius:8px;background:${e.iconBg};display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">${e.icon}</div><span style="font-size:12px;font-weight:700;color:${e.color};">${e.event}</span></div></td>
        <td style="font-size:13px;font-weight:600;">${e.user}</td>
        <td style="font-size:12px;color:rgba(255,255,255,0.55);">${e.detail}</td>
        <td style="font-size:11px;color:rgba(255,255,255,0.35);white-space:nowrap;">${e.time ? new Date(e.time).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
      </tr>`).join('');
    }
    window.filterActivityLog = function () {
      const v = document.getElementById('adm-activity-filter')?.value || '';
      renderAdminActivity(v);
    };

    // Admin actions
    async function adminToggleWorker(uid, available) {
      try {
        await update(ref(db, 'craftsmen/' + uid), { available });
        showToast(available ? '✅ تم تفعيل الصنايعي' : '⛔ تم إيقاف الصنايعي', available ? '#1E8449' : '#C0392B');
        await loadAdminData();
      } catch (e) { alert('حصل خطأ'); }
    }
    window.adminToggleWorker = adminToggleWorker;

    // ===== مزامنة حالة كل الصنايعية مع رصيدهم =====
    window.syncAllWorkersAvailability = async function () {
      if (!confirm('هيتم مراجعة رصيد كل الصنايعية وتحديث حالتهم أوتوماتيك:\n✅ رصيد > 0 → متاح\n❌ رصيد = 0 → غير متاح\n\nهتكمل؟')) return;
      try {
        const [cSnap, wSnap] = await Promise.all([
          get(ref(db, 'craftsmen')),
          get(ref(db, 'wallets'))
        ]);
        if (!cSnap.exists()) { showToast('مفيش صنايعية', '#E74C3C'); return; }
        const wallets = wSnap.exists() ? wSnap.val() : {};
        const workers = Object.entries(cSnap.val());
        let activated = 0, deactivated = 0;
        await Promise.all(workers.map(async ([uid]) => {
          const w = wallets[uid];
          const bal = (w && typeof w.balance === 'number') ? w.balance : 0;
          const shouldBeAvailable = bal > 0;
          await update(ref(db, 'craftsmen/' + uid), { available: shouldBeAvailable });
          if (shouldBeAvailable) activated++; else deactivated++;
        }));
        showToast(`✅ تم! ${activated} متاح — ${deactivated} غير متاح`, '#2ECC71');
        await loadAdminData();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ', '#E74C3C'); }
    };

    async function adminDeleteUser(uid, role, name) {
      if (!confirm(`⚠️ هتحذف ${role === 'worker' ? 'الصنايعي' : 'العميل'} "${name}" — متأكد؟`)) return;
      try {
        // اكتب علامة الحذف أولاً عشان اليوزر يتطرد فوراً لو مسجل دخول
        await set(ref(db, 'deleted_users/' + uid), true);
        // بعدين احذف البيانات
        await set(ref(db, 'profiles/' + uid), null);
        if (role === 'worker') await set(ref(db, 'craftsmen/' + uid), null);
        showToast('تم الحذف بنجاح', '#C0392B');
        await loadAdminData();
      } catch (e) { alert('حصل خطأ في الحذف'); }
    }
    window.adminDeleteUser = adminDeleteUser;

    // ===== BLOCK USER SYSTEM =====
    function adminBlockUser(uid, name, email) {
      // أنشئ الـ modal
      const existing = document.getElementById('block-modal-overlay');
      if (existing) existing.remove();
      document.body.insertAdjacentHTML('beforeend', `
        <div id="block-modal-overlay" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:1rem;">
          <div style="background:#1C1A17;border:1px solid rgba(200,135,58,0.3);border-radius:20px;padding:2rem;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
            <div style="text-align:center;margin-bottom:1.5rem;">
              <div style="font-size:2.5rem;margin-bottom:8px;">🚫</div>
              <div style="font-size:17px;font-weight:900;color:#fff;margin-bottom:4px;">بلوك حساب</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.45);">${name} · ${email}</div>
            </div>

            <div style="margin-bottom:1rem;">
              <label style="font-size:13px;color:rgba(255,255,255,0.5);display:block;margin-bottom:8px;">مدة الحظر</label>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;" id="block-duration-btns">
                ${[1, 3, 7, 14].map(d => `
                  <button onclick="selectBlockDuration(${d})" id="bdb-${d}"
                    style="padding:10px 6px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.6);font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s;">
                    ${d} يوم${d > 2 ? '' : ''}
                  </button>`).join('')}
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
                <label style="font-size:12px;color:rgba(255,255,255,0.4);">أو أدخل عدد الأيام يدوياً:</label>
                <input type="number" id="block-custom-days" min="1" max="365" placeholder="0"
                  oninput="selectBlockDuration(null)"
                  style="width:70px;padding:8px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-family:'Cairo',sans-serif;font-size:14px;text-align:center;outline:none;"
                  onfocus="this.style.borderColor='#C8873A'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'">
              </div>
            </div>

            <div style="margin-bottom:1.5rem;">
              <label style="font-size:13px;color:rgba(255,255,255,0.5);display:block;margin-bottom:8px;">سبب الحظر (اختياري)</label>
              <textarea id="block-reason" placeholder="مثال: مخالفة شروط الاستخدام..."
                style="width:100%;padding:11px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:'Cairo',sans-serif;font-size:13px;resize:none;height:70px;outline:none;"
                onfocus="this.style.borderColor='#C8873A'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'"></textarea>
            </div>

            <div style="display:flex;gap:10px;">
              <button onclick="confirmBlockUser('${uid}','${name}')"
                style="flex:2;padding:13px;background:linear-gradient(135deg,#C0392B,#922B21);color:#fff;border:none;border-radius:11px;font-family:'Cairo',sans-serif;font-size:15px;font-weight:900;cursor:pointer;">
                🚫 تأكيد الحظر
              </button>
              <button onclick="document.getElementById('block-modal-overlay').remove()"
                style="flex:1;padding:13px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);border-radius:11px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      `);
    }
    window.adminBlockUser = adminBlockUser;

    let _selectedBlockDays = 3;
    function selectBlockDuration(days) {
      _selectedBlockDays = days;
      document.querySelectorAll('[id^="bdb-"]').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderColor = 'rgba(255,255,255,0.1)';
        b.style.color = 'rgba(255,255,255,0.6)';
      });
      if (days) {
        const btn = document.getElementById('bdb-' + days);
        if (btn) {
          btn.style.background = 'rgba(192,57,43,0.2)';
          btn.style.borderColor = 'rgba(192,57,43,0.6)';
          btn.style.color = '#E74C3C';
        }
        const inp = document.getElementById('block-custom-days');
        if (inp) inp.value = '';
      }
    }
    window.selectBlockDuration = selectBlockDuration;

    async function confirmBlockUser(uid, name) {
      const customDays = parseInt(document.getElementById('block-custom-days')?.value);
      const days = customDays > 0 ? customDays : (_selectedBlockDays || 3);
      const reason = document.getElementById('block-reason')?.value.trim() || 'مخالفة الشروط';
      if (!days || days < 1) { showToast('اختار مدة الحظر', '#E74C3C'); return; }
      const unblockAt = new Date(Date.now() + days * 86400000).toISOString();
      try {
        await set(ref(db, 'blocked_users/' + uid), {
          uid, name,
          reason,
          days,
          blocked_at: new Date().toISOString(),
          unblock_at: unblockAt,
          blocked_by: currentUser.uid
        });
        document.getElementById('block-modal-overlay')?.remove();
        showToast(`✅ تم حظر "${name}" لمدة ${days} يوم`, '#E74C3C');
      } catch (e) { alert('حصل خطأ أثناء الحظر'); }
    }
    window.confirmBlockUser = confirmBlockUser;
    // ===== END BLOCK USER SYSTEM =====

    async function adminDeleteOrder(key) {
      if (!confirm('⚠️ هتحذف الطلب ده — متأكد؟')) return;
      try {
        await set(ref(db, 'service_requests/' + key), null);
        showToast('تم حذف الطلب', '#C0392B');
        await loadAdminData();
      } catch (e) { alert('حصل خطأ'); }
    }
    window.adminDeleteOrder = adminDeleteOrder;

    // ===== ADMIN VIEW CHAT BETWEEN CLIENT & WORKER =====
    window.adminViewChat = async function (clientId, workerId, clientName, workerName) {
      const chatId = [clientId, workerId].sort().join('_');
      let modal = document.getElementById('admin-chat-view-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-chat-view-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        modal.innerHTML = `
        <div style="background:#1C1A17;border:1.5px solid rgba(26,188,156,0.4);border-radius:20px;padding:0;width:100%;max-width:460px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;">
            <div>
              <div style="font-size:16px;font-weight:900;" id="acv-title">💬 الشات</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;" id="acv-sub"></div>
            </div>
            <button onclick="document.getElementById('admin-chat-view-modal').style.display='none'" style="background:rgba(255,255,255,0.07);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <div id="acv-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;min-height:200px;max-height:60vh;">
            <div style="text-align:center;color:rgba(255,255,255,0.3);font-size:13px;padding:20px;">جاري التحميل...</div>
          </div>
        </div>`;
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      document.getElementById('acv-title').textContent = '💬 شات: ' + clientName + ' ↔ ' + workerName;
      document.getElementById('acv-sub').textContent = 'قراءة فقط — مش بتتدخل';
      const container = document.getElementById('acv-messages');
      container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:13px;padding:20px;">جاري التحميل...</div>';
      try {
        const snap = await get(ref(db, 'chats/' + chatId + '/messages'));
        if (!snap.exists()) {
          container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:13px;padding:30px;">لا يوجد رسائل في هذا الشات</div>';
          return;
        }
        const msgs = Object.values(snap.val() || {});
        // دعم حقول الوقت المختلفة: ts أو timestamp أو created_at
        msgs.sort((a, b) => {
          const ta = a.ts || a.timestamp || (a.created_at ? new Date(a.created_at).getTime() : 0);
          const tb = b.ts || b.timestamp || (b.created_at ? new Date(b.created_at).getTime() : 0);
          return ta - tb;
        });
        container.innerHTML = msgs.map(m => {
          // دعم حقول المُرسِل المختلفة: sender أو sender_id أو from
          const senderId = m.sender || m.sender_id || m.from || '';
          const isClient = senderId === clientId;
          const senderLabel = isClient ? clientName : workerName;
          const senderIcon = isClient ? '👤' : '🔧';
          const align = isClient ? 'flex-start' : 'flex-end';
          const bg = isClient ? 'rgba(52,152,219,0.15)' : 'rgba(200,135,58,0.15)';
          const border = isClient ? 'rgba(52,152,219,0.3)' : 'rgba(200,135,58,0.3)';
          // دعم حقول الوقت المختلفة
          const msgTime = m.ts || m.timestamp || (m.created_at ? new Date(m.created_at).getTime() : 0);
          const dt = msgTime ? new Date(msgTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
          const contentHTML = m.image
            ? `<img src="${m.image}" style="max-width:180px;border-radius:8px;display:block;margin-bottom:4px;" onclick="window.open(this.src,'_blank')">`
            : `<div style="font-size:13px;line-height:1.6;">${(m.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
          return `<div style="display:flex;justify-content:${align};">
            <div style="max-width:75%;background:${bg};border:1px solid ${border};border-radius:12px;padding:8px 12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px;">${senderIcon} ${senderLabel}</div>
              ${contentHTML}
              <div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:4px;text-align:left;direction:ltr;">${dt}</div>
            </div>
          </div>`;
        }).join('');
        // scroll to bottom
        container.scrollTop = container.scrollHeight;
      } catch (e) {
        console.error('adminViewChat error:', e);
        container.innerHTML = '<div style="text-align:center;color:#E74C3C;font-size:13px;padding:20px;">❌ حصل خطأ في تحميل الشات</div>';
      }
    };

    window.exportOrdersCSV = function () {
      const orders = _adminData.orders;
      if (!orders.length) { showToast('لا توجد طلبات للتصدير', '#E74C3C'); return; }
      const headers = ['رقم الطلب', 'العميل', 'الخدمة', 'المنطقة', 'الصنايعي', 'السعر', 'الحالة', 'التاريخ'];
      const rows = orders.map(o => [
        o.order_number || '', o.client_name || '', o.service_type || '', o.area || '',
        o.worker_name || '', o.offered_price || o.client_counter_price || '',
        o.status || '', o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : ''
      ]);
      const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'orders_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
      URL.revokeObjectURL(url);
      showToast('✅ تم تصدير ' + orders.length + ' طلب', '#27AE60');
    };

    window.filterWorkersByStatus = function () {
      const val = document.getElementById('adm-workers-filter')?.value || '';
      const filtered = val === 'available' ? _adminData.workers.filter(w => w.craftsmanData?.available)
        : val === 'busy' ? _adminData.workers.filter(w => !w.craftsmanData?.available)
          : _adminData.workers;
      renderAdminWorkers(filtered);
    };

    function filterAdminTable(type, query) {
      const q = query.trim().toLowerCase();
      if (type === 'workers') {
        const filtered = q ? _adminData.workers.filter(w => (w.full_name || '').toLowerCase().includes(q) || (w.trade || '').toLowerCase().includes(q) || (w.area || '').toLowerCase().includes(q)) : _adminData.workers;
        renderAdminWorkers(filtered);
      } else if (type === 'clients') {
        const filtered = q ? _adminData.clients.filter(c => (c.full_name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)) : _adminData.clients;
        renderAdminClients(filtered);
      } else if (type === 'orders') {
        const filtered = q ? _adminData.orders.filter(o => (o.client_name || '').toLowerCase().includes(q) || (o.service_type || '').includes(q) || (o.worker_name || '').toLowerCase().includes(q)) : _adminData.orders;
        renderAdminOrders(filtered);
      }
    }
    window.filterAdminTable = filterAdminTable;

    function loadAdminOrders() {
      const f = document.getElementById('adm-orders-filter')?.value;
      const list = f ? _adminData.orders.filter(o => o.status === f) : _adminData.orders;
      renderAdminOrders(list);
    }
    window.loadAdminOrders = loadAdminOrders;

    // ===== ADMIN MARKET =====
    let _adminMarketAll = {}; // keyed by reqId
    let _adminMarketListener = null;

    function startAdminMarketListener() {
      if (_adminMarketListener) { _adminMarketListener(); _adminMarketListener = null; }
      _adminMarketListener = onValue(ref(db, 'client_requests'), snap => {
        _adminMarketAll = {};
        if (snap.exists()) {
          Object.entries(snap.val()).forEach(([id, r]) => { _adminMarketAll[id] = { ...r, id }; });
        }
        // sync into _adminData so renderAdminWorkers can count market orders per worker
        _adminData.marketOrders = Object.values(_adminMarketAll);
        // update overview stats
        const all = Object.values(_adminMarketAll);
        const pendingAdminCount = all.filter(r => r.status === 'pending_admin').length;
        const openCount = all.filter(r => r.status === 'open').length;
        const totalOffers = all.reduce((s, r) => s + (r.offers ? Object.keys(r.offers).length : 0), 0);
        const acceptedCount = all.filter(r => r.status === 'accepted' || r.status === 'done').length;
        setText('adm-market-open', openCount);
        setText('adm-market-total', all.length + ' إجمالي');
        setText('adm-market-offers', totalOffers);
        setText('adm-market-accepted', acceptedCount + ' مقبول');
        // badge on sidebar — بيعرض عدد الطلبات بانتظار مراجعتك ونشرك ليها
        const badge = document.getElementById('atab-market-badge');
        if (badge) { badge.textContent = pendingAdminCount || ''; badge.style.display = pendingAdminCount > 0 ? 'inline-flex' : 'none'; }
        // re-render if tab is active
        const sec = document.getElementById('asec-market');
        if (sec && sec.classList.contains('active')) adminRenderMarket();
      });
    }

    function adminRenderMarket(_list) {
      const all = _list || Object.values(_adminMarketAll);
      const f = document.getElementById('adm-market-filter')?.value || '';
      const q = (document.getElementById('adm-market-search')?.value || '').toLowerCase().trim();
      let list = [...all];
      if (f) list = list.filter(r => r.status === f);
      if (q) list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.user_name || '').toLowerCase().includes(q) ||
        (r.service || '').toLowerCase().includes(q) ||
        (r.area || '').toLowerCase().includes(q)
      );
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      // mini stats
      const allV = Object.values(_adminMarketAll);
      setText('adm-m-stat-pending-admin', allV.filter(r => r.status === 'pending_admin').length);
      setText('adm-m-stat-open', allV.filter(r => r.status === 'open').length);
      setText('adm-m-stat-offers', allV.reduce((s, r) => s + (r.offers ? Object.keys(r.offers).length : 0), 0));
      setText('adm-m-stat-accepted', allV.filter(r => r.status === 'accepted').length);
      setText('adm-m-stat-cancelled', allV.filter(r => r.status === 'cancelled').length);

      const tbody = document.getElementById('adm-market-body');
      if (!tbody) return;
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا توجد طلبات</td></tr>';
        return;
      }
      const mStatusBadge = s => {
        const map = { pending_admin: ['#3498DB', '🕓 بانتظار مراجعتك'], open: ['#9B59B6', '🟢 مفتوح'], accepted: ['#E67E22', '🔄 مقبول'], done: ['#27AE60', '✅ منتهي'], cancelled: ['#E74C3C', '❌ ملغي'] };
        const [c, l] = map[s] || ['#888', s];
        return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">${l}</span>`;
      };
      tbody.innerHTML = list.map(r => {
        const offersCount = r.offers ? Object.keys(r.offers).length : 0;
        const acceptedOffer = r.accepted_offer_id && r.offers ? r.offers[r.accepted_offer_id] : null;
        const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : '-';
        return `<tr>
          <td><code style="color:#9B59B6;font-size:12px;">${r.id}</code></td>
          <td><strong>${r.user_name || '-'}</strong></td>
          <td>${r.service || '-'}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.title || ''}">${r.title || '-'}</td>
          <td>${r.area || '-'}</td>
          <td style="text-align:center;">
            ${offersCount > 0
            ? `<span style="background:rgba(230,126,34,0.15);color:#E67E22;border:1px solid rgba(230,126,34,0.3);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;" onclick="adminShowMarketOffers('${r.id}')">${offersCount} عرض 🔍</span>`
            : '<span style="color:rgba(255,255,255,0.25);font-size:12px;">لا يوجد</span>'}
            ${acceptedOffer ? `<br><span style="font-size:10px;color:#2ECC71;margin-top:2px;display:block;">✅ ${acceptedOffer.worker_name || 'صنايعي'}</span>` : ''}
          </td>
          <td>${mStatusBadge(r.status)}</td>
          <td style="font-size:11px;color:rgba(255,255,255,0.4);">${date}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="admin-btn" style="background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);color:#5DADE2;font-weight:700;" onclick="adminShowMarketOffers('${r.id}')">👁️ التفاصيل</button>
            ${r.status === 'pending_admin' ? `<button class="admin-btn" style="background:rgba(155,89,182,0.18);border:1px solid rgba(155,89,182,0.5);color:#9B59B6;font-weight:800;" onclick="adminOpenPublishMarketModal('${r.id}')">🏪 نشر</button>` : ''}
            <button class="admin-btn admin-btn-danger" onclick="adminDeleteMarketReq('${r.id}')">حذف</button>
          </td>
        </tr>`;
      }).join('');
    }
    window.adminRenderMarket = adminRenderMarket;

    function adminFilterMarketSearch(q) { adminRenderMarket(); }
    window.adminFilterMarketSearch = adminFilterMarketSearch;

    // ===== ADMIN: PUBLISH MARKET REQUEST + SET MANUAL COMMISSION =====
    let _adminPublishMarketReqId = null;

    function adminOpenPublishMarketModal(reqId) {
      const r = _adminMarketAll[reqId];
      if (!r) { showAdminToast('❌ مالقيتش الطلب ده'); return; }
      _adminPublishMarketReqId = reqId;
      document.getElementById('adm-pm-req-id').textContent = '# ' + reqId;
      document.getElementById('adm-pm-summary').innerHTML =
        '<div><strong>' + (r.title || r.service || 'طلب') + '</strong></div>' +
        '<div>👤 ' + (r.user_name || '-') + ' — 📞 ' + (r.user_phone || '-') + '</div>' +
        '<div>📍 ' + (r.area || '-') + ' — 🛠️ ' + (r.service || '-') + '</div>' +
        (r.desc ? '<div style="margin-top:4px;color:rgba(255,255,255,0.5);">📝 ' + r.desc + '</div>' : '') +
        (r.details && Object.keys(r.details).length ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">' + formatProfessionDetailsHTML(r.details) + '</div>' : '') +
        (r.images && r.images.length > 0 ? '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);"><div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;">📸 صور توضيحية (' + r.images.length + ')</div><div style="display:flex;flex-wrap:wrap;gap:7px;">' +
          r.images.map(src => '<img src="' + src + '" onclick="GLB.open(this.src)" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1.5px solid rgba(155,89,182,0.4);cursor:pointer;" title="اضغط للتكبير">').join('') +
          '</div></div>' : '<div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.3);">📸 العميل ملحقش صور بالطلب ده</div>');
      document.getElementById('adm-pm-amount').value = '';
      document.getElementById('adm-publish-market-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
    window.adminOpenPublishMarketModal = adminOpenPublishMarketModal;

    function adminClosePublishMarketModal() {
      document.getElementById('adm-publish-market-modal').style.display = 'none';
      document.body.style.overflow = '';
      _adminPublishMarketReqId = null;
    }
    window.adminClosePublishMarketModal = adminClosePublishMarketModal;

    async function adminConfirmPublishMarket() {
      if (!_adminPublishMarketReqId) return;
      const reqId = _adminPublishMarketReqId;
      const amountInput = document.getElementById('adm-pm-amount').value;
      const amountVal = parseFloat(amountInput);
      if (amountInput === '' || isNaN(amountVal) || amountVal < 0) { showAdminToast('⚠️ اكتب قيمة عمولة صحيحة بالجنيه'); return; }

      const btn = document.getElementById('adm-pm-confirm-btn');
      btn.disabled = true; btn.textContent = 'جاري النشر...';
      try {
        await update(ref(db, 'client_requests/' + reqId), {
          status: 'open',
          commission_amount: amountVal,
          commission_set_by_admin: true,
          commission_set_at: new Date().toISOString()
        });
        showAdminToast('✅ تم نشر الطلب للصنايعية');
        adminClosePublishMarketModal();
      } catch (e) {
        console.error(e);
        showAdminToast('❌ حصل خطأ، حاول تاني');
      } finally {
        btn.disabled = false; btn.innerHTML = '<span>🏪</span> انشر الطلب للصنايعية';
      }
    }
    window.adminConfirmPublishMarket = adminConfirmPublishMarket;

    function adminShowMarketOffers(reqId) {
      const r = _adminMarketAll[reqId];
      if (!r) return;
      const offers = r.offers ? Object.entries(r.offers) : [];
      const detailEl = document.getElementById('adm-market-offers-detail');
      const titleEl = document.getElementById('adm-market-detail-title');
      const bodyEl = document.getElementById('adm-market-offers-body');
      if (!detailEl || !bodyEl) return;
      titleEl.textContent = `💼 طلب: ${r.title || reqId} (${offers.length} عرض)`;
      // ===== بيانات الطلب الأصلي (وصف + تفاصيل + صور) — كانت مش ظاهرة للإدارة قبل كده =====
      const reqInfoHtml = `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;margin-bottom:16px;">
          <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:8px;">
            👤 <strong style="color:#fff;">${r.user_name || '-'}</strong> — 📞 ${r.user_phone || '-'} — 📍 ${r.area || '-'} — 🛠️ ${r.service || '-'}
          </div>
          ${r.desc ? `<div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.7;background:rgba(255,255,255,0.03);border-right:3px solid rgba(200,135,58,0.3);border-radius:8px;padding:9px 12px;margin-bottom:10px;">📝 ${r.desc}</div>` : ''}
          ${r.details && Object.keys(r.details).length ? `<div style="margin-bottom:10px;">
            <div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:4px;">📋 تفاصيل الخدمة</div>
            ${formatProfessionDetailsHTML(r.details)}
          </div>` : ''}
          ${r.images && r.images.length > 0 ? `<div>
            <div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.45);margin-bottom:7px;">📸 صور توضيحية (${r.images.length})</div>
            <div style="display:flex;flex-wrap:wrap;gap:7px;">
              ${r.images.map(src => `<img src="${src}" onclick="GLB.open('${src}')" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1.5px solid rgba(200,135,58,0.35);cursor:pointer;" title="اضغط للتكبير">`).join('')}
            </div>
          </div>` : `<div style="font-size:12px;color:rgba(255,255,255,0.3);">📸 العميل ملحقش صور بالطلب ده</div>`}
        </div>`;
      if (!offers.length) {
        bodyEl.innerHTML = reqInfoHtml + '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1rem;">لا توجد عروض</p>';
      } else {
        bodyEl.innerHTML = reqInfoHtml + `<div style="display:flex;flex-direction:column;gap:10px;">` +
          offers.map(([oid, o]) => {
            const isAccepted = r.accepted_offer_id === oid;
            const isRejected = o.rejected;
            const statusColor = isAccepted ? '#2ECC71' : isRejected ? '#E74C3C' : '#E67E22';
            const statusLabel = isAccepted ? '✅ مقبول' : isRejected ? '❌ مرفوض' : '⏳ بانتظار';
            const clientName = (r.user_name || 'عميل').replace(/'/g, '');
            const workerName = (o.worker_name || 'صنايعي').replace(/'/g, '');
            const hasChat = r.user_id && o.worker_id;
            return `<div style="background:rgba(255,255,255,0.04);border:1px solid ${isAccepted ? 'rgba(46,204,113,0.3)' : 'rgba(255,255,255,0.08)'};border-radius:12px;padding:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div style="font-weight:800;font-size:14px;margin-bottom:4px;">🔧 ${o.worker_name || 'صنايعي'} <span style="font-size:12px;color:#C8873A;font-weight:600;">${o.worker_trade || ''}</span></div>
                ${o.note ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:5px;font-style:italic;">"${o.note}"</div>` : ''}
                ${o.client_counter_price ? `<div style="font-size:12px;color:#E67E22;margin-top:5px;">🤝 عرض مضاد من العميل: ${o.client_counter_price} جنيه</div>` : ''}
                ${hasChat ? `<button onclick="adminViewChat('${r.user_id}','${o.worker_id}','${clientName}','${workerName}')" style="margin-top:10px;padding:6px 14px;background:rgba(26,188,156,0.15);border:1px solid rgba(26,188,156,0.4);border-radius:8px;color:#1ABC9C;font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">💬 شوف الشات</button>` : ''}
              </div>
              <div style="text-align:left;">
                <div style="font-size:22px;font-weight:900;color:#C8873A;">${o.price} ج</div>
                <div style="font-size:11px;color:${statusColor};font-weight:700;text-align:center;">${statusLabel}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:3px;">${o.created_at ? new Date(o.created_at).toLocaleDateString('ar-EG') : ''}</div>
              </div>
            </div>`;
          }).join('') + '</div>';
      }
      detailEl.style.display = 'block';
      detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    window.adminShowMarketOffers = adminShowMarketOffers;

    async function adminDeleteMarketReq(reqId) {
      if (!confirm('⚠️ هتحذف طلب السوق ده — متأكد؟')) return;
      try {
        await set(ref(db, 'client_requests/' + reqId), null);
        showToast('تم حذف الطلب', '#C0392B');
      } catch (e) { alert('حصل خطأ'); }
    }
    window.adminDeleteMarketReq = adminDeleteMarketReq;

    function statusBadge(status) {
      const map = { pending_admin: ['badge-pending', '🕓 بانتظار مراجعة الإدارة'], pending: ['badge-pending', 'معلّق'], accepted: ['badge-active', 'مقبول'], done: ['badge-done', 'منجز'], cancelled: ['badge-inactive', 'ملغي'], worker_done_pending: ['badge-pending', 'بانتظار تأكيد'] };
      const [cls, label] = map[status] || ['badge-pending', status];
      return `<span class="badge ${cls}">${label}</span>`;
    }
    function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

    // Add admin button to sidebar if owner
    function _doInjectAdminBtn() {
      // Desktop sidebar
      const sbNav = document.querySelector('.desktop-sidebar .sidebar-nav');
      if (sbNav && !document.getElementById('sb-admin-btn')) {
        const div = document.createElement('div');
        div.style.borderTop = '1px solid rgba(200,135,58,0.15)';
        div.style.paddingTop = '8px';
        div.style.marginTop = '8px';
        div.innerHTML = '<button class="sidebar-item" id="sb-admin-btn" onclick="goToAdmin()" style="color:#C8873A;"><span class="si-icon">👑</span> لوحة التحكم</button>';
        sbNav.appendChild(div);
      }
      // Mobile bottom nav
      const adminDot = document.getElementById('mbnav-profile');
      if (adminDot) adminDot.title = 'اضغط مطولاً للوحة التحكم';
      // Mobile topbar
      const topbarRight = document.getElementById('mobile-topbar-right');
      if (topbarRight && !document.getElementById('mobile-admin-btn')) {
        const btn = document.createElement('button');
        btn.id = 'mobile-admin-btn';
        btn.innerHTML = '👑';
        btn.title = 'لوحة التحكم';
        btn.style.cssText = 'background:linear-gradient(135deg,#C8873A,#8B5E25);border:none;border-radius:8px;width:34px;height:34px;font-size:17px;cursor:pointer;';
        btn.onclick = goToAdmin;
        topbarRight.insertBefore(btn, topbarRight.firstChild);
      }
    }

    async function injectAdminButton() {
      if (!currentUser) return;
      // الأدمن الأصلي
      if (isOwner()) { _doInjectAdminBtn(); return; }
      // تحقق من صلاحيات Firebase
      try {
        const permSnap = await get(ref(db, 'admin_permissions/' + currentUser.uid));
        if (permSnap.exists() && permSnap.val().is_admin) {
          _doInjectAdminBtn();
        }
      } catch (e) { }
    }

    // Hook into auth to inject admin button
    const _origUpdateNavIn = window.updateNavForLoggedIn;
    window.updateNavForLoggedIn = function () {
      _origUpdateNavIn && _origUpdateNavIn();
      setTimeout(injectAdminButton, 300);
    };
    // ========== PROMO SYSTEM ==========

    async function loadPromos() {
      const container = document.getElementById('promos-list');
      const banner = document.getElementById('promos-active-banner');
      if (!container) return;

      const snap = await get(ref(db, 'promos'));
      if (!snap.exists()) {
        container.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.25);padding:30px;font-size:13px;border:1px dashed rgba(255,255,255,0.1);border-radius:12px;">لا يوجد عروض حتى الآن — أضف أول عرض 👆</div>';
        if (banner) banner.style.display = 'none';
        return;
      }

      const now = Date.now();
      const promos = [];
      const promosObj = snap.val();
      Object.entries(promosObj).forEach(([key, val]) => promos.push({ key, ...val }));
      promos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Show active promo banner
      const activePromo = promos.find(p => p.active && new Date(p.start_at) <= now && new Date(p.end_at) >= now);
      if (activePromo && banner) {
        banner.style.display = 'flex';
        const remaining = Math.ceil((new Date(activePromo.end_at) - now) / (1000 * 60 * 60 * 24));
        document.getElementById('promo-banner-title').textContent = activePromo.name + ' — ' + activePromo.rate + '% عمولة';
        document.getElementById('promo-banner-detail').textContent = (activePromo.note || '');
        document.getElementById('promo-banner-timer').textContent = 'متبقي ' + remaining + ' يوم';
      } else if (banner) {
        banner.style.display = 'none';
      }

      container.innerHTML = promos.map(p => {
        const start = new Date(p.start_at);
        const end = new Date(p.end_at);
        const isActive = p.active && start <= now && end >= now;
        const isPending = p.active && start > now;
        const isExpired = end < now || !p.active;
        const statusColor = isActive ? '#2ECC71' : isPending ? '#E67E22' : 'rgba(255,255,255,0.25)';
        const statusLabel = isActive ? '🟢 نشط' : isPending ? '🟡 لم يبدأ بعد' : '⚫ منتهي/موقف';
        const daysTotal = Math.round((end - start) / (1000 * 60 * 60 * 24));
        const remaining = isActive ? Math.ceil((end - now) / (1000 * 60 * 60 * 24)) : 0;

        return `<div style="background:rgba(255,255,255,0.03);border:1.5px solid ${statusColor}33;border-radius:14px;padding:14px 18px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <div>
              <div style="font-size:15px;font-weight:900;">${p.name}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:3px;">${p.note || ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:22px;font-weight:900;color:var(--gold);">${p.rate}%</span>
              <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${statusColor}22;color:${statusColor};font-weight:700;border:1px solid ${statusColor}44;">${statusLabel}</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;text-align:center;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px;">📅 البداية</div>
              <div style="font-size:12px;font-weight:700;">${start.toLocaleDateString('ar-EG')}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.3);">${start.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;text-align:center;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px;">📅 الانتهاء</div>
              <div style="font-size:12px;font-weight:700;">${end.toLocaleDateString('ar-EG')}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.3);">${end.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;text-align:center;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:2px;">⏱️ المدة</div>
              <div style="font-size:12px;font-weight:700;">${daysTotal} يوم</div>
              <div style="font-size:10px;color:${isActive ? '#2ECC71' : 'rgba(255,255,255,0.3)'};">${isActive ? 'متبقي ' + remaining + ' يوم' : ''}</div>
            </div>
          </div>
          
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${p.active
              ? `<button onclick="adminTogglePromo('${p.key}', false)" style="padding:7px 16px;background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.4);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">⏸ إيقاف</button>`
              : `<button onclick="adminTogglePromo('${p.key}', true)" style="padding:7px 16px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.4);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">▶ تفعيل</button>`
            }
            <button onclick="adminDeletePromo('${p.key}')" style="padding:7px 16px;background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.2);border-radius:8px;color:rgba(231,76,60,0.7);font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">🗑 حذف</button>
          </div>
        </div>`;
      }).join('');
    }

    window.adminSavePromo = async function () {
      const name = document.getElementById('promo-name')?.value?.trim();
      const rate = parseFloat(document.getElementById('promo-rate')?.value);
      const startVal = document.getElementById('promo-start')?.value;
      const endVal = document.getElementById('promo-end')?.value;
      const note = document.getElementById('promo-note')?.value?.trim();

      if (!name) { showToast('اكتب اسم العرض', '#E74C3C'); return; }
      if (isNaN(rate) || rate < 0 || rate > 100) { showToast('نسبة العمولة لازم تكون بين 0 و 100', '#E74C3C'); return; }
      if (!startVal) { showToast('حدد تاريخ البداية', '#E74C3C'); return; }
      if (!endVal) { showToast('حدد تاريخ الانتهاء', '#E74C3C'); return; }
      if (new Date(startVal) >= new Date(endVal)) { showToast('تاريخ الانتهاء لازم يكون بعد البداية', '#E74C3C'); return; }

      try {
        await push(ref(db, 'promos'), {
          name, rate,
          start_at: new Date(startVal).toISOString(),
          end_at: new Date(endVal).toISOString(),
          note: note || null,
          active: true,
          created_at: new Date().toISOString(),
          created_by: 'admin'
        });
        // Reset form
        document.getElementById('promo-name').value = '';
        document.getElementById('promo-rate').value = '5';
        document.getElementById('promo-start').value = '';
        document.getElementById('promo-end').value = '';
        document.getElementById('promo-note').value = '';
        showToast('✅ تم حفظ العرض', '#2ECC71');
        loadPromos();
      } catch (e) { console.error(e); showToast('❌ حصل خطأ', '#E74C3C'); }
    };

    window.adminTogglePromo = async function (key, active) {
      await update(ref(db, 'promos/' + key), { active });
      showToast(active ? '✅ تم تفعيل العرض' : '⏸ تم إيقاف العرض', active ? '#2ECC71' : '#E67E22');
      loadPromos();
    };

    window.adminDeletePromo = async function (key) {
      if (!confirm('تأكيد حذف العرض؟')) return;
      await remove(ref(db, 'promos/' + key));
      showToast('🗑 تم الحذف', '#E74C3C');
      loadPromos();
    };
    // ========== END PROMO SYSTEM ==========

    // ========== END ADMIN DASHBOARD ==========

    // ===== CONTACT US =====
    async function submitContactMsg() {
      const name = document.getElementById('contact-name').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const msg = document.getElementById('contact-msg').value.trim();
      if (!name || !msg) { showToast('اكتب اسمك والرسالة على الأقل', '#C0392B'); return; }
      try {
        const sid = getContactSessionId();
        await push(ref(db, 'contact_messages'), {
          name, phone, message: msg,
          created_at: new Date().toISOString(),
          read: false, replied: false,
          session_id: sid,
          user_id: currentUser ? currentUser.uid : null
        });
        document.getElementById('contact-name').value = '';
        document.getElementById('contact-phone').value = '';
        document.getElementById('contact-msg').value = '';
        showToast('✅ تم إرسال رسالتك! هنرد عليك قريباً');
      } catch (e) { showToast('حصل خطأ، حاول تاني', '#C0392B'); }
    }
    window.submitContactMsg = submitContactMsg;

    // عرض الردود للعميل (real-time)
    let _contactRepliesListener = null;

    function getContactSessionId() {
      let sid = localStorage.getItem('contact_session_id');
      if (!sid) { sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); localStorage.setItem('contact_session_id', sid); }
      return sid;
    }

    function listenContactReplies() {
      if (_contactRepliesListener) return;
      const sid = getContactSessionId();
      let _prevAdminReplyCount = null;
      _contactRepliesListener = onValue(ref(db, 'contact_messages'), (snap) => {
        const wrap = document.getElementById('contact-replies-wrap');
        const list = document.getElementById('contact-replies-list');
        if (!wrap || !list) return;
        if (!snap.exists()) { wrap.style.display = 'none'; return; }

        // FIX #4 & #5: استخدم Object.entries عشان نحتفظ بالـ key، وفلتر بـ session_id أو user_id
        const allMyEntries = Object.entries(snap.val()).filter(([, m]) =>
          m.session_id === sid ||
          (typeof currentUser !== 'undefined' && currentUser && m.user_id && m.user_id === currentUser.uid)
        );

        // احسب كل ردود الأدمن
        let totalAdminReplies = 0;
        allMyEntries.forEach(([, m]) => {
          if (m.reply && m.reply.trim()) totalAdminReplies++;
          if (m.thread) Object.values(m.thread).forEach(t => { if (t.from === 'admin') totalAdminReplies++; });
        });
        // لو في ردود جديدة من الأدمن — ظهّر toast
        if (_prevAdminReplyCount !== null && totalAdminReplies > _prevAdminReplyCount) {
          showNotifToast('📬', 'رد من خدمة العملاء', 'ردوا على رسالتك — افتح تواصل معنا لتشوف الرد', '#C8873A');
        }
        _prevAdminReplyCount = totalAdminReplies;

        // FIX #1: فلتر على الرسائل اللي فيها رد سواء في m.reply أو في thread
        const myEntries = allMyEntries.filter(([, m]) => {
          const hasOldReply = m.reply && m.reply.trim();
          const hasThreadReply = m.thread && Object.values(m.thread).some(t => t.from === 'admin');
          return hasOldReply || hasThreadReply;
        });

        if (myEntries.length === 0) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = myEntries
          .sort(([, a], [, b]) => new Date(b.created_at) - new Date(a.created_at))
          .map(([msgKey, m]) => {  // FIX #4: msgKey جاي مباشرة من Object.entries
            const thread = m.thread ? Object.values(m.thread).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : [];
            const threadHtml = thread.map(t => t.from === 'admin'
              ? `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;">
                  <div style="width:30px;height:30px;background:linear-gradient(135deg,#C8873A,#8B5E25);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">🔧</div>
                  <div style="background:rgba(200,135,58,0.1);border-radius:10px;padding:9px 13px;flex:1;">
                    <div style="font-size:11px;font-weight:800;color:#C8873A;margin-bottom:3px;">فريق صنايعي أسوان</div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.88);line-height:1.7;">${t.text}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">${t.created_at ? new Date(t.created_at).toLocaleString('ar-EG') : ''}</div>
                  </div>
                </div>`
              : `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;flex-direction:row-reverse;">
                  <div style="width:30px;height:30px;background:rgba(255,255,255,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">👤</div>
                  <div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:9px 13px;flex:1;text-align:right;">
                    <div style="font-size:11px;font-weight:800;color:rgba(255,255,255,0.5);margin-bottom:3px;">${m.name || 'أنت'}</div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.88);line-height:1.7;">${t.text}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">${t.created_at ? new Date(t.created_at).toLocaleString('ar-EG') : ''}</div>
                  </div>
                </div>`
            ).join('');
            // أضف الرد الأصلي للـ thread لو مفيش thread بعد
            const firstReply = thread.length === 0 && m.reply
              ? `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;">
                  <div style="width:30px;height:30px;background:linear-gradient(135deg,#C8873A,#8B5E25);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">🔧</div>
                  <div style="background:rgba(200,135,58,0.1);border-radius:10px;padding:9px 13px;flex:1;">
                    <div style="font-size:11px;font-weight:800;color:#C8873A;margin-bottom:3px;">فريق صنايعي أسوان</div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.88);line-height:1.7;">${m.reply}</div>
                  </div>
                </div>` : '';
            return `
            <div style="background:rgba(200,135,58,0.06);border:1px solid rgba(200,135,58,0.2);border-radius:14px;padding:14px 16px;">
              <div style="font-size:12px;color:rgba(255,255,255,0.3);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.05);">
                💬 رسالتك الأصلية: ${m.message}
              </div>
              <div id="thread-${msgKey}">
                ${firstReply}${threadHtml}
              </div>
              <div style="display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05);">
                <input id="client-reply-${msgKey}" placeholder="اكتب ردك هنا..." style="flex:1;padding:10px 13px;background:#1C1A17;border:1.5px solid rgba(255,255,255,0.1);border-radius:9px;color:#fff;font-family:'Cairo',sans-serif;font-size:13px;outline:none;" onfocus="this.style.borderColor='#C8873A'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'" onkeydown="if(event.key==='Enter')clientReplyToAdmin('${msgKey}')">
                <button onclick="clientReplyToAdmin('${msgKey}')" style="padding:10px 16px;background:linear-gradient(135deg,#C8873A,#8B5E25);color:#1C1A17;border:none;border-radius:9px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;">إرسال ↩</button>
              </div>
            </div>`;
          }).join('');
      });
    }
    // شغّل الـ listener فوراً عند فتح الصفحة
    listenContactReplies();

    async function clientReplyToAdmin(msgKey) {
      if (!msgKey) return;
      const input = document.getElementById('client-reply-' + msgKey);
      const text = input?.value.trim();
      if (!text) return;
      input.value = '';
      input.disabled = true;
      try {
        await push(ref(db, 'contact_messages/' + msgKey + '/thread'), {
          from: 'client', text,
          created_at: new Date().toISOString()
        });
        // علّم الرسالة كمش مقروءة للأدمن
        await update(ref(db, 'contact_messages/' + msgKey), { read: false, client_replied: true });
      } catch (e) { showToast('حصل خطأ', '#C0392B'); }
      input.disabled = false;
    }
    window.clientReplyToAdmin = clientReplyToAdmin;

    // ===== ADMIN MESSAGES =====
    let _allAdminMsgs = [];
    let _adminMsgFilter = 'all';

    function filterAdminMsgs(filter) {
      _adminMsgFilter = filter;
      // تحديث أزرار الفلتر — يشتغل مع class جديد amsg-tab-btn
      ['all', 'unread', 'client_replied', 'replied', 'no_reply'].forEach(f => {
        const btn = document.getElementById('amsg-tab-' + f);
        if (!btn) return;
        if (f === filter) {
          btn.style.borderColor = '#C8873A';
          btn.style.background = 'rgba(200,135,58,0.15)';
          btn.style.color = '#C8873A';
          btn.style.fontWeight = '800';
        } else {
          btn.style.borderColor = 'rgba(255,255,255,0.12)';
          btn.style.background = 'transparent';
          btn.style.color = 'rgba(255,255,255,0.45)';
          btn.style.fontWeight = '700';
        }
      });
      renderAdminMsgsList();
    }
    window.filterAdminMsgs = filterAdminMsgs;

    function renderAdminMsgsList() {
      const el = document.getElementById('adm-messages-list');
      if (!el) return;

      // فلترة
      let filtered = _allAdminMsgs;
      if (_adminMsgFilter === 'unread') filtered = _allAdminMsgs.filter(([, m]) => !m.read || m.client_replied);
      else if (_adminMsgFilter === 'client_replied') filtered = _allAdminMsgs.filter(([, m]) => m.client_replied);
      else if (_adminMsgFilter === 'replied') filtered = _allAdminMsgs.filter(([, m]) => m.replied && !m.client_replied);
      else if (_adminMsgFilter === 'no_reply') filtered = _allAdminMsgs.filter(([, m]) => !m.replied && !m.client_replied);

      // تحديث عداد
      const countEl = document.getElementById('amsg-count-label');
      if (countEl) countEl.textContent = filtered.length + ' رسالة';

      if (!filtered.length) {
        el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">لا توجد رسائل في هذه الفئة</p>';
        return;
      }

      el.innerHTML = filtered.map(([key, m]) => {
        const thread = m.thread ? Object.values(m.thread).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : [];
        const isUrgent = !m.read || m.client_replied;
        const borderColor = m.client_replied ? 'rgba(46,134,193,0.5)' : !m.read ? 'rgba(200,135,58,0.45)' : m.replied ? 'rgba(39,174,96,0.2)' : 'rgba(255,255,255,0.08)';
        const timeAgo = (() => {
          const diff = Date.now() - new Date(m.created_at).getTime();
          const h = Math.floor(diff / 3600000);
          const d = Math.floor(diff / 86400000);
          if (d > 0) return `منذ ${d} يوم`;
          if (h > 0) return `منذ ${h} ساعة`;
          const min = Math.floor(diff / 60000);
          if (min > 0) return `منذ ${min} دقيقة`;
          return 'الآن';
        })();

        // بناء المحادثة كاملة
        const allThread = [];
        // الرسالة الأصلية
        allThread.push({ from: 'client', text: m.message, time: m.created_at, name: m.name });
        // الرد القديم (قبل الـ thread)
        if (m.reply && thread.length === 0) allThread.push({ from: 'admin', text: m.reply, time: m.replied_at });
        // باقي الـ thread
        thread.forEach(t => allThread.push(t));

        const threadHtml = allThread.map(t => t.from === 'admin'
          ? `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;">
              <div style="width:30px;height:30px;background:linear-gradient(135deg,#C8873A,#8B5E25);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">👑</div>
              <div style="background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.2);border-radius:0 10px 10px 10px;padding:10px 13px;flex:1;max-width:80%;">
                <div style="font-size:10px;color:#C8873A;font-weight:800;margin-bottom:3px;">أنت (المالك)</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.9);line-height:1.7;">${t.text}</div>
                ${t.time ? `<div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">${new Date(t.time).toLocaleString('ar-EG')}</div>` : ''}
              </div>
            </div>`
          : `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;flex-direction:row-reverse;">
              <div style="width:30px;height:30px;background:rgba(255,255,255,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">👤</div>
              <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:10px 0 10px 10px;padding:10px 13px;flex:1;max-width:80%;text-align:right;">
                <div style="font-size:10px;color:rgba(255,255,255,0.4);font-weight:800;margin-bottom:3px;">${t.name || m.name || 'العميل'}</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.9);line-height:1.7;">${t.text}</div>
                ${t.time ? `<div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">${new Date(t.time).toLocaleString('ar-EG')}</div>` : ''}
              </div>
            </div>`
        ).join('');

        // لو في رد جديد من العميل — افتح الأكورديون تلقائياً
        const autoOpen = !!m.client_replied;
        return `<div style="background:rgba(255,255,255,0.03);border:1.5px solid ${borderColor};border-radius:16px;overflow:hidden;${isUrgent ? 'box-shadow:0 0 0 1px ' + borderColor + ';' : ''}">
          <!-- هيدر الرسالة (قابل للضغط) -->
          <div onclick="toggleAdminMsg('${key}')" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,0.02);cursor:pointer;user-select:none;transition:background 0.18s;"
            onmouseover="this.style.background='rgba(200,135,58,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
            <!-- أيقونة المستخدم -->
            <div style="width:38px;height:38px;border-radius:10px;background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.2);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;">👤</div>
            <!-- الاسم والوقت -->
            <div style="flex:1;min-width:0;overflow:hidden;">
              <div style="font-size:14px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.name || '-'}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:1px;">${timeAgo}</div>
            </div>
            <!-- Badge الحالة — اسم مختصر على الموبايل -->
            <div style="flex-shrink:0;display:flex;align-items:center;gap:6px;">
              ${m.client_replied
                ? '<span style="background:rgba(46,134,193,0.18);color:#2E86C1;border:1px solid rgba(46,134,193,0.35);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:800;white-space:nowrap;">💬 ردّ العميل</span>'
                : !m.read
                  ? '<span style="background:rgba(200,135,58,0.18);color:#C8873A;border:1px solid rgba(200,135,58,0.35);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:800;white-space:nowrap;">🔔 جديدة</span>'
                  : m.replied
                    ? '<span style="background:rgba(39,174,96,0.12);color:#27AE60;border:1px solid rgba(39,174,96,0.25);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">✅ تم الرد</span>'
                    : '<span style="background:rgba(231,76,60,0.1);color:#E74C3C;border:1px solid rgba(231,76,60,0.25);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">⏳ لم يُرد</span>'
              }
              <!-- سهم الأكورديون -->
              <div id="arrow-${key}" style="font-size:16px;color:rgba(255,255,255,0.35);transition:transform 0.25s;transform:${autoOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">⌄</div>
            </div>
          </div>
          <!-- المحادثة وخانة الرد — مخفية افتراضياً -->
          <div id="body-${key}" style="display:${autoOpen ? 'block' : 'none'};">
            <!-- المحادثة -->
            <div style="padding:14px 18px;display:flex;flex-direction:column;gap:0;border-top:1px solid rgba(255,255,255,0.05);">
              ${threadHtml}
            </div>
            <!-- خانة الرد السريع -->
            <div style="padding:12px 14px 14px;border-top:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.02);">
              <textarea id="reply-${key}" placeholder="اكتب ردك على ${m.name || 'العميل'}..." rows="2"
                style="width:100%;box-sizing:border-box;padding:10px 13px;background:#1C1A17;border:1.5px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:Cairo,sans-serif;font-size:13px;outline:none;resize:none;line-height:1.6;display:block;"
                onfocus="this.style.borderColor='#C8873A'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();adminReplyMsg('${key}')}"></textarea>
              <div style="display:flex;gap:8px;margin-top:8px;">
                <button onclick="adminReplyMsg('${key}')"
                  style="flex:1;padding:9px 12px;background:linear-gradient(135deg,#C8873A,#8B5E25);color:#1C1A17;border:none;border-radius:9px;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">
                  إرسال ↩
                </button>
                <button onclick="adminDeleteMsg('${key}')"
                  style="padding:9px 14px;background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.3);color:#E74C3C;border-radius:9px;font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
                  🗑
                </button>
              </div>
              <div style="font-size:11px;color:rgba(255,255,255,0.2);margin-top:5px;text-align:center;">Enter للإرسال · Shift+Enter لسطر جديد</div>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    async function loadAdminMessages() {
      const el = document.getElementById('adm-messages-list');
      if (!el) return;
      el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">جاري التحميل...</p>';
      try {
        const snap = await get(ref(db, 'contact_messages'));
        if (!snap.exists()) { el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">لا توجد رسائل بعد</p>'; return; }

        // ترتيب الأولويات: العميل رد أولاً ← جديدة ← لم يُرد ← تم الرد
        const priorityOrder = (m) => {
          if (m.client_replied) return 0;
          if (!m.read) return 1;
          if (!m.replied) return 2;
          return 3;
        };
        _allAdminMsgs = Object.entries(snap.val()).sort((a, b) => {
          const pa = priorityOrder(a[1]), pb = priorityOrder(b[1]);
          if (pa !== pb) return pa - pb;
          return new Date(b[1].created_at) - new Date(a[1].created_at);
        });

        // تحديث badge
        const unread = _allAdminMsgs.filter(([, m]) => !m.read || m.client_replied).length;
        const badge = document.getElementById('admin-msg-badge');
        if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'flex' : 'none'; }

        // شريط ملخص في الفلتر
        const unreadTab = document.getElementById('amsg-tab-unread');
        if (unreadTab && unread > 0) unreadTab.textContent = `🔴 غير مقروءة (${unread})`;

        renderAdminMsgsList();

        // علّم الكل مقروءة
        _allAdminMsgs.forEach(([key, m]) => { if (!m.read) update(ref(db, 'contact_messages/' + key), { read: true }); });
      } catch (e) { console.error(e); el.innerHTML = '<p style="color:#E74C3C;text-align:center;padding:2rem;">حصل خطأ في التحميل</p>'; }
    }
    function toggleAdminMsg(key) {
      const body = document.getElementById('body-' + key);
      const arrow = document.getElementById('arrow-' + key);
      if (!body) return;
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      // فوكس على الـ textarea لما يتفتح
      if (!isOpen) {
        setTimeout(() => { const ta = document.getElementById('reply-' + key); if (ta) ta.focus(); }, 200);
      }
    }
    window.toggleAdminMsg = toggleAdminMsg;

    async function adminReplyMsg(key) {
      const reply = document.getElementById('reply-' + key)?.value.trim();
      if (!reply) { showToast('اكتب الرد الأول', '#C0392B'); return; }
      // FIX #10: حدّث الـ status الأول عشان نمنع race condition مع الـ badge
      await update(ref(db, 'contact_messages/' + key), {
        reply, replied: true, replied_at: new Date().toISOString(), read: true, client_replied: false
      });
      await push(ref(db, 'contact_messages/' + key + '/thread'), {
        from: 'admin', text: reply, created_at: new Date().toISOString()
      })
      // ✅ Firebase notification للمستخدم لو عنده user_id
      try {
        const msgSnap = await get(ref(db, 'contact_messages/' + key));
        if (msgSnap.exists() && msgSnap.val().user_id) {
          await push(ref(db, 'notifications/' + msgSnap.val().user_id), {
            type: 'admin_reply', title: '📬 خدمة العملاء ردت عليك!',
            body: 'رد الإدارة: ' + reply.slice(0, 80) + (reply.length > 80 ? '...' : ''),
            read: false, created_at: new Date().toISOString()
          });
        }
      } catch (e) { console.log('admin notif err', e); }
      showToast('✅ تم إرسال الرد');
      loadAdminMessages();
    }
    window.adminReplyMsg = adminReplyMsg;
    async function adminDeleteMsg(key) {
      if (!confirm('هتحذف الرسالة دي؟')) return;
      await set(ref(db, 'contact_messages/' + key), null);
      showToast('تم الحذف', '#C0392B'); loadAdminMessages();
    }
    window.adminDeleteMsg = adminDeleteMsg;

    // ===== CREATE ACCOUNT (ADMIN) =====
    let _caRole = 'client';

    function caSelectRole(role) {
      _caRole = role;
      const clientBtn = document.getElementById('ca-role-client');
      const workerBtn = document.getElementById('ca-role-worker');
      const tradeGroup = document.getElementById('ca-trade-group');
      if (role === 'client') {
        clientBtn.style.cssText = 'flex:1;padding:11px;border-radius:10px;border:1.5px solid #C8873A;background:rgba(200,135,58,0.15);color:#C8873A;font-family:Cairo,sans-serif;font-size:14px;font-weight:800;cursor:pointer;';
        workerBtn.style.cssText = 'flex:1;padding:11px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.4);font-family:Cairo,sans-serif;font-size:14px;font-weight:800;cursor:pointer;';
        tradeGroup.style.display = 'none';
      } else {
        workerBtn.style.cssText = 'flex:1;padding:11px;border-radius:10px;border:1.5px solid #C8873A;background:rgba(200,135,58,0.15);color:#C8873A;font-family:Cairo,sans-serif;font-size:14px;font-weight:800;cursor:pointer;';
        clientBtn.style.cssText = 'flex:1;padding:11px;border-radius:10px;border:1.5px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.4);font-family:Cairo,sans-serif;font-size:14px;font-weight:800;cursor:pointer;';
        tradeGroup.style.display = 'block';
      }
    }
    window.caSelectRole = caSelectRole;

    async function adminCreateAccount() {
      const name = document.getElementById('ca-name').value.trim();
      const email = document.getElementById('ca-email').value.trim();
      const pass = document.getElementById('ca-pass').value.trim();
      const phone = document.getElementById('ca-phone').value.trim();
      const area = document.getElementById('ca-area').value.trim();
      const trade = document.getElementById('ca-trade').value.trim();
      const role = _caRole;

      if (!name || !email || !pass) { showToast('الاسم والإيميل وكلمة المرور مطلوبين', '#C0392B'); return; }
      if (pass.length < 6) { showToast('كلمة المرور 6 أحرف على الأقل', '#C0392B'); return; }
      if (role === 'worker' && !trade) { showToast('اكتب الحرفة للصنايعي', '#C0392B'); return; }

      const btn = document.getElementById('ca-submit-btn');
      btn.disabled = true;
      btn.textContent = '⏳ جاري الإنشاء...';
      const resultEl = document.getElementById('ca-result');
      resultEl.style.display = 'none';

      try {
        // إنشاء الحساب في Firebase Auth
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        const uid = result.user.uid;

        // حفظ البروفايل في database
        const profileData = {
          full_name: name, email, phone: phone || '', area: area || '',
          role, created_at: new Date().toISOString(), created_by: 'admin'
        };
        await set(ref(db, 'profiles/' + uid), profileData);

        // لو صنايعي — أضفه في craftsmen + أنشئ محفظة فارغة
        if (role === 'worker') {
          await set(ref(db, 'craftsmen/' + uid), {
            name, trade, area: area || '', phone: phone || '',
            available: true, rating: 0, reviews: 0,
            created_at: new Date().toISOString()
          });
          // ✅ إنشاء محفظة فارغة للصنايعي الجديد تلقائياً
          await set(ref(db, 'wallets/' + uid), {
            balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0,
            created_at: new Date().toISOString()
          });
        }

        // رجّع لحساب الأدمن (لأن Firebase بتعمل auto login للحساب الجديد)
        // نحتاج نعمل re-login للأدمن — نحفظ credentials مؤقتاً
        showToast('✅ تم إنشاء الحساب!');

        // عرض النتيجة
        resultEl.style.display = 'block';
        resultEl.style.background = 'rgba(39,174,96,0.12)';
        resultEl.style.borderColor = 'rgba(39,174,96,0.3)';
        document.getElementById('ca-result-details').innerHTML =
          '<b style="color:#C8873A;">الاسم:</b> ' + name + '<br>' +
          '<b style="color:#C8873A;">الإيميل:</b> ' + email + '<br>' +
          '<b style="color:#C8873A;">كلمة المرور:</b> ' + pass + '<br>' +
          '<b style="color:#C8873A;">النوع:</b> ' + (role === 'worker' ? '🔧 صنايعي' : '👤 عميل') +
          (trade ? '<br><b style="color:#C8873A;">الحرفة:</b> ' + trade : '');

        // تنظيف الفورم
        ['ca-name', 'ca-email', 'ca-pass', 'ca-phone', 'ca-area', 'ca-trade'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });

        // رجّع login الأدمن بعد ثانيتين
        setTimeout(async () => {
          try {
            await signOut(auth);
            // إعادة تشغيل الصفحة عشان الأدمن يسجل دخوله من جديد
            showToast('سيتم تسجيل خروجك — سجّل دخولك مرة تانية كأدمن', '#E67E22');
            setTimeout(() => { location.reload(); }, 2500);
          } catch (e) { }
        }, 3000);

      } catch (e) {
        let msg = 'حصل خطأ، حاول تاني';
        if (e.code === 'auth/email-already-in-use') msg = 'الإيميل ده موجود بالفعل!';
        if (e.code === 'auth/invalid-email') msg = 'الإيميل غلط';
        if (e.code === 'auth/weak-password') msg = 'كلمة المرور ضعيفة جداً';
        resultEl.style.display = 'block';
        resultEl.style.background = 'rgba(192,57,43,0.12)';
        resultEl.style.borderColor = 'rgba(192,57,43,0.3)';
        document.getElementById('ca-result-details').innerHTML = '<span style="color:#E74C3C;">❌ ' + msg + '</span>';
      } finally {
        btn.disabled = false;
        btn.textContent = '➕ إنشاء الحساب';
      }
    }
    window.adminCreateAccount = adminCreateAccount;
    // ===== END CREATE ACCOUNT =====

    // ===== PERMISSIONS SYSTEM =====
    // صفحات الموقع اللي ممكن تتحكم فيها
    const SITE_PAGES = [
      { key: 'home', label: '🏠 الرئيسية' },
      { key: 'craftsmen', label: '👷 الصنايعية' },
      { key: 'client-market', label: '🏪 سوق الطلبات' },
      { key: 'client-orders', label: '📋 طلباتي' },
      { key: 'profile-client', label: '👤 حسابي (عميل)' },
      { key: 'profile-worker', label: '🔧 حسابي (صنايعي)' },
      { key: 'guide', label: '📖 دليل الاستخدام' },
    ];

    const ADMIN_SECTIONS = [
      { key: 'overview', label: '📊 نظرة عامة' },
      { key: 'craftsmen', label: '👷 الصنايعية' },
      { key: 'clients', label: '👥 العملاء' },
      { key: 'orders', label: '📋 الطلبات' },
      { key: 'ratings', label: '⭐ التقييمات' },
      { key: 'messages', label: '💬 رسائل العملاء' },
      { key: 'services', label: '🛠️ إدارة الخدمات' },
      { key: 'activity', label: '🕐 سجل النشاط' },
      { key: 'create-account', label: '➕ إنشاء حسابات' },
      { key: 'permissions', label: '🔐 الصلاحيات' },
    ];

    let _permAllUsers = [];
    let _permSelectedUid = null;

    async function loadPermissionsTab() {
      // جيب كل المستخدمين
      const snap = await get(ref(db, 'profiles'));
      if (!snap.exists()) return;
      _permAllUsers = Object.entries(snap.val())
        .map(([uid, p]) => ({ uid, ...p }))
        .filter(u => u.email !== OWNER_EMAIL); // الأدمن الأصلي مش بيحتاج صلاحيات
      renderPermUsersList(_permAllUsers);
      loadPermAdminsList();
    }
    window.loadPermissionsTab = loadPermissionsTab;

    function renderPermUsersList(users) {
      const el = document.getElementById('perm-users-list');
      if (!el) return;
      if (!users.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1rem;">مفيش مستخدمين</p>'; return; }
      el.innerHTML = users.map(u => `
        <div onclick="selectPermUser('${u.uid}')"
          style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);cursor:pointer;transition:all 0.2s;"
          onmouseover="this.style.borderColor='rgba(200,135,58,0.4)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.07)'">
          <div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,rgba(200,135,58,0.25),rgba(200,135,58,0.08));display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">
            ${u.role === 'worker' ? '🔧' : '👤'}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.full_name || 'بدون اسم'}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.35);">${u.email || ''} · ${u.role === 'worker' ? 'صنايعي' : 'عميل'}</div>
          </div>
          <div style="font-size:11px;color:rgba(200,135,58,0.6);white-space:nowrap;">اختر ◀</div>
        </div>`).join('');
    }

    function filterPermUsers(q) {
      const filtered = q ? _permAllUsers.filter(u =>
        (u.full_name || '').includes(q) || (u.email || '').includes(q)
      ) : _permAllUsers;
      renderPermUsersList(filtered);
    }
    window.filterPermUsers = filterPermUsers;

    async function selectPermUser(uid) {
      _permSelectedUid = uid;
      const user = _permAllUsers.find(u => u.uid === uid);
      if (!user) return;

      // عرض بيانات المستخدم
      document.getElementById('perm-user-name').textContent = user.full_name || 'بدون اسم';
      document.getElementById('perm-user-email').textContent = user.email || '';
      document.getElementById('perm-user-avatar').textContent = user.role === 'worker' ? '🔧' : '👤';

      // جيب صلاحياته الحالية
      const permSnap = await get(ref(db, 'admin_permissions/' + uid));
      const perms = permSnap.exists() ? permSnap.val() : {};

      // checkbox الأدمن
      const isAdmin = !!perms.is_admin;
      const adminCb = document.getElementById('perm-is-admin');
      adminCb.checked = isAdmin;
      const slider = document.getElementById('perm-admin-slider');
      slider.style.background = isAdmin ? '#C8873A' : 'rgba(255,255,255,0.1)';
      const knob = document.getElementById('perm-admin-knob');
      if (knob) knob.style.transform = isAdmin ? 'translateX(-20px)' : 'translateX(0)';

      // رندر الأقسام
      const grid = document.getElementById('perm-sections-grid');
      const allowedSections = perms.sections || [];
      grid.innerHTML = ADMIN_SECTIONS.map(s => {
        const checked = allowedSections.includes(s.key);
        return `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1.5px solid ${checked ? 'rgba(200,135,58,0.5)' : 'rgba(255,255,255,0.07)'};cursor:pointer;transition:all 0.2s;" id="perm-label-${s.key}">
          <input type="checkbox" id="perm-sec-${s.key}" ${checked ? 'checked' : ''}
            onchange="updatePermLabel('${s.key}')"
            style="width:16px;height:16px;accent-color:#C8873A;cursor:pointer;flex-shrink:0;">
          <span style="font-size:13px;font-weight:700;color:${checked ? '#C8873A' : 'rgba(255,255,255,0.6)'};" id="perm-sec-label-${s.key}">${s.label}</span>
        </label>`;
      }).join('');

      // رندر صفحات الموقع
      const pagesGrid = document.getElementById('perm-pages-grid');
      const allowedPages = perms.allowed_pages || [];
      pagesGrid.innerHTML = SITE_PAGES.map(p => {
        const checked = allowedPages.includes(p.key);
        return `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1.5px solid ${checked ? 'rgba(200,135,58,0.5)' : 'rgba(255,255,255,0.07)'};cursor:pointer;transition:all 0.2s;" id="perm-page-label-${p.key}">
          <input type="checkbox" id="perm-page-${p.key}" ${checked ? 'checked' : ''}
            onchange="updatePagePermLabel('${p.key}')"
            style="width:16px;height:16px;accent-color:#C8873A;cursor:pointer;flex-shrink:0;">
          <span style="font-size:13px;font-weight:700;color:${checked ? '#C8873A' : 'rgba(255,255,255,0.6)'};" id="perm-page-label-text-${p.key}">${p.label}</span>
        </label>`;
      }).join('');

      document.getElementById('perm-editor').style.display = 'block';
      document.getElementById('perm-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    window.selectPermUser = selectPermUser;

    function updatePermLabel(key) {
      const cb = document.getElementById('perm-sec-' + key);
      const label = document.getElementById('perm-label-' + key);
      const span = document.getElementById('perm-sec-label-' + key);
      if (cb.checked) {
        label.style.borderColor = 'rgba(200,135,58,0.5)';
        span.style.color = '#C8873A';
      } else {
        label.style.borderColor = 'rgba(255,255,255,0.07)';
        span.style.color = 'rgba(255,255,255,0.6)';
      }
    }
    window.updatePermLabel = updatePermLabel;

    function updatePagePermLabel(key) {
      const cb = document.getElementById('perm-page-' + key);
      const label = document.getElementById('perm-page-label-' + key);
      const span = document.getElementById('perm-page-label-text-' + key);
      if (cb.checked) {
        label.style.borderColor = 'rgba(200,135,58,0.5)';
        span.style.color = '#C8873A';
      } else {
        label.style.borderColor = 'rgba(255,255,255,0.07)';
        span.style.color = 'rgba(255,255,255,0.6)';
      }
    }
    window.updatePagePermLabel = updatePagePermLabel;

    function toggleAdminAccess() {
      const cb = document.getElementById('perm-is-admin');
      const slider = document.getElementById('perm-admin-slider');
      slider.style.background = cb.checked ? '#C8873A' : 'rgba(255,255,255,0.1)';
      const knob = document.getElementById('perm-admin-knob');
      if (knob) knob.style.transform = cb.checked ? 'translateX(-20px)' : 'translateX(0)';
    }
    window.toggleAdminAccess = toggleAdminAccess;

    async function savePermissions() {
      if (!_permSelectedUid) return;
      const isAdmin = document.getElementById('perm-is-admin').checked;
      const sections = ADMIN_SECTIONS
        .filter(s => document.getElementById('perm-sec-' + s.key)?.checked)
        .map(s => s.key);
      const allowed_pages = SITE_PAGES
        .filter(p => document.getElementById('perm-page-' + p.key)?.checked)
        .map(p => p.key);
      await set(ref(db, 'admin_permissions/' + _permSelectedUid), {
        is_admin: isAdmin,
        sections,
        allowed_pages,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.uid
      });
      showToast('✅ تم حفظ الصلاحيات');
      loadPermAdminsList();
    }
    window.savePermissions = savePermissions;

    async function loadPermAdminsList() {
      const el = document.getElementById('perm-admins-list');
      if (!el) return;
      const snap = await get(ref(db, 'admin_permissions'));
      if (!snap.exists()) { el.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:13px;">مفيش حد عنده صلاحيات لحد دلوقتي</p>'; return; }
      const perms = snap.val();
      const entries = Object.entries(perms).filter(([, p]) => p.is_admin || (p.sections && p.sections.length));
      if (!entries.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:13px;">مفيش حد عنده صلاحيات لحد دلوقتي</p>'; return; }
      el.innerHTML = '';
      for (const [uid, perm] of entries) {
        const user = _permAllUsers.find(u => u.uid === uid);
        const name = user?.full_name || uid;
        const email = user?.email || '';
        const role = user?.role === 'worker' ? '🔧' : '👤';
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);flex-wrap:wrap;';
        div.innerHTML = `
          <div style="font-size:20px;">${role}</div>
          <div style="flex:1;min-width:120px;">
            <div style="font-size:14px;font-weight:700;color:#fff;">${name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.35);">${email}</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;flex:2;">
            ${perm.is_admin ? '<span style="padding:3px 10px;border-radius:20px;background:rgba(200,135,58,0.2);color:#C8873A;font-size:11px;font-weight:800;">👑 أدمن كامل</span>' : ''}
            ${(perm.sections || []).map(s => {
          const sec = ADMIN_SECTIONS.find(x => x.key === s);
          return sec ? '<span style="padding:3px 10px;border-radius:20px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);font-size:11px;">' + sec.label + '</span>' : '';
        }).join('')}
          </div>
          <div style="display:flex;gap:6px;">
            <button onclick="selectPermUser('${uid}')"
              style="padding:6px 12px;background:rgba(200,135,58,0.15);border:1px solid rgba(200,135,58,0.3);border-radius:8px;color:#C8873A;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;">تعديل</button>
            <button onclick="removePermissions('${uid}')"
              style="padding:6px 12px;background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;">إلغاء</button>
          </div>`;
        el.appendChild(div);
      }
    }

    async function removePermissions(uid) {
      if (!confirm('هتلغي كل صلاحيات المستخدم ده؟')) return;
      await set(ref(db, 'admin_permissions/' + uid), null);
      showToast('تم إلغاء الصلاحيات', '#E74C3C');
      if (_permSelectedUid === uid) {
        document.getElementById('perm-editor').style.display = 'none';
        _permSelectedUid = null;
      }
      loadPermAdminsList();
    }
    window.removePermissions = removePermissions;
    // ===== END PERMISSIONS SYSTEM =====

    // ===== ADMIN SERVICES =====
    const DEFAULT_SERVICES = [
      { name: 'كهرباء', icon: '⚡', key: 'كهرباء', builtin: true }, { name: 'سباكة', icon: '🔩', key: 'سباكة', builtin: true },
      { name: 'نجارة', icon: '🪵', key: 'نجارة', builtin: true }, { name: 'دهانات', icon: '🎨', key: 'دهانات', builtin: true },
      { name: 'تكييف', icon: '❄️', key: 'تكييف', builtin: true }, { name: 'بناء وتشييد', icon: '🏗️', key: 'بناء', builtin: true },
      { name: 'ألومنيوم', icon: '🪟', key: 'ألومنيوم', builtin: true }, { name: 'سيراميك وبلاط', icon: '🏠', key: 'سيراميك', builtin: true },
      { name: 'دلفري', icon: '🚚', key: 'دلفري', builtin: true },
    ];
    async function loadAdminServices() {
      const tbody = document.getElementById('adm-services-body');
      if (!tbody) return;
      const snap = await get(ref(db, 'custom_services'));
      const custom = snap.exists() ? Object.entries(snap.val()).map(([k, v]) => ({ ...v, _key: k })) : [];
      const all = [...DEFAULT_SERVICES, ...custom];
      tbody.innerHTML = all.map(s => `<tr>
    <td style="font-size:22px;">${s.icon}</td>
    <td><strong>${s.name}</strong></td>
    <td><code style="color:#C8873A;font-size:12px;">${s.key}</code></td>
    <td>${s.builtin ? '<span class="badge badge-active">أساسية</span>' : '<span class="badge badge-pending">مضافة</span>'}</td>
    <td>${s.builtin ? '<span style="color:rgba(255,255,255,0.2);font-size:12px;">-</span>' : `<button class="admin-btn admin-btn-danger" onclick="adminDeleteService('${s._key}')">حذف</button>`}</td>
  </tr>`).join('');
      refreshServicesGrid(custom);
    }
    async function adminAddService() {
      const name = document.getElementById('new-svc-name').value.trim();
      const icon = document.getElementById('new-svc-icon').value.trim();
      const key = document.getElementById('new-svc-key').value.trim();
      if (!name || !icon || !key) { showToast('اكمل كل الحقول', '#C0392B'); return; }
      await push(ref(db, 'custom_services'), { name, icon, key, created_at: new Date().toISOString() });
      document.getElementById('new-svc-name').value = '';
      document.getElementById('new-svc-icon').value = '';
      document.getElementById('new-svc-key').value = '';
      showToast('✅ تمت إضافة الخدمة وظهرت في الموقع!');
      loadAdminServices();
    }
    window.adminAddService = adminAddService;
    async function adminDeleteService(key) {
      if (!confirm('هتحذف الخدمة دي؟')) return;
      await set(ref(db, 'custom_services/' + key), null);
      showToast('تم الحذف', '#C0392B'); loadAdminServices();
    }
    window.adminDeleteService = adminDeleteService;
    function refreshServicesGrid(customServices) {
      const grid = document.getElementById('services-grid-dynamic');
      if (!grid) return;
      Array.from(grid.querySelectorAll('.service-card')).slice(9).forEach(c => c.remove());
      customServices.forEach(s => {
        grid.insertAdjacentHTML('beforeend', `<div class="service-card" onclick="filterCraftsmen('${s.key}')"><span class="service-icon">${s.icon}</span><div class="service-name">${s.name}</div><div class="service-count" id="count-${s.key}">0 صنايعي</div></div>`);
      });
      // بعد ما الكاردز اتضافت، حدّث أعدادها — رصيد > 0 أو معملوش طلبات
      Promise.all([
        get(ref(db, 'craftsmen')),
        get(ref(db, 'wallets'))
      ]).then(([cSnap, wSnap]) => {
        if (!cSnap.exists()) return;
        const wallets = wSnap.exists() ? wSnap.val() : {};
        const list = Object.entries(cSnap.val())
          .filter(([uid, c]) => {
            if (!c.available) return false;
            const bal = wallets[uid]?.balance ?? 0;
            return bal > 0; // يظهر بس لو عنده رصيد
          })
          .map(([, c]) => c);
        document.querySelectorAll('[id^="count-"]').forEach(el => {
          const trade = el.id.replace('count-', '');
          el.textContent = list.filter(c => c.trade?.includes(trade)).length + ' صنايعي';
        });
      }).catch(() => { });
    }
    async function loadCustomServicesOnHome() {
      try {
        const snap = await get(ref(db, 'custom_services'));
        const custom = snap.exists() ? Object.values(snap.val()) : [];
        refreshServicesGrid(custom);
        // أضف الخدمات المخصصة لـ select فورم الطلب
        const reqSel = document.getElementById('req-service');
        if (reqSel) {
          // شيل القديم المضاف
          Array.from(reqSel.options).forEach(o => { if (o.dataset.custom) o.remove(); });
          custom.forEach(s => {
            const opt = document.createElement('option');
            opt.text = s.icon + ' ' + s.name;
            opt.value = s.icon + ' ' + s.name;
            opt.dataset.custom = '1';
            opt.style.background = '#1C1A17';
            reqSel.appendChild(opt);
          });
        }
        // أضف لـ reg-trade select
        const tradeSel = document.getElementById('reg-trade');
        if (tradeSel) {
          Array.from(tradeSel.options).forEach(o => { if (o.dataset.custom) o.remove(); });
          custom.forEach(s => {
            const opt = document.createElement('option');
            opt.text = s.icon + ' ' + s.name;
            opt.style.background = '#1C1A17';
            opt.dataset.custom = '1';
            tradeSel.appendChild(opt);
          });
        }
      } catch (e) { }
    }
    async function checkAdminMsgBadge() {
      if (!isOwner()) return;
      try {
        const snap = await get(ref(db, 'contact_messages'));
        if (!snap.exists()) return;
        const unread = Object.values(snap.val()).filter(m => !m.read || m.client_replied).length;
        const badge = document.getElementById('admin-msg-badge');
        if (badge && unread > 0) { badge.textContent = unread; badge.style.display = 'flex'; }
      } catch (e) { }
    }
    // patch adminTab
    const _origAdminTab = window.adminTab;
    window.adminTab = async function (tab) {
      // تحقق من الصلاحيات لو مش الأوينر
      if (currentUser && !isOwner()) {
        try {
          const permSnap = await get(ref(db, 'admin_permissions/' + currentUser.uid));
          if (permSnap.exists()) {
            const allowedSections = permSnap.val().sections || [];
            if (allowedSections.length > 0 && !allowedSections.includes(tab)) {
              showToast('⛔ مش مسموح بالوصول لهذا القسم', '#E74C3C');
              return;
            }
          }
        } catch (e) { }
      }
      _origAdminTab(tab);
      if (tab === 'messages') loadAdminMessages();
      if (tab === 'services') loadAdminServices();
      if (tab === 'permissions') loadPermissionsTab();
      if (tab === 'promos') loadPromos();
    };
    // ===== END CONTACT & SERVICES =====

    function goToRequest() {
      if (currentProfile?.role === 'worker') {
        alert('الصنايعي مش بيقدر يطلب خدمة من صنايعي تاني!');
        return;
      }
      window._targetWorkerId = null;
      window._targetWorkerName = null;
      hideTargetWorkerBanner();
      showPage('request');
    }
    window.goToRequest = goToRequest;

    // ===== تفاصيل خاصة بكل مهنة (علشان العميل يحدد المشكلة بالظبط والصنايعي يحدد السعر صح) =====
    // كل مهنة ليها: fields (حقول منظمة زي المساحة والنوع) + descHint (توجيه للعميل يكتبه في خانة الوصف الحر)
    const PROFESSION_DETAILS_CONFIG = {
      'كهرباء': {
        fields: [
          { id: 'work_type', label: 'نوع الخدمة المطلوبة', type: 'select', options: ['إصلاح عطل', 'تركيب جديد / تمديدات', 'تغيير لوحة الكهرباء', 'تركيب إنارة وأباليك', 'صيانة دورية'] },
          { id: 'points_count', label: 'عدد النقاط الكهربائية المطلوب العمل عليها', type: 'number', placeholder: 'مثلاً: 5' },
          { id: 'place_type', label: 'نوع المكان', type: 'select', options: ['شقة سكنية', 'فيلا', 'محل / مكتب تجاري'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'سباكة': {
        fields: [
          { id: 'problem_type', label: 'نوع المشكلة', type: 'select', options: ['تسريب مياه', 'انسداد بالوعة / مواسير', 'تركيب أدوات صحية جديدة', 'تغيير مواسير', 'صيانة سخان'] },
          { id: 'rooms_count', label: 'عدد الحمامات / المطابخ المطلوب العمل فيها', type: 'number', placeholder: 'مثلاً: 2' },
          { id: 'place_type', label: 'نوع المكان', type: 'select', options: ['شقة سكنية', 'فيلا', 'محل / مكتب تجاري'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'نجارة': {
        fields: [
          { id: 'piece_type', label: 'نوع القطعة المطلوبة', type: 'select', options: ['مطبخ', 'دولاب / غرفة نوم', 'مكتب', 'باب خشب', 'شباك خشب', 'إصلاح أثاث موجود', 'أخرى'] },
          { id: 'dimensions', label: 'المقاس أو المساحة التقريبية', type: 'text', placeholder: 'مثلاً: 3×4 متر' },
          { id: 'wood_type', label: 'نوع الخشب المفضل', type: 'select', options: ['خشب MDF', 'خشب زان', 'خشب أبلكاش', 'مش متأكد - استشير الصنايعي'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'دهانات': {
        fields: [
          { id: 'area_m2', label: 'المساحة الإجمالية للدهان', type: 'number', unit: 'م²', placeholder: 'مثلاً: 80' },
          { id: 'paint_type', label: 'نوع الدهان', type: 'select', options: ['بلاستيك عادي', 'دهان زيت', 'دهان حراري عازل', 'ديكوري / استيل'] },
          { id: 'work_scope', label: 'طبيعة الشغل', type: 'select', options: ['دهان كامل من الصفر', 'إعادة دهان فوق دهان قديم', 'رتوش وتصليحات بسيطة'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'تكييف': {
        fields: [
          { id: 'service_type', label: 'نوع الخدمة', type: 'select', options: ['تركيب تكييف جديد', 'صيانة / تنظيف', 'تعبئة فريون', 'نقل تكييف', 'إصلاح عطل'] },
          { id: 'units_count', label: 'عدد الوحدات', type: 'number', placeholder: 'مثلاً: 1' },
          { id: 'ac_type', label: 'نوع التكييف', type: 'select', options: ['سبليت', 'شباك', 'مركزي'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'بناء وتشييد': {
        fields: [
          { id: 'work_type', label: 'نوع العمل المطلوب', type: 'select', options: ['بناء جديد من الأساس', 'تشطيبات', 'توسعة / إضافة دور', 'هدم وإعادة بناء', 'عزل أسطح'] },
          { id: 'area_m2', label: 'مساحة العمل التقريبية', type: 'number', unit: 'م²', placeholder: 'مثلاً: 120' },
          { id: 'floors_count', label: 'عدد الأدوار', type: 'number', placeholder: 'مثلاً: 1' }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'ألومنيوم': {
        fields: [
          { id: 'piece_type', label: 'نوع القطعة', type: 'select', options: ['شبابيك', 'أبواب', 'فاصل / سكشن', 'مطبخ ألومنيوم', 'أخرى'] },
          { id: 'pieces_count', label: 'عدد القطع المطلوبة', type: 'number', placeholder: 'مثلاً: 3' },
          { id: 'dimensions', label: 'المقاس التقريبي', type: 'text', placeholder: 'مثلاً: 1.5×1.2 متر' }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'سيراميك وبلاط': {
        fields: [
          { id: 'area_m2', label: 'المساحة الإجمالية', type: 'number', unit: 'م²', placeholder: 'مثلاً: 60' },
          { id: 'install_type', label: 'نوع التركيب', type: 'select', options: ['أرضيات', 'حوائط', 'أرضيات وحوائط', 'تغيير سيراميك قديم'] },
          { id: 'material_ready', label: 'هل السيراميك جاهز عندك؟', type: 'select', options: ['أيوه عندي السيراميك', 'لأ محتاج توريد / استشارة'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'ميكانيكا': {
        fields: [
          { id: 'problem_type', label: 'نوع المشكلة', type: 'select', options: ['عطل في المحرك', 'صيانة دورية', 'كهرباء عربية', 'تكييف عربية', 'أخرى'] },
          { id: 'car_model', label: 'نوع العربية والموديل', type: 'text', placeholder: 'مثلاً: لادا جرانتا 2018' }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'حمامات سباحة': {
        fields: [
          { id: 'service_type', label: 'نوع الخدمة', type: 'select', options: ['تنظيف وصيانة', 'إصلاح تسريب', 'تركيب مضخة / فلتر', 'بناء حمام سباحة جديد'] },
          { id: 'area_m2', label: 'المساحة التقريبية', type: 'number', unit: 'م²', placeholder: 'مثلاً: 30' }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      },
      'دلفري': {
        fields: [
          { id: 'delivery_type', label: 'نوع التوصيل', type: 'select', options: ['توصيل طلبات وبضائع', 'نقل أثاث خفيف', 'توصيل مستندات وأوراق', 'توصيل طعام', 'خدمة عامة'] },
          { id: 'pickup_location', label: 'مكان الاستلام', type: 'text', placeholder: 'مثلاً: وسط البلد - شارع كورنيش أسوان' },
          { id: 'delivery_location', label: 'مكان التوصيل', type: 'text', placeholder: 'مثلاً: الكيلو 6 - عمارة النصر' },
          { id: 'item_size', label: 'حجم الشحنة أو الطلب', type: 'select', options: ['صغير (ورق / مستندات)', 'متوسط (حقيبة / طرد)', 'كبير (صناديق / بضاعة)', 'ثقيل يحتاج مساعدة'] }
        ],
        descHint: 'قول مشكلتك بالتحديد...'
      }
    };
    window.PROFESSION_DETAILS_CONFIG = PROFESSION_DETAILS_CONFIG;

    // بيشيل الإيموجي والمسافات من اسم المهنة علشان نقدر نطابقها مع المفاتيح فوق (الاسم بيتسجل بصيغ مختلفة شوية بين الطلب المباشر وطلب السوق)
    function cleanProfessionName(raw) {
      return (raw || '').replace(/^[^\u0600-\u06FF\w]+/, '').trim();
    }
    window.cleanProfessionName = cleanProfessionName;

    // بيبني حقول الإدخال الإضافية الخاصة بالمهنة المختارة جوه أي container
    function renderProfessionExtraFields(containerId, rawService) {
      const container = document.getElementById(containerId);
      if (!container) return;
      const key = cleanProfessionName(rawService);
      const cfg = PROFESSION_DETAILS_CONFIG[key];
      const fields = cfg && cfg.fields;
      if (!fields || !fields.length) { container.innerHTML = ''; container.style.display = 'none'; return; }
      container.style.display = 'block';
      container.innerHTML = '<div style="font-size:12.5px;font-weight:800;color:var(--gold);margin:2px 0 12px;display:flex;align-items:center;gap:6px;"><span>📋</span> تفاصيل ' + key + ' (علشان الصنايعي يحدد السعر بالظبط)</div>' +
        fields.map(f => {
          const inputId = containerId + '__' + f.id;
          if (f.type === 'select') {
            return '<div class="form-group"><label>' + f.label + '</label><select id="' + inputId + '"><option value="">اختار</option>' +
              f.options.map(o => '<option>' + o + '</option>').join('') + '</select></div>';
          }
          if (f.type === 'number') {
            return '<div class="form-group"><label>' + f.label + (f.unit ? ' (' + f.unit + ')' : '') + '</label><input type="number" min="0" id="' + inputId + '" placeholder="' + (f.placeholder || '') + '"></div>';
          }
          return '<div class="form-group"><label>' + f.label + '</label><input type="text" id="' + inputId + '" placeholder="' + (f.placeholder || '') + '"></div>';
        }).join('');
    }
    window.renderProfessionExtraFields = renderProfessionExtraFields;

    // بيجمع قيم الحقول الإضافية اللي العميل ملاها كـ object {label: value}، أو null لو مفيش
    function collectProfessionExtraFields(containerId, rawService) {
      const key = cleanProfessionName(rawService);
      const cfg = PROFESSION_DETAILS_CONFIG[key];
      const fields = cfg && cfg.fields;
      if (!fields || !fields.length) return null;
      const result = {};
      let hasAny = false;
      fields.forEach(f => {
        const el = document.getElementById(containerId + '__' + f.id);
        if (el && el.value && el.value.trim() !== '') {
          result[f.label] = el.value.trim() + (f.type === 'number' && f.unit ? ' ' + f.unit : '');
          hasAny = true;
        }
      });
      return hasAny ? result : null;
    }
    window.collectProfessionExtraFields = collectProfessionExtraFields;

    // بيغيّر الـ placeholder بتاع خانة "وصف المشكلة" علشان يوجّه العميل يكتب التفاصيل المهمة لمهنة معينة
    // بيحفظ الـ placeholder الأصلي أول مرة عشان يرجعله لو العميل غيّر رأيه أو مفيش توجيه خاص للمهنة دي
    function updateDescPlaceholder(textareaId, rawService) {
      const ta = document.getElementById(textareaId);
      if (!ta) return;
      if (ta.dataset.defaultPlaceholder === undefined) ta.dataset.defaultPlaceholder = ta.placeholder || '';
      const key = cleanProfessionName(rawService);
      const cfg = PROFESSION_DETAILS_CONFIG[key];
      ta.placeholder = (cfg && cfg.descHint) ? cfg.descHint : ta.dataset.defaultPlaceholder;
    }
    window.updateDescPlaceholder = updateDescPlaceholder;

    // بيظهر بانر فوق الفورم يوضّح للعميل إنه بيطلب من صنايعي معين (بدل ما النص ده يتحط في خانة الوصف ويمنع ظهور التوجيه)
    function showTargetWorkerBanner(name, trade) {
      const banner = document.getElementById('req-target-worker-banner');
      const nameSpan = document.getElementById('req-target-worker-name');
      if (!banner || !nameSpan) return;
      nameSpan.textContent = name + (trade ? ' (' + trade + ')' : '');
      banner.style.display = 'block';
    }
    window.showTargetWorkerBanner = showTargetWorkerBanner;

    function hideTargetWorkerBanner() {
      const banner = document.getElementById('req-target-worker-banner');
      if (banner) banner.style.display = 'none';
    }
    window.hideTargetWorkerBanner = hideTargetWorkerBanner;

    // بيمسح حقول التفاصيل الإضافية ويخفي الـ container
    function clearProfessionExtraFields(containerId) {
      const container = document.getElementById(containerId);
      if (container) { container.innerHTML = ''; container.style.display = 'none'; }
    }
    window.clearProfessionExtraFields = clearProfessionExtraFields;

    // بيبني HTML لعرض التفاصيل دي في صفحات/مودالات العرض (للعميل/الصنايعي/الإدارة)
    function formatProfessionDetailsHTML(details) {
      if (!details || !Object.keys(details).length) return '';
      return Object.entries(details).map(([label, value]) =>
        '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;"><span style="color:rgba(255,255,255,0.45);">' + label + '</span><span style="color:#fff;font-weight:700;">' + value + '</span></div>'
      ).join('');
    }
    window.formatProfessionDetailsHTML = formatProfessionDetailsHTML;

    // بيبني سطر نصي بسيط (مش HTML) لعرض التفاصيل في الأماكن اللي بتتعامل مع نص عادي زي ملخصات الإدارة
    function formatProfessionDetailsText(details) {
      if (!details || !Object.keys(details).length) return '';
      return Object.entries(details).map(([label, value]) => label + ': ' + value).join(' — ');
    }
    window.formatProfessionDetailsText = formatProfessionDetailsText;

    function showAuthPage(tab) {
      showPage('auth');
      switchAuthTab(tab || 'login');
    }
    window.showAuthPage = showAuthPage;

    function switchAuthTab(tab) {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      document.getElementById('form-' + tab).classList.add('active');
    }
    window.switchAuthTab = switchAuthTab;

