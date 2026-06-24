    function renderCraftsmen(list) {
      const grid = document.getElementById('craftsmen-grid');
      if (!list.length) {
        grid.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;grid-column:1/-1;padding:2rem">لا يوجد صنايعية في هذا التخصص حالياً</p>';
        return;
      }
      grid.innerHTML = list.map((c) => {
        const cid = c.id || c.user_id;
        return `
    <div class="craftsman-card fade-up" style="cursor:default;">
      <div class="craftsman-header">
        <div class="craftsman-avatar">${c.emoji || '🔧'}</div>
        <div style="flex:1">
          <div class="craftsman-name">${c.name}</div>
          <div class="craftsman-trade">${c.trade}</div>
          <div class="craftsman-location">📍 ${c.area}</div>
        </div>
      </div>
      <div class="stars">
        ${'★'.repeat(Math.floor(c.rating || 5))}${(c.rating || 5) % 1 ? '½' : ''}
        <span>(${c.reviews || 0} تقييم)</span>
      </div>
      <div class="craftsman-tags">${(c.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}</div>
      <div class="craftsman-footer">
        <span class="available-badge ${c.available ? 'yes' : 'busy'}">${c.available ? '🟢 متاح' : '🔴 مشغول'}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button onclick="event.stopPropagation(); openProfileById('${cid}')" style="flex:1;padding:9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:9px;color:rgba(255,255,255,0.8);font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">
          <i class="fas fa-user"></i> الملف
        </button>
        <button onclick="event.stopPropagation(); bookCraftsmanById('${cid}')" style="flex:2;padding:9px;background:rgba(200,135,58,0.15);border:1px solid rgba(200,135,58,0.35);border-radius:9px;color:#C8873A;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;" onmouseover="this.style.background='rgba(200,135,58,0.28)'" onmouseout="this.style.background='rgba(200,135,58,0.15)'">
          <i class="fas fa-calendar-check"></i> احجز دلوقتي
        </button>
      </div>
    </div>`;
      }).join('');
    }

    let currentFilter = 'الكل';
    function filterCards() {
      const q = (document.getElementById('search-input')?.value || '').toLowerCase();
      const filtered = craftsmen.filter(c => {
        if (!c.available) return false; // مش ظاهر لو مش متاح أو رصيده صفر
        if (c.is_busy) return false; // مش ظاهر لو مشغول بطلب شغّال دلوقتي
        const matchFilter = currentFilter === 'الكل' || c.trade?.includes(currentFilter);
        const matchSearch = !q || c.name?.includes(q) || c.trade?.includes(q) || c.area?.includes(q) || (c.tags || []).some(t => t.includes(q));
        return matchFilter && matchSearch;
      });
      renderCraftsmen(filtered);
    }
    window.filterCards = filterCards;

    function setFilter(f, btn) {
      currentFilter = f;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterCards();
    }
    window.setFilter = setFilter;

    function filterCraftsmen(trade) {
      showPage('craftsmen');
      currentFilter = trade;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.textContent.includes(trade));
      });
      filterCards();
    }
    window.filterCraftsmen = filterCraftsmen;

    // ===== NAVIGATION =====
    async function showPage(name) {
      _stopRequestDetailListener(); // وقّف listener التفاصيل لما تروح لأي صفحة تانية

      // ===== PAGE PERMISSIONS CHECK =====
      if (currentUser && !isOwner()) {
        try {
          const permSnap = await get(ref(db, 'admin_permissions/' + currentUser.uid));
          if (permSnap.exists()) {
            const allowedPages = permSnap.val().allowed_pages || [];
            if (allowedPages.length > 0) {
              // صفحات مفتوحة دايماً بغض النظر عن الصلاحيات
              const publicPages = ['auth', 'wallet', 'client-market', 'home', 'craftsmen', 'request', 'profile-client', 'profile-worker', 'client-orders', 'worker-requests', 'chat', 'guide'];
              // normalize: profile-client / profile-worker كلهم بيعتبروا 'profile'
              const normalizedName = name.startsWith('profile') ? (name === 'profile-worker' ? 'profile-worker' : 'profile-client') : name;
              if (!publicPages.includes(normalizedName) && !allowedPages.includes(normalizedName)) {
                showToast('⛔ مش مسموح بالوصول لهذه الصفحة', '#E74C3C');
                // وديه لأول صفحة مسموح بيها
                const firstAllowed = allowedPages[0];
                if (firstAllowed && firstAllowed !== name) showPage(firstAllowed);
                return;
              }
            }
          }
        } catch (e) { }
      }
      // client-orders
      if (name === 'client-orders') {
        if (!currentUser) { showAuthPage('login'); return; }
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-client-orders').classList.add('active');
        startRealtimeForClientOrders();
        // مسح إشعارات الطلبات في Firebase + صفّر الـ badge
        markClientOrderNotifsRead();
        window.scrollTo(0, 0);
        return;
      }
      // worker-requests
      if (name === 'worker-requests') {
        if (!currentUser) { showAuthPage('login'); return; }
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-worker-requests').classList.add('active');
        startRealtimeForWorkerRequests();
        markWorkerOrderNotifsRead();
        window.scrollTo(0, 0);
        return;
      }
      // profile redirect
      if (name === 'profile-client' || name === 'profile-worker') {
        if (!currentUser) { showAuthPage('login'); return; }
        if (!currentProfile) await loadCurrentProfile();
        if (currentProfile) {
          name = currentProfile.role === 'worker' ? 'profile-worker' : 'profile-client';
        } else {
          name = 'profile-client';
        }
      }
      stopRealtimeListeners();
      // وقف admin listeners لو خرجنا من لوحة المالك
      if (name !== 'admin') stopAdminListeners();
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const pageEl = document.getElementById('page-' + name);
      if (!pageEl) return;
      pageEl.classList.add('active');
      if (name === 'craftsmen') { startCraftsmenRealtimeListener(); loadCraftsmenFilterTabs(); }
      if (name === 'home') { loadCustomServicesOnHome(); }
      if (name === 'profile-client') { loadCurrentProfile(); loadMyOrders(); setTimeout(loadSavedAvatars, 100); startRealtimeForClientProfile(); loadClientRatings(); }
      if (name === 'profile-worker') { loadCurrentProfile(); setTimeout(loadSavedAvatars, 100); startRealtimeForWorkerProfile(); if (currentUser && typeof window.loadPortfolio === 'function') window.loadPortfolio(currentUser.uid); }
      if (name === 'wallet') { if (typeof window.loadWallet === 'function') window.loadWallet(); }
      window.scrollTo(0, 0);
    }
    window.showPage = showPage;


    // ===== AUTH =====
    let selectedRole = '';
    function selectRole(r) {
      selectedRole = r;
      document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('role-' + r).classList.add('active');
      // إظهار حقل الحرفة وصور البطاقة للصنايعي فقط
      const tradeGroup = document.getElementById('reg-trade-group');
      if (tradeGroup) tradeGroup.style.display = r === 'worker' ? 'block' : 'none';
      const idGroup = document.getElementById('reg-id-group');
      const idGroupBack = document.getElementById('reg-id-group-back');
      if (idGroup) idGroup.style.display = r === 'worker' ? 'block' : 'none';
      if (idGroupBack) idGroupBack.style.display = r === 'worker' ? 'block' : 'none';
    }
    window.selectRole = selectRole;

    function togglePass(inputId, btn) {
      const input = document.getElementById(inputId);
      const icon = btn.querySelector('i');
      if (input.type === 'password') { input.type = 'text'; icon.className = 'fas fa-eye-slash'; }
      else { input.type = 'password'; icon.className = 'fas fa-eye'; }
    }
    window.togglePass = togglePass;

    async function doLogin() {
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-pass').value.trim();
      if (!email || !pass) { alert('من فضلك ادخل الإيميل وكلمة المرور'); return; }
      if (!email.includes('@')) { alert('الإيميل مش صح'); return; }
      const btns = document.querySelectorAll('#form-login .auth-btn');
      const btn = btns[0];
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الدخول...';
      try {
        const result = await signInWithEmailAndPassword(auth, email, pass);
        currentUser = result.user;
        await loadCurrentProfile();
        updateNavForLoggedIn();
        const dest = currentProfile?.role === 'worker' ? 'profile-worker' : 'profile-client';
        showPage(dest);
      } catch (e) {
        alert('الإيميل أو كلمة المرور غلط');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
    window.doLogin = doLogin;

    async function doRegister() {
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const phone = document.getElementById('reg-phone').value.trim();
      const area = document.getElementById('reg-area').value.trim();
      const pass = document.getElementById('reg-pass').value.trim();
      const pass2 = document.getElementById('reg-pass2').value.trim();
      const role = selectedRole;
      const trade = role === 'worker' ? document.getElementById('reg-trade').value.trim() : '';
      if (!name || !email || !phone || !area || !pass || !pass2) { alert('من فضلك اكمل كل الحقول'); return; }
      if (!role) { alert('من فضلك اختار نوع حسابك: عميل أو صنايعي'); return; }
      if (!email.includes('@')) { alert('الإيميل مش صح'); return; }
      if (phone.length < 11) { alert('رقم التليفون لازم يكون 11 رقم'); return; }
      if (role === 'worker' && !trade) { alert('من فضلك اختار تخصصك'); return; }
      if (pass.length < 8) { alert('كلمة المرور لازم تكون 8 أحرف على الأقل'); return; }
      if (pass !== pass2) { alert('كلمتي المرور مش متطابقتين'); return; }

      // التحقق من صور البطاقة للصنايعي
      if (role === 'worker') {
        const frontFile = window._idCardFront;
        const backFile = window._idCardBack;
        if (!frontFile) {
          alert('من فضلك ارفع صورة وش البطاقة الشخصية وتأكد إنها واضحة');
          document.getElementById('reg-id-group')?.scrollIntoView({ behavior: 'smooth' });
          return;
        }
        if (!backFile) {
          alert('من فضلك ارفع صورة ضهر البطاقة الشخصية وتأكد إنها واضحة');
          document.getElementById('reg-id-group-back')?.scrollIntoView({ behavior: 'smooth' });
          return;
        }
      }

      const btn = document.querySelector('#form-register .auth-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إنشاء الحساب...';
      try {
        // لو صنايعي — نحوّل صور البطاقة لـ base64 قبل الرفع
        let idCardFrontB64 = null, idCardBackB64 = null;
        if (role === 'worker') {
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري رفع صور البطاقة...';
          [idCardFrontB64, idCardBackB64] = await imagesToBase64([window._idCardFront, window._idCardBack]);
        }

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إنشاء الحساب...';
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        currentUser = result.user;
        const profileData = {
          full_name: name, email: email, phone: phone, area: area, role: role,
          created_at: new Date().toISOString()
        };
        if (role === 'worker') {
          profileData.trade = trade;
          profileData.id_card_front = idCardFrontB64;
          profileData.id_card_back = idCardBackB64;
          profileData.id_card_verified = false; // الأدمن يراجعها ويوافق
          profileData.id_card_uploaded_at = new Date().toISOString();
        }
        await set(ref(db, 'profiles/' + result.user.uid), profileData);
        // لو صنايعي، ضيفه في craftsmen عشان يظهر في القايمة
        if (role === 'worker') {
          await set(ref(db, 'craftsmen/' + result.user.uid), {
            user_id: result.user.uid,
            name: name,
            phone: phone,
            trade: trade || 'عام',
            area: area || 'أسوان',
            rating: 5,
            reviews: 0,
            price: '0',
            tags: [],
            available: false, // غير نشط لحد ما الأدمن يقبل البطاقة
            emoji: '🔧'
          });
          // ✅ إنشاء محفظة فارغة للصنايعي الجديد تلقائياً
          await set(ref(db, 'wallets/' + result.user.uid), {
            balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0,
            created_at: new Date().toISOString()
          });
        }
        await loadCurrentProfile();
        updateNavForLoggedIn();
        const successMsg = document.getElementById('register-success-msg');
        if (successMsg) {
          successMsg.innerHTML = role === 'worker'
            ? 'تم إنشاء حسابك! 🎉<br>حسابك هيتفعّل بعد مراجعة صور البطاقة من الأدمن.<br><small style="color:rgba(255,255,255,0.5);">هتلاقي حالة حسابك في صفحة البروفايل</small>'
            : 'أهلاً بك في عيلة صنايعي أسوان<br>بنحولك للصفحة الرئيسية...';
        }
        document.getElementById('register-success').style.display = 'block';
        setTimeout(() => {
          document.getElementById('register-success').style.display = 'none';
          showPage('home');
        }, 2500);
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
          alert('الإيميل ده مسجل قبل كده، ادخل مباشرة');
        } else {
          alert('حصل خطأ: ' + e.message);
        }
      } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> إنشاء الحساب';
      }
    }
    window.doRegister = doRegister;

    function socialLogin(provider) {
      alert('ميزة الدخول بـ ' + (provider === 'google' ? 'Google' : provider) + ' قريباً!');
    }
    window.socialLogin = socialLogin;

    async function doLogout() {
      stopWorkerGlobalListener();
      await signOut(auth);
      currentUser = null; currentProfile = null; window.currentUser = null; window.currentProfile = null;
      showPage('home');
    }
    window.doLogout = doLogout;

    // ===== SERVICE REQUEST =====
    async function submitRequest() {
      if (currentProfile?.role === 'worker') {
        alert('الصنايعي مش بيقدر يطلب خدمة من صنايعي تاني!');
        return;
      }
      const service = document.getElementById('req-service').value;
      const name = document.getElementById('req-name').value;
      const phone = document.getElementById('req-phone').value;
      const address = document.getElementById('req-address').value;
      const desc = document.getElementById('req-desc').value;
      const area = document.getElementById('req-area').value;
      const time = document.getElementById('req-time').value;
      const details = collectProfessionExtraFields('req-extra-fields', service);
      if (!service || !name || !phone || !address) { alert('من فضلك اكمل كل الحقول المطلوبة'); return; }
      const btn = document.querySelector('.submit-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
      // FIX #11: timestamp + random suffix — منع تكرار رقم الطلب
      const orderNum = 'ASW-' + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 5).toUpperCase();
      // تحويل الصور لـ base64
      const images = window._reqImages && window._reqImages.length ? await imagesToBase64(window._reqImages) : [];
      try {
        const targetWid   = window._targetWorkerId || null;
        const targetWname  = window._targetWorkerName || null;
        // جيب بيانات الصنايعي المحدد لو موجود
        let workerPhone = '';
        if (targetWid) {
          try {
            const wSnap = await get(ref(db, 'craftsmen/' + targetWid));
            if (wSnap.exists()) workerPhone = wSnap.val().phone || '';
          } catch(e) {}
        }
        await set(ref(db, 'service_requests/' + orderNum), {
          order_number: orderNum, service_type: service, client_name: name, client_phone: phone,
          address, area, preferred_time: time, description: desc, details: details || null,
          status: 'pending', user_id: currentUser?.uid || null,
          // نربط الطلب بالصنايعي المحدد مباشرة من الأول
          worker_id: targetWid,
          worker_name: targetWname,
          worker_phone: workerPhone,
          images: images,
          created_at: new Date().toISOString()
        });
        window._targetWorkerId = null;
        window._targetWorkerName = null;
        // ابعت إشعار للصنايعي اللي اختاره العميل بس
        try {
          if (targetWid) {
            await push(ref(db, 'notifications/' + targetWid), {
              type: 'new_order', title: '🔔 طلب خدمة جديد!',
              body: name + ' عايز ' + service + ' في ' + (area || address),
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        } catch (e) { console.error('notify worker error:', e); }
        document.getElementById('order-num').textContent = '# رقم الطلب: ' + orderNum;
        document.getElementById('request-form-container').style.display = 'none';
        document.getElementById('success-box').style.display = 'block';
      } catch (e) {
        alert('حصل خطأ في الإرسال، حاول تاني');
      } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> إرسال الطلب';
      }
    }
    window.submitRequest = submitRequest;

    function resetRequest() {
      document.getElementById('request-form-container').style.display = 'block';
      document.getElementById('success-box').style.display = 'none';
      ['req-service', 'req-name', 'req-phone', 'req-address', 'req-desc'].forEach(id => document.getElementById(id).value = '');
      clearProfessionExtraFields('req-extra-fields');
      updateDescPlaceholder('req-desc', '');
      hideTargetWorkerBanner();
    }
    window.resetRequest = resetRequest;


    // ===== DESKTOP SIDEBAR NAV =====
    function sidebarNav(page) {
      document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
      const btn = document.getElementById('si-' + page);
      if (btn) btn.classList.add('active');
      showPage(page);
    }
    function sidebarNavOrders() {
      document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
      document.getElementById('si-orders').classList.add('active');
      if (!currentUser) { showAuthPage('login'); return; }
      showUnifiedOrders();
    }
    function sidebarNavProfile() {
      document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
      const el = document.getElementById('si-profile');
      if (el) el.classList.add('active');
      if (!currentUser) { showAuthPage('login'); return; }
      goToMyProfile();
    }
    function updateSidebarUser() {
      const loginBtn = document.getElementById('sb-login-btn');
      const userInfo = document.getElementById('sb-user-info');
      if (!currentUser || !currentProfile) {
        if (loginBtn) loginBtn.style.display = 'flex';
        if (userInfo) userInfo.style.display = 'none';
        return;
      }
      if (loginBtn) loginBtn.style.display = 'none';
      if (userInfo) userInfo.style.display = 'flex';
      const nameEl = document.getElementById('sb-name');
      const roleEl = document.getElementById('sb-role');
      const avatarEl = document.getElementById('sb-avatar');
      if (nameEl) nameEl.textContent = currentProfile.full_name?.split(' ')[0] || 'مستخدم';
      if (roleEl) roleEl.textContent = currentProfile.role === 'worker' ? '🔧 صنايعي' : '👤 عميل';
      if (avatarEl) {
        const type = currentProfile.role === 'worker' ? 'worker' : 'client';
        const saved = currentUser ? localStorage.getItem('avatar_' + type + '_' + currentUser.uid) : null;
        if (saved) avatarEl.innerHTML = '<img src="' + saved + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        else avatarEl.textContent = currentProfile.role === 'worker' ? '🔧' : '👤';
      }
      // sync orders/chat badges
      const ordBadge = document.getElementById('si-orders-badge');
      const navBadge = document.getElementById('nav-reqs-badge');
      if (ordBadge && navBadge) { ordBadge.textContent = navBadge.textContent; ordBadge.className = 'si-badge' + (navBadge.style.display !== 'none' && navBadge.textContent ? ' show' : ''); }
    }
    window.updateSidebarUser = updateSidebarUser;
    // patch updateNavForLoggedIn to also update sidebar
    const _origUpdateNav = window.updateNavForLoggedIn;
    // ===== END DESKTOP SIDEBAR NAV =====

    // ===== MOBILE BOTTOM NAV =====
    function mobileNav(page) {
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      const btn = document.getElementById('mbnav-' + page);
      if (btn) btn.classList.add('active');
      showPage(page);
    }
    function mobileNavRequest() {
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById('mbnav-request').classList.add('active');
      goToRequest();
    }
    function mobileNavOrders() {
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById('mbnav-orders').classList.add('active');
      if (!currentUser) { showAuthPage('login'); return; }
      showUnifiedOrders();
    }
    function mobileNavProfile() {
      document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById('mbnav-profile').classList.add('active');
      if (!currentUser) { showAuthPage('login'); return; }
      goToMyProfile();
    }
    // sync both sidebar and bottom nav active state with showPage
    const _origShowPage = window.showPage;
    window.showPage = async function (name) {
      // client-market page
      if (name === 'client-market') {
        _stopRequestDetailListener();
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pg = document.getElementById('page-client-market');
        if (pg) pg.classList.add('active');
        cmLoadMarket();
        if (currentUser) cmLoadMine();
        window.scrollTo(0, 0);
        // nav highlights
        document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
        document.getElementById('mbnav-market')?.classList.add('active');
        document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
        document.getElementById('si-market')?.classList.add('active');
        return;
      }
      await _origShowPage(name);
      // load chat list once after page shown
      if (name === 'chat') { showChatList(); }
      const map = { home: 'home', craftsmen: 'craftsmen', request: 'request', 'client-orders': 'orders', 'worker-requests': 'orders', 'profile-client': 'profile', 'profile-worker': 'profile', auth: 'profile' };
      const active = map[name];
      // mobile
      if (active) {
        document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
        const mobId = active === 'orders' ? 'mbnav-orders' : active === 'chat' ? 'mbnav-chat' : 'mbnav-' + active;
        const mob = document.getElementById(mobId);
        if (mob) mob.classList.add('active');
      }
      // sidebar
      document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
      const siMap = { home: 'si-home', craftsmen: 'si-craftsmen', orders: 'si-orders', chat: 'si-chat', profile: 'si-profile' };
      if (active && siMap[active]) { const el = document.getElementById(siMap[active]); if (el) el.classList.add('active'); }
    };
    // update orders badge
    function updateMobileOrdersBadge(count) {
      const badge = document.getElementById('mbnav-orders-badge');
      if (!badge) return;
      if (count > 0) { badge.textContent = count; badge.classList.add('show'); }
      else badge.classList.remove('show');
    }
    window.updateMobileOrdersBadge = updateMobileOrdersBadge;
    // ===== END MOBILE BOTTOM NAV =====


    // ===== PROFILES =====
    function renderClientProfile(p) {
      if (!p) return;
      const page = document.getElementById('page-profile-client');
      if (!page) return;
      const nameEl = page.querySelector('.profile-name');
      if (nameEl) nameEl.textContent = p.full_name || 'المستخدم';
      const meta = page.querySelector('.profile-meta');
      if (meta) meta.innerHTML = '📍 ' + (p.address || 'أسوان') + ' &nbsp;·&nbsp; عضو منذ ' + (p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }) : '');
      const rows = page.querySelectorAll('.info-val');
      if (rows[0]) rows[0].textContent = p.email || '-';
      if (rows[1]) rows[1].textContent = p.address || '-';
      if (rows[2]) rows[2].textContent = p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }) : '-';
    }

    function renderWorkerProfile(p) {
      if (!p || p.role !== 'worker') return;
      const page = document.getElementById('page-profile-worker');
      if (!page) return;

      // بانر حالة البطاقة — يظهر بس لو الحساب محتاج مراجعة أو اترفض
      let statusBanner = document.getElementById('worker-id-status-banner');
      if (!statusBanner) {
        statusBanner = document.createElement('div');
        statusBanner.id = 'worker-id-status-banner';
        page.insertBefore(statusBanner, page.firstChild);
      }
      if (p.id_card_verified === true) {
        statusBanner.innerHTML = '';
      } else if (p.id_card_front && p.id_card_verified === false) {
        // رفضت البطاقة
        statusBanner.innerHTML = '<div style="background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.4);border-radius:14px;padding:14px 16px;margin:12px 16px;text-align:center;"><div style="font-size:16px;margin-bottom:4px;">❌</div><div style="font-size:14px;font-weight:800;color:#E74C3C;">تم رفض صور البطاقة</div><div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px;">حسابك غير نشط - تواصل مع الأدمن لمعرفة السبب أو لإعادة رفع الصور</div></div>';
      } else if (!p.id_card_front) {
        // لسه مرفعتش
        statusBanner.innerHTML = '<div style="background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.35);border-radius:14px;padding:14px 16px;margin:12px 16px;text-align:center;"><div style="font-size:16px;margin-bottom:4px;">🪪</div><div style="font-size:14px;font-weight:800;color:#C8873A;">حسابك غير مفعّل</div><div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px;">محتاج تسجّل من جديد برفع صور البطاقة الشخصية عشان الأدمن يفعّل حسابك</div></div>';
      } else {
        // رافع الصور وبينتظر
        statusBanner.innerHTML = '<div style="background:rgba(52,152,219,0.12);border:1px solid rgba(52,152,219,0.35);border-radius:14px;padding:14px 16px;margin:12px 16px;text-align:center;"><div style="font-size:16px;margin-bottom:4px;">⏳</div><div style="font-size:14px;font-weight:800;color:#5DADE2;">حسابك قيد المراجعة</div><div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px;">صور البطاقة اترفعت وبنراجعها - هيتفعّل حسابك قريباً</div></div>';
      }

      const nameEl = page.querySelector('.profile-name');
      if (nameEl) nameEl.textContent = p.full_name || '-';
      const meta = page.querySelector('.profile-meta');
      if (meta) meta.innerHTML = '📍 ' + (p.work_area || '-') + ' &nbsp;·&nbsp; عضو منذ ' + (p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }) : '');
      // target info-val inside the personal data card only
      const personalCard = page.querySelector('.profile-card');
      if (personalCard) {
        const rows = personalCard.querySelectorAll('.info-val');
        if (rows[0]) rows[0].textContent = p.email || '-';
        if (rows[1]) rows[1].textContent = p.work_area || '-';
      }
      if (document.getElementById('worker-stat-price')) document.getElementById('worker-stat-price').textContent = p.price_per_hour ? p.price_per_hour + ' ج' : '-';
      if (document.getElementById('worker-stat-rating')) document.getElementById('worker-stat-rating').textContent = p.rating ? p.rating + '⭐' : '-';
      if (document.getElementById('worker-stat-reviews')) document.getElementById('worker-stat-reviews').textContent = p.reviews || 0;
      // render skills/tags
      const skillsEl = document.getElementById('worker-skills-tags');
      if (skillsEl) {
        const tags = p.tags || [];
        if (tags.length) {
          skillsEl.innerHTML = tags.map(t => '<span class="tag">' + t + '</span>').join('');
        } else if (p.trade) {
          skillsEl.innerHTML = '<span class="tag">' + p.trade + '</span>';
        } else {
          skillsEl.innerHTML = '<span style="color:rgba(255,255,255,0.3);font-size:13px;">لا توجد مهارات مضافة بعد</span>';
        }
      }
      // load ratings
      loadWorkerRatings();
      // render bio
      const bioSection = document.getElementById('worker-bio-section');
      const bioText = document.getElementById('worker-bio-text');
      if (bioSection && bioText) {
        if (p.bio && p.bio.trim()) {
          bioText.textContent = p.bio;
          bioSection.style.display = 'block';
        } else {
          bioSection.style.display = 'none';
        }
      }
      // load worker orders
      loadWorkerOrders();
    }

    async function loadMyOrders() {
      if (!currentUser) return;
      try {
        const snap = await get(ref(db, 'service_requests'));
        if (!snap.exists()) return;
        const data = Object.values(snap.val()).filter(o => o.user_id === currentUser.uid).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // تقييم العميل من الصنايعية
        const profileSnap = await get(ref(db, 'profiles/' + currentUser.uid));
        if (profileSnap.exists()) {
          const pdata = profileSnap.val();
          const ratingEl = document.querySelector('#page-profile-client .stat-strip .stat-box:nth-child(3) .stat-box-num');
          if (ratingEl) ratingEl.textContent = pdata.avg_rating ? pdata.avg_rating + ' ⭐' : '-';
        }
        // عدد التقييمات اللي العميل بعتها للصنايعية
        const ratedCount = data.filter(o => o.client_rated).length;
        const favEl = document.querySelector('#page-profile-client .stat-strip .stat-box:nth-child(4) .stat-box-num');
        if (favEl) favEl.textContent = ratedCount;
        const favLabel = document.querySelector('#page-profile-client .stat-strip .stat-box:nth-child(4) .stat-box-label');
        if (favLabel) favLabel.textContent = 'تقييم أرسلته';

        // تحديث الإحصائيات فقط
        const boxes = document.querySelectorAll('#page-profile-client .stat-box-num');
        if (boxes[0]) boxes[0].textContent = data.filter(o => o.status === 'done').length;
        if (boxes[1]) boxes[1].textContent = data.filter(o => ['pending', 'accepted', 'worker_done_pending'].includes(o.status)).length;

      } catch (e) { console.log('orders error', e); }
    }


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

    // ===== CLIENT RATINGS (تعليقات الصنايعية على العميل) =====
    async function loadClientRatings() {
      if (!currentUser) return;
      const el = document.getElementById('client-ratings-list');
      if (!el) return;
      try {
        const snap = await get(ref(db, 'profiles/' + currentUser.uid + '/ratings_list'));
        if (!snap.exists()) {
          el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1rem;font-size:13px;">لا توجد تعليقات بعد</p>';
          return;
        }
        const list = Object.values(snap.val())
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const starLabelsArr = ['', 'ضعيف جداً 😕', 'ضعيف 😐', 'كويس 🙂', 'كويس جداً 😊', 'ممتاز! 🤩'];
        el.innerHTML = list.map(r => {
          const starsCount = parseInt(r.stars) || 0;
          const stars = '★'.repeat(starsCount) + '☆'.repeat(5 - starsCount);
          const commentText = (r.comment || '').toString().trim();
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(200,135,58,0.15);border-radius:14px;padding:14px 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,rgba(200,135,58,0.25),rgba(200,135,58,0.08));display:flex;align-items:center;justify-content:center;font-size:18px;">🔧</div>
            <div>
              <div style="font-size:14px;font-weight:700;color:#fff;">${r.from_name || 'صنايعي'}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);">${date}</div>
            </div>
          </div>
          <div style="text-align:left;">
            <div style="color:#C8873A;font-size:16px;letter-spacing:2px;">${stars}</div>
            <div style="font-size:10px;color:#C8873A;font-weight:700;text-align:center;">${starLabelsArr[starsCount] || ''}</div>
          </div>
        </div>
        ${commentText ? `<div style="background:rgba(200,135,58,0.07);border-right:3px solid rgba(200,135,58,0.5);border-radius:0 8px 8px 0;padding:10px 12px;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.7;font-style:italic;">"${commentText}"</div>` : '<div style="font-size:12px;color:rgba(255,255,255,0.25);font-style:italic;">لم يترك تعليقاً</div>'}
      </div>`;
        }).join('');
      } catch (e) { console.error('loadClientRatings error:', e); }
    }
    window.loadClientRatings = loadClientRatings;
    function handleAvatarUpload(input, type) {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { alert('الصورة كبيرة جداً! الحد الأقصى 5 ميغابايت'); return; }
      const reader = new FileReader();
      reader.onload = function (e) {
        const dataUrl = e.target.result;
        const avatarId = type === 'client' ? 'client-avatar-display' : 'worker-avatar';
        const avatarEl = document.getElementById(avatarId);
        if (avatarEl) {
          avatarEl.innerHTML = `<img src="${dataUrl}" alt="صورة البروفيل">`;
          avatarEl.style.fontSize = '0'; avatarEl.style.padding = '0';
        }
        const key = `avatar_${type}${currentUser ? '_' + currentUser.uid : ''}`;
        localStorage.setItem(key, dataUrl);
        const toast = document.createElement('div');
        toast.textContent = '✅ تم تحديث صورة البروفيل!';
        toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1E8449;color:#fff;padding:12px 24px;border-radius:12px;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
        // حدّث صورة الـ nav
        updateNavForLoggedIn();
      };
      reader.readAsDataURL(file);
    }
    window.handleAvatarUpload = handleAvatarUpload;

    function loadSavedAvatars() {
      ['client', 'worker'].forEach(type => {
        const key = `avatar_${type}${currentUser ? '_' + currentUser.uid : ''}`;
        const saved = localStorage.getItem(key);
        if (saved) {
          const avatarId = type === 'client' ? 'client-avatar-display' : 'worker-avatar';
          const avatarEl = document.getElementById(avatarId);
          if (avatarEl) {
            avatarEl.innerHTML = `<img src="${saved}" alt="صورة البروفيل">`;
            avatarEl.style.fontSize = '0'; avatarEl.style.padding = '0';
          }
        }
      });
    }

    // ===== REAL-TIME LISTENER FOR CRAFTSMEN AVAILABILITY =====
    // بيحدّث قائمة الصنايعية فوراً لو أي صنايعي غيّر حالته
    let _craftsmenRealtimeUnsub = null;

    function startCraftsmenRealtimeListener() {
      if (_craftsmenRealtimeUnsub) return; // already running
      _craftsmenRealtimeUnsub = onValue(ref(db, 'craftsmen'), async (snap) => {
        if (!snap.exists()) { craftsmen = []; filterCards(); return; }
        // جيب الـ profiles عشان نكمل البيانات
        const pSnap = await get(ref(db, 'profiles'));
        const profiles = pSnap.exists() ? pSnap.val() : {};
        // الصنايعية المشغولين بطلب شغّال دلوقتي — هيتخفوا من القايمة لحد ما يخلصوا
        let busyMap = new Map();
        if (typeof window.getBusyWorkerIds === 'function') {
          try { busyMap = await window.getBusyWorkerIds(); } catch (e) { console.error('busy fetch error:', e); }
        }
        craftsmen = Object.entries(snap.val()).map(([id, c]) => {
          const p = profiles[id] || {};
          return {
            id, user_id: id,
            name: c.name || p.full_name || 'صنايعي',
            trade: c.trade || p.trade || 'عام',
            area: c.area || p.area || 'أسوان',
            rating: c.rating || 5,
            reviews: c.reviews || 0,
            price: c.price || c.price_per_hour || '0',
            tags: c.tags || [],
            available: c.available,
            emoji: c.emoji || '🔧',
            phone: c.phone || p.phone || '',
            bio: c.bio || p.bio || '',
            photo: c.photo || p.photo || p.avatar_url || '',
            is_busy: busyMap.has(id)
          };
        });
        filterCards();
      });
    }
    window.startCraftsmenRealtimeListener = startCraftsmenRealtimeListener;

    // ===== DYNAMIC FILTER TABS FOR CRAFTSMEN PAGE =====
    async function loadCraftsmenFilterTabs() {
      const tabs = document.getElementById('filter-tabs');
      if (!tabs) return;
      try {
        // جيب الخدمات الافتراضية + المخصصة من Firebase
        const snap = await get(ref(db, 'custom_services'));
        const custom = snap.exists() ? Object.values(snap.val()) : [];

        // الخدمات الافتراضية
        const defaults = [
          { key: 'كهرباء', name: 'كهرباء', icon: '⚡' },
          { key: 'سباكة', name: 'سباكة', icon: '🔩' },
          { key: 'نجارة', name: 'نجارة', icon: '🪵' },
          { key: 'دهانات', name: 'دهانات', icon: '🎨' },
          { key: 'تكييف', name: 'تكييف', icon: '❄️' },
          { key: 'بناء', name: 'بناء', icon: '🏗️' },
          { key: 'ألومنيوم', name: 'ألومنيوم', icon: '🪟' },
          { key: 'سيراميك', name: 'سيراميك', icon: '🏠' },
          { key: 'دلفري', name: 'دلفري', icon: '🚚' },
        ];

        // ادمج الكل بدون تكرار
        const allServices = [...defaults];
        custom.forEach(s => {
          if (!allServices.find(d => d.key === s.key)) allServices.push(s);
        });

        // امسح القديم وارسم من جديد
        tabs.innerHTML = `<button class="tab-btn active" onclick="setFilter('الكل', this)">الكل</button>`;
        allServices.forEach(s => {
          tabs.insertAdjacentHTML('beforeend',
            `<button class="tab-btn" onclick="setFilter('${s.key}', this)">${s.icon} ${s.name}</button>`
          );
        });
      } catch (e) { }
    }
    window.loadCraftsmenFilterTabs = loadCraftsmenFilterTabs;

    // Init
    loadHomeStats();
    startCraftsmenRealtimeListener(); // real-time بدل loadCraftsmen() الثابت
    loadCraftsmenFilterTabs(); // حمّل الـ filter tabs ديناميكياً

    // ===== REAL-TIME LISTENERS =====
    // بدل polling — Firebase بيبعت تحديث فوري لما الداتا تتغير فقط
    let _activeListeners = {}; // لتتبع الـ listeners وإلغاؤها عند تغيير الصفحة
