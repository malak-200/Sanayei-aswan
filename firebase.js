    // ===== OWNER / PERMISSIONS (defined early — used by auth state) =====
    const OWNER_EMAIL = 'malaksameh350@gmail.com';
    const OWNER_UID_KEY = 'admin_owner_uid';
    function isOwner() {
      if (!currentUser) return false;
      return currentUser.email === OWNER_EMAIL ||
        localStorage.getItem(OWNER_UID_KEY) === currentUser.uid;
    }
    window.isOwner = isOwner;


    // ===== EARLY PAGE SWITCHER (يشتغل فوراً قبل Firebase) =====
    function _earlyShowPage(name) {
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
      var el = document.getElementById('page-' + name);
      if (el) { el.classList.add('active'); window.scrollTo(0, 0); }
    }
    // تعريف مبكر للزرارين علشان يشتغلوا حتى لو Firebase اتأخر
    window._earlyShowPage = _earlyShowPage;

    // Firebase compat wrappers
    function initializeApp(cfg) { return firebase.initializeApp(cfg); }
    function getAuth(app) { return app.auth(); }
    function getDatabase(app) { return app.database(); }
    function ref(db, path) { return db.ref(path); }
    function set(r, val) { return r.set(val); }
    function get(r) { return r.once('value').then(s => ({ exists: () => s.exists(), val: () => s.val() })); }
    function update(r, val) { return r.update(val); }
    function push(r, val) { return r.push(val); }
    function remove(r) { return r.remove(); }
    function onValue(r, cb) { const handler = snap => cb({ exists: () => snap.exists(), val: () => snap.val() }); r.on('value', handler); return () => r.off('value', handler); }
    function createUserWithEmailAndPassword(auth, email, pass) { return auth.createUserWithEmailAndPassword(email, pass); }
    function signInWithEmailAndPassword(auth, email, pass) { return auth.signInWithEmailAndPassword(email, pass); }
    function onAuthStateChanged(auth, cb) { return auth.onAuthStateChanged(cb); }
    function signOut(auth) { return auth.signOut(); }

    // ===== FIREBASE SETUP =====
    const firebaseConfig = {
      apiKey: "AIzaSyB2VH94P_lbx6aeoRYSyuFnFz-AijJuS5o",
      authDomain: "sanayei-aswan.firebaseapp.com",
      databaseURL: "https://sanayei-aswan-default-rtdb.firebaseio.com",
      projectId: "sanayei-aswan",
      storageBucket: "sanayei-aswan.firebasestorage.app",
      messagingSenderId: "207344425456",
      appId: "1:207344425456:web:2524462f61363b5535e535"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getDatabase(app);
    window.db = db;

    // ===== Wallet helpers (defined early so all functions can use them) =====
    function walletRef(uid) { return ref(db, 'wallets/' + uid); }
    function walletTxnRef(uid) { return ref(db, 'wallet_transactions/' + uid); }

    // ===== AUTH STATE =====
    let currentUser = null;
    let currentProfile = null;
    window.currentUser = null;
    window.currentProfile = null;

    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      window.currentUser = user;
      if (user) {
        // ===== تحقق من الحذف أول حاجة =====
        if (!isOwner()) {
          const deletedSnap = await get(ref(db, 'deleted_users/' + user.uid));
          if (deletedSnap.exists()) {
            await auth.signOut();
            currentUser = null;
            window.currentUser = null;
            showPage('auth');
            return;
          }
        }

        // ===== مراقبة realtime لو الأدمن حذف الحساب وهو مسجل دخول =====
        if (!isOwner()) {
          onValue(ref(db, 'deleted_users/' + user.uid), function (snap) {
            if (snap.exists() && window.currentUser) {
              auth.signOut().then(function () {
                window.currentUser = null;
                window.currentProfile = null;
                showPage('auth');
              });
            }
          });
        }

        // ===== تحقق من البلوك =====
        if (!isOwner()) {
          const blockSnap = await get(ref(db, 'blocked_users/' + user.uid));
          if (blockSnap.exists()) {
            const blockData = blockSnap.val();
            const unblockAt = new Date(blockData.unblock_at);
            if (new Date() < unblockAt) {
              // لسه محظور
              const remainDays = Math.ceil((unblockAt - new Date()) / 86400000);
              await auth.signOut();
              currentUser = null;
              showPage('auth');
              setTimeout(() => {
                document.querySelector('.auth-form.active')?.insertAdjacentHTML('afterbegin',
                  `<div style="background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.4);border-radius:12px;padding:14px 16px;margin-bottom:16px;text-align:center;">
                    <div style="font-size:20px;margin-bottom:6px;">🚫</div>
                    <div style="font-size:14px;font-weight:800;color:#E74C3C;margin-bottom:4px;">تم تعليق حسابك</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.55);">السبب: ${blockData.reason || 'مخالفة الشروط'}</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px;">ينتهي الحظر بعد ${remainDays} يوم${remainDays > 1 ? '' : ''}</div>
                  </div>`
                );
              }, 300);
              return;
            } else {
              // انتهى البلوك — احذفه
              await set(ref(db, 'blocked_users/' + user.uid), null);
            }
          }
        }
        // ================================
        await loadCurrentProfile();
        updateNavForLoggedIn();
        listenNotifications();
        loadChatList();
        // طلب إذن إشعارات المتصفح
        // إشعارات رسائل العملاء للمالك
        setTimeout(listenAdminContactNotifs, 1500);
        const authPage = document.getElementById('page-auth');
        if (authPage && authPage.classList.contains('active')) {
          if (currentProfile) {
            showPage(currentProfile.role === 'worker' ? 'profile-worker' : 'profile-client');
          } else {
            showPage('home');
          }
        }
      } else {
        currentProfile = null;
        window.currentProfile = null;
        updateNavForLoggedOut();
        // تحميل الخدمات المخصصة حتى بدون لوجين
        loadCustomServicesOnHome();
      }
    });
    // تحميل الخدمات المخصصة فور فتح الصفحة
    setTimeout(loadCustomServicesOnHome, 800);
    // تحميل أرقام الدفع من Firebase وتطبيقها على صفحة المحفظة
    setTimeout(() => { if (window.initPaymentSettings) window.initPaymentSettings(); }, 1000);

    async function loadCurrentProfile() {
      if (!currentUser) return;
      const snap = await get(ref(db, 'profiles/' + currentUser.uid));
      currentProfile = snap.exists() ? snap.val() : null;
      window.currentProfile = currentProfile;
      if (currentProfile) {
        renderClientProfile(currentProfile);
        renderWorkerProfile(currentProfile);
        loadMyOrders();
        // لو صنايعي، حمّل حالة الإتاحة وابدأ real-time listener عليها
        if (currentProfile.role === 'worker') {
          // تحميل أولي
          const cSnap = await get(ref(db, 'craftsmen/' + currentUser.uid));
          if (cSnap.exists()) {
            const checkbox = document.getElementById('availability-checkbox');
            const label = document.querySelector('.toggle-label');
            const available = cSnap.val().available;
            if (checkbox) checkbox.checked = available;
            if (label) label.textContent = available ? '🟢 الحالة: متاح للعمل دلوقتي' : '🔴 الحالة: مش متاح دلوقتي';
          }
          // real-time listener على حالة الإتاحة — يتحدث فوراً لو تغيّرت من جهاز تاني
          onValue(ref(db, 'craftsmen/' + currentUser.uid + '/available'), (snap) => {
            const available = snap.val();
            const checkbox = document.getElementById('availability-checkbox');
            const label = document.querySelector('.toggle-label');
            if (checkbox && checkbox.checked !== available) checkbox.checked = available;
            if (label) label.textContent = available ? '🟢 الحالة: متاح للعمل دلوقتي' : '🔴 الحالة: مش متاح دلوقتي';
          });
        }
      }
    }

    function updateNavForLoggedIn() {
      const name = currentProfile?.full_name || 'حسابي';
      const role = currentProfile?.role;
      const icon = role === 'worker' ? '🔧' : '👤';

      const nameEl = document.getElementById('nav-display-name');
      if (nameEl) nameEl.textContent = name.split(' ')[0];

      const avatarEl = document.getElementById('nav-avatar');
      if (avatarEl) {
        const type = role === 'worker' ? 'worker' : 'client';
        const savedAvatar = currentUser ? localStorage.getItem('avatar_' + type + '_' + currentUser.uid) : null;
        if (savedAvatar) {
          avatarEl.innerHTML = '<img src="' + savedAvatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:0;">';
        } else {
          avatarEl.textContent = icon;
        }
      }

      const profileLink = document.getElementById('nav-profile-link');
      if (profileLink) profileLink.innerHTML = icon + ' بروفيلي';
      const loginBtn = document.getElementById('nav-login-btn');
      if (loginBtn) loginBtn.style.display = 'none';
      const profileWrap = document.getElementById('nav-profile-wrap');
      if (profileWrap) profileWrap.style.display = 'block';
      const reqsLink = document.getElementById('nav-requests-link');
      const clientOrdersLink = document.getElementById('nav-client-orders-link');
      if (reqsLink) reqsLink.style.display = role === 'worker' ? 'block' : 'none';
      if (clientOrdersLink) clientOrdersLink.style.display = role === 'client' ? 'block' : 'none';
      // wallet — workers only
      const navWalletLink = document.getElementById('nav-wallet-link');
      const siWallet = document.getElementById('si-wallet');
      const mbnWallet = document.getElementById('mbnav-wallet');
      if (navWalletLink) navWalletLink.style.display = role === 'worker' ? 'block' : 'none';
      if (siWallet) siWallet.style.display = role === 'worker' ? 'flex' : 'none';
      if (mbnWallet) mbnWallet.style.display = role === 'worker' ? 'flex' : 'none';
      if (role === 'worker') loadWorkerRequests();
      // update sidebar
      updateSidebarUser();
      // update mobile topbar
      const mobileLoginBtn = document.getElementById('mobile-login-btn');
      if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
      // شغّل الـ listener العالمي للصنايعي
      if (role === 'worker') startWorkerGlobalListener();
      // تحقق من رسائل العملاء لو المالك
      setTimeout(() => { checkAdminMsgBadge(); loadCustomServicesOnHome(); }, 500);
      if (role === 'client') startClientGlobalListener();
      // ===== CLIENT MARKET: show/hide nav elements =====
      setTimeout(() => {
        cmShowNavElements();
        cmLoadMarket();
        if (currentUser) cmLoadMine();
      }, 300);
    }
    function updateNavForLoggedOut() {
      const btn = document.getElementById('nav-profile-btn');
      if (btn) btn.innerHTML = '👤 حسابي ▾';
      const loginBtn = document.getElementById('nav-login-btn');
      if (loginBtn) loginBtn.style.display = '';
      const profileWrap = document.getElementById('nav-profile-wrap');
      if (profileWrap) profileWrap.style.display = 'none';
      // reset sidebar
      const sbLogin = document.getElementById('sb-login-btn');
      const sbUser = document.getElementById('sb-user-info');
      if (sbLogin) sbLogin.style.display = 'flex';
      if (sbUser) sbUser.style.display = 'none';
      // reset mobile topbar
      const mobileLoginBtn = document.getElementById('mobile-login-btn');
      if (mobileLoginBtn) mobileLoginBtn.style.display = '';
    }

    async function goToMyProfile() {
      if (!currentUser) { showAuthPage('login'); return; }
      if (!currentProfile) await loadCurrentProfile();
      if (!currentProfile) { showPage('home'); return; }
      showPage(currentProfile.role === 'worker' ? 'profile-worker' : 'profile-client');
    }
    window.goToMyProfile = goToMyProfile;

