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

    // ===== AUTH STATE =====
    let currentUser = null;
    let currentProfile = null;
    window.currentUser = null;
    window.currentProfile = null;

    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      window.currentUser = user;
      if (user) {
        // ===== تحقق من البلوك أول حاجة =====
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

    // ===== NOTIFICATIONS =====
    let notifListener = null;
    function showNotifPrompt() { /* disabled — no browser permission prompt */ }
    window.showNotifPrompt = showNotifPrompt;

    // ===== BROWSER PUSH NOTIFICATIONS =====
    let _notifPermission = 'default';

    async function requestNotifPermission() { /* disabled */ }

    function sendBrowserNotif(title, body, icon) { /* disabled — in-app only */ }

    // أيقونات حسب نوع الإشعار
    function notifIcon(type) {
      const icons = {
        new_order: '📋', order_accepted: '✅', order_done: '🏁',
        new_message: '💬', new_rating: '⭐', contact_reply: '📬',
        confirm_done: '🔔', done_rejected: '❌',
        price_offered: '💰', price_rejected: '❌', client_counter: '🤝',
        worker_accepted: '✅', counter_accepted: '✅', admin_reply: '📬',
        worker_not_done_yet: '⚠️', client_says_done: '🏁',
        cm_client_says_done: '🏁', new_offer: '💰'
      };
      return icons[type] || '🔔';
    }

    function listenNotifications() {
      if (!currentUser) return;
      if (notifListener) notifListener();
      let _prevNotifKeys = null;
      notifListener = onValue(ref(db, 'notifications/' + currentUser.uid), (snap) => {
        if (!snap.exists()) { updateAllBadges(0, 0); return; }
        const notifObj = snap.val();
        const notifs = Object.entries(notifObj);

        // اكتشف الإشعارات الجديدة
        if (_prevNotifKeys !== null) {
          notifs.forEach(([key, n]) => {
            if (!_prevNotifKeys.includes(key) && !n.read) {
              // إشعار جديد — ابعت browser notification
              sendBrowserNotif(
                notifIcon(n.type) + ' ' + (n.title || 'إشعار جديد'),
                n.body || '',
              );
              // وأعرض in-app notification toast
              showNotifToast(notifIcon(n.type) || '🔔', n.title || 'إشعار جديد', n.body || '', notifAccentColor(n.type));
            }
          });
        }
        _prevNotifKeys = notifs.map(([k]) => k);

        const allNotifs = notifs.map(([, v]) => v);
        const ORDER_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'client_counter', 'worker_accepted', 'counter_accepted', 'admin_reply', 'worker_not_done_yet', 'client_says_done', 'new_offer', 'cm_client_says_done', 'new_order', 'worker_counter', 'cm_worker_counter'];
        const chatUnread = allNotifs.filter(n => !n.read && !ORDER_TYPES.includes(n.type) && n.type !== 'new_rating').length;
        // لو العميل فاتح صفحة طلباته أو الصنايعي فاتح طلباته — صفّر order badge
        const clientPageOpen = document.getElementById('page-client-orders')?.classList.contains('active') || document.getElementById('page-unified-orders')?.classList.contains('active');
        const workerPageOpen = document.getElementById('page-worker-requests')?.classList.contains('active');
        const orderUnread = (clientPageOpen || workerPageOpen) ? 0 : allNotifs.filter(n => !n.read && ORDER_TYPES.includes(n.type)).length;
        updateAllBadges(chatUnread, orderUnread);
      });
    }

    // إشعارات رسائل التواصل للمالك (real-time)
    function listenAdminContactNotifs() {
      if (!isOwner()) return;
      let _prevContactKeys = null;
      onValue(ref(db, 'contact_messages'), (snap) => {
        if (!snap.exists()) return;
        const msgs = Object.entries(snap.val());
        if (_prevContactKeys !== null) {
          msgs.forEach(([key, m]) => {
            if (!_prevContactKeys.includes(key)) {
              sendBrowserNotif('💬 رسالة جديدة من عميل', m.name + ': ' + m.message);
              showToast('💬 رسالة جديدة من ' + (m.name || 'عميل'));
            }
            // رد العميل على محادثة
            if (_prevContactKeys.includes(key) && m.client_replied) {
              const prevThread = snap.val()[key]?.thread ? Object.keys(snap.val()[key].thread).length : 0;
              sendBrowserNotif('↩ ' + (m.name || 'العميل') + ' رد عليك', m.message);
            }
          });
        }
        _prevContactKeys = msgs.map(([k]) => k);
      });
    }
    // ===== END BROWSER PUSH NOTIFICATIONS =====

    function listenNotificationsSTUB() {
      if (!currentUser) return;
      if (notifListener) notifListener();
      notifListener = onValue(ref(db, 'notifications/' + currentUser.uid), (snap) => {
        if (!snap.exists()) { updateAllBadges(0, 0); return; }
        const notifs = Object.values(snap.val());
        const ALL_ORDER_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'worker_accepted', 'client_counter', 'counter_accepted', 'worker_not_done_yet', 'client_says_done', 'new_offer', 'cm_client_says_done', 'new_order', 'worker_counter', 'cm_worker_counter'];
        // رسائل غير مقروءة (شات)
        const chatUnread = notifs.filter(n => !n.read && !ALL_ORDER_TYPES.includes(n.type) && n.type !== 'new_rating').length;
        // لو الصفحة مفتوحة — صفّر
        const clientPageOpen = document.getElementById('page-client-orders')?.classList.contains('active') || document.getElementById('page-unified-orders')?.classList.contains('active');
        const workerPageOpen = document.getElementById('page-worker-requests')?.classList.contains('active');
        const orderUnread = (clientPageOpen || workerPageOpen) ? 0 : notifs.filter(n => !n.read && ALL_ORDER_TYPES.includes(n.type)).length;
        updateAllBadges(chatUnread, orderUnread);
      });
    }

    function updateAllBadges(chatCount, orderCount) {
      // ===== CHAT BADGES =====
      // nav dropdown
      const navChatBadge = document.getElementById('nav-chat-badge');
      if (navChatBadge) { navChatBadge.textContent = chatCount || ''; navChatBadge.style.display = chatCount > 0 ? 'inline' : 'none'; }
      // sidebar
      const siChatBadge = document.getElementById('si-chat-badge-sb');
      if (siChatBadge) { siChatBadge.textContent = chatCount || ''; siChatBadge.className = 'si-badge' + (chatCount > 0 ? ' show' : ''); }
      // mobile — profile button (حيث الشات)
      const mbChatBadge = document.getElementById('mbnav-chat-badge');
      if (mbChatBadge) { mbChatBadge.textContent = chatCount || ''; mbChatBadge.className = 'm-badge' + (chatCount > 0 ? ' show' : ''); }

      // ===== ORDER BADGES (للعميل بس) =====
      if (currentProfile?.role === 'client') {
        // sidebar
        const siOrderBadge = document.getElementById('si-orders-badge');
        if (siOrderBadge) { siOrderBadge.textContent = orderCount || ''; siOrderBadge.className = 'si-badge' + (orderCount > 0 ? ' show' : ''); }
        // mobile
        const mbOrderBadge = document.getElementById('mbnav-orders-badge');
        if (mbOrderBadge) { mbOrderBadge.textContent = orderCount || ''; mbOrderBadge.className = 'm-badge' + (orderCount > 0 ? ' show' : ''); }
        // nav dropdown
        const navClientLink = document.getElementById('nav-client-orders-link');
        if (navClientLink) {
          let sp = navClientLink.querySelector('.client-orders-badge');
          if (!sp) { sp = document.createElement('span'); sp.className = 'client-orders-badge'; sp.style.cssText = 'background:#E74C3C;color:#fff;border-radius:50%;padding:1px 6px;font-size:11px;margin-right:4px;'; navClientLink.appendChild(sp); }
          sp.textContent = orderCount || ''; sp.style.display = orderCount > 0 ? 'inline' : 'none';
        }
      }
    }
    window.updateAllBadges = updateAllBadges;

    // مسح إشعارات الطلبات للصنايعي لما يفتح الصفحة
    const WORKER_ORDER_NOTIF_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'client_counter', 'worker_accepted', 'counter_accepted', 'admin_reply', 'worker_not_done_yet', 'client_says_done', 'new_offer', 'cm_client_says_done', 'new_order', 'worker_counter', 'cm_worker_counter'];
    async function markWorkerOrderNotifsRead() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      try {
        const snap = await get(ref(db, 'notifications/' + currentUser.uid));
        if (!snap.exists()) return;
        const updates = {};
        Object.entries(snap.val()).forEach(([key, n]) => {
          if (!n.read && WORKER_ORDER_NOTIF_TYPES.includes(n.type)) {
            updates[key + '/read'] = true;
          }
        });
        if (Object.keys(updates).length > 0) {
          await update(ref(db, 'notifications/' + currentUser.uid), updates);
        }
        // صفّر الـ badge فوراً
        const badge = document.getElementById('nav-reqs-badge');
        if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
        const siBadge = document.getElementById('si-orders-badge');
        if (siBadge) { siBadge.textContent = ''; siBadge.className = 'si-badge'; }
        const mbBadge = document.getElementById('mbnav-orders-badge');
        if (mbBadge) { mbBadge.textContent = ''; mbBadge.className = 'm-badge'; }
      } catch (e) { console.log('markWorkerOrderNotifsRead error', e); }
    }
    window.markWorkerOrderNotifsRead = markWorkerOrderNotifsRead;

    // مسح إشعارات الطلبات للعميل لما يفتح الصفحة
    const CLIENT_ORDER_NOTIF_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'client_counter', 'worker_accepted', 'counter_accepted', 'admin_reply', 'worker_not_done_yet', 'client_says_done', 'new_offer', 'cm_client_says_done', 'new_order', 'worker_counter', 'cm_worker_counter'];
    async function markClientOrderNotifsRead() {
      if (!currentUser || currentProfile?.role !== 'client') return;
      try {
        const snap = await get(ref(db, 'notifications/' + currentUser.uid));
        if (!snap.exists()) return;
        const updates = {};
        Object.entries(snap.val()).forEach(([key, n]) => {
          if (!n.read && CLIENT_ORDER_NOTIF_TYPES.includes(n.type)) {
            updates[key + '/read'] = true;
          }
        });
        if (Object.keys(updates).length > 0) {
          await update(ref(db, 'notifications/' + currentUser.uid), updates);
        }
        // صفّر الـ badge فوراً
        updateClientOrderBadge(0);
      } catch (e) { console.log('markClientOrderNotifsRead error', e); }
    }
    window.markClientOrderNotifsRead = markClientOrderNotifsRead;

    // ===== CHAT =====
    let currentChatId = null;
    let chatListener = null;
    let _chatUnreadListener = null;

    function startChatUnreadListener() {
      if (!currentUser) return;
      if (_chatUnreadListener) { try { _chatUnreadListener(); } catch (e) { } }
      _chatUnreadListener = onValue(ref(db, 'chats'), (snap) => {
        if (!snap.exists()) { updateChatBadge(0); return; }
        const allChats = snap.val();
        let unread = 0;
        Object.entries(allChats).forEach(([chatId, chatData]) => {
          if (!chatId.includes(currentUser.uid)) return;
          if (!chatData.messages) return;
          Object.values(chatData.messages).forEach(m => {
            if (m.sender !== currentUser.uid && !m.read) unread++;
          });
        });
        updateChatBadge(unread);
      });
    }
    window.startChatUnreadListener = startChatUnreadListener;

    function updateChatBadge(count) {
      const navChatBadge = document.getElementById('nav-chat-badge');
      if (navChatBadge) { navChatBadge.textContent = count || ''; navChatBadge.style.display = count > 0 ? 'inline' : 'none'; }
      const siChatBadge = document.getElementById('si-chat-badge-sb');
      if (siChatBadge) { siChatBadge.textContent = count || ''; siChatBadge.className = 'si-badge' + (count > 0 ? ' show' : ''); }
      const mbChatBadge = document.getElementById('mbnav-chat-badge');
      if (mbChatBadge) { mbChatBadge.textContent = count || ''; mbChatBadge.className = 'm-badge' + (count > 0 ? ' show' : ''); }
    }
    window.updateChatBadge = updateChatBadge;

    function getChatId(uid1, uid2) {
      return [uid1, uid2].sort().join('_');
    }

    async function loadChatList() {
      if (!currentUser) return;
      const list = document.getElementById('chat-list');
      if (!list) return;
      list.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:2rem;">جاري التحميل...</p>';
      const snap = await get(ref(db, 'chats'));
      if (!snap.exists()) {
        list.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:2rem;">مفيش محادثات لحد دلوقتي</p>';
        return;
      }
      const allChats = snap.val();
      const myChats = Object.entries(allChats).filter(([id]) => id.includes(currentUser.uid));
      if (!myChats.length) {
        list.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:2rem;">مفيش محادثات لحد دلوقتي</p>';
        return;
      }
      list.innerHTML = '';
      for (const [chatId, chatData] of myChats) {
        const parts = chatId.split('_');
        const partnerId = parts.find(id => id !== currentUser.uid);
        if (!partnerId) continue;
        const pSnap = await get(ref(db, 'profiles/' + partnerId));
        const partner = pSnap.exists() ? pSnap.val() : { full_name: 'مستخدم', role: 'client' };
        const msgs = chatData.messages ? Object.values(chatData.messages) : [];
        const lastMsg = msgs.length ? msgs.sort((a, b) => (a.ts || a.timestamp || 0) - (b.ts || b.timestamp || 0))[msgs.length - 1] : null;
        const unread = msgs.filter(m => (m.sender || m.from) !== currentUser.uid && !m.read).length;
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `
      <div class="chat-avatar">${partner.role === 'worker' ? '🔧' : '👤'}</div>
      <div class="chat-info">
        <div class="chat-name">${partner.full_name || 'مستخدم'}</div>
        <div class="chat-last">${lastMsg ? (lastMsg.image ? '📷 صورة' : lastMsg.text) : 'ابدأ المحادثة'}</div>
      </div>
      ${unread > 0 ? `<div class="chat-unread">${unread}</div>` : ''}
    `;
        div.onclick = () => openChat(partnerId, partner);
        list.appendChild(div);
      }
    }

    async function openChat(partnerId, partner) {
      currentChatId = getChatId(currentUser.uid, partnerId);
      document.getElementById('chat-partner-name').textContent = partner.full_name || 'مستخدم';
      document.getElementById('chat-partner-role').textContent = partner.role === 'worker' ? '🔧 صنايعي' : '👤 عميل';
      document.getElementById('chat-partner-avatar').textContent = partner.role === 'worker' ? '🔧' : '👤';
      document.getElementById('chat-list-view').style.display = 'none';
      document.getElementById('chat-window-view').style.display = 'block';

      if (chatListener) { chatListener(); chatListener = null; }

      chatListener = onValue(ref(db, 'chats/' + currentChatId + '/messages'), (snap) => {
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        if (!snap.exists()) return;

        const raw = snap.val();
        // دعم حقل sender و from على حد سواء
        const msgs = Object.values(raw).sort((a, b) => (a.ts || a.timestamp || 0) - (b.ts || b.timestamp || 0));

        // mark unread messages as read
        const updates = {};
        Object.entries(raw).forEach(([key, m]) => {
          const msgSender = m.sender || m.from;
          if (msgSender !== currentUser.uid && !m.read) updates[key + '/read'] = true;
        });
        if (Object.keys(updates).length) {
          update(ref(db, 'chats/' + currentChatId + '/messages'), updates).catch(() => { });
        }

        msgs.forEach(m => {
          const msgSender = m.sender || m.from;
          const msgTime = m.ts || m.timestamp || Date.now();
          const isMine = msgSender === currentUser.uid;
          const div = document.createElement('div');
          div.className = 'msg ' + (isMine ? 'sent' : 'received');
          const readMark = isMine ? `<div class="msg-status ${m.read ? 'read' : ''}">${m.read ? '✓✓' : '✓'}</div>` : '';
          const timeStr = new Date(msgTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
          if (m.image) {
            div.innerHTML = `<img src="${m.image}" class="chat-img" onclick="openLightbox(this.src)"><div class="msg-time">${timeStr}</div>${readMark}`;
          } else {
            div.innerHTML = `<span style="white-space:pre-line;">${m.text || ''}</span><div class="msg-time">${timeStr}</div>${readMark}`;
          }
          container.appendChild(div);
        });

        container.scrollTop = container.scrollHeight;
      });
    }

    async function startChatWithWorker(workerId, workerName, workerRole) {
      // الشات بيفتح بس من جوا الطلب المقبول
      alert('التواصل متاح بس بعد قبول الطلب 💬');
    }
    window.startChatWithWorker = startChatWithWorker;

    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text || !currentChatId) return;
      input.value = '';
      await push(ref(db, 'chats/' + currentChatId + '/messages'), {
        text, sender: currentUser.uid,
        ts: Date.now(), read: false
      });
    }
    window.sendMessage = sendMessage;

    // إرسال صورة في الشات
    async function sendChatImage(input) {
      if (!input.files[0] || !currentChatId) return;
      const reader = new FileReader();
      reader.onload = async e => {
        await push(ref(db, 'chats/' + currentChatId + '/messages'), {
          image: e.target.result, text: '', sender: currentUser.uid,
          ts: Date.now(), read: false
        });
      };
      reader.readAsDataURL(input.files[0]);
      input.value = '';
    }
    window.sendChatImage = sendChatImage;

    // مؤشر "يكتب..."
    let _typingTimeout = null;
    function onChatInput() { }
    window.onChatInput = onChatInput;

    function scrollChatDown() {
      const container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }
    window.scrollChatDown = scrollChatDown;

    function showChatList() {
      document.getElementById('chat-list-view').style.display = 'block';
      document.getElementById('chat-window-view').style.display = 'none';
      loadChatList();
    }
    window.showChatList = showChatList;


    // ===== IMAGE PREVIEW =====
    window._reqImages = [];
    function previewImages(input) {
      const files = Array.from(input.files).slice(0, 3);
      window._reqImages = files;
      const preview = document.getElementById('img-preview');
      preview.innerHTML = '';
      files.forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = e => {
          const div = document.createElement('div');
          div.style.cssText = 'position:relative;width:80px;height:80px;';
          div.innerHTML = `<img src="${e.target.result}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:2px solid rgba(200,135,58,0.4);">
        <button onclick="removeImage(${i})" style="position:absolute;top:-6px;right:-6px;background:#E74C3C;border:none;border-radius:50%;width:20px;height:20px;color:#fff;font-size:12px;cursor:pointer;">✕</button>`;
          preview.appendChild(div);
        };
        reader.readAsDataURL(file);
      });
    }
    window.previewImages = previewImages;

    function removeImage(i) {
      window._reqImages.splice(i, 1);
      const dt = new DataTransfer();
      window._reqImages.forEach(f => dt.items.add(f));
      document.getElementById('req-images').files = dt.files;
      previewImages(document.getElementById('req-images'));
    }
    window.removeImage = removeImage;

    async function imagesToBase64(files) {
      return Promise.all(files.map(file => new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(file);
      })));
    }

    // ===== WORKER REQUESTS PAGE =====
    let allWorkerReqs = [];
    let currentReqFilter = 'all';

    async function loadWorkerRequests() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      const snap = await get(ref(db, 'service_requests'));
      if (!snap.exists()) { allWorkerReqs = []; renderWorkerReqs(); return; }
      allWorkerReqs = Object.values(snap.val())
        .filter(o => o.worker_id === currentUser.uid)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      renderWorkerReqs();
      // صفّر الـ badge لو الصفحة مفتوحة، وإلا عدّ الـ statuses المهمة
      const urgentStatuses = ['pending', 'client_counter', 'client_initiated_done'];
      const isPageOpen = document.getElementById('page-worker-requests')?.classList.contains('active');
      const newCount = isPageOpen ? 0 : allWorkerReqs.filter(o => urgentStatuses.includes(o.status)).length;
      const badge = document.getElementById('nav-reqs-badge');
      if (badge) { badge.textContent = newCount || ''; badge.style.display = newCount > 0 ? 'inline' : 'none'; }
    }
    window.loadWorkerRequests = loadWorkerRequests;

    function filterWorkerReqs(status) {
      currentReqFilter = status;
      document.querySelectorAll('[id^="wreq-tab-"]').forEach(b => b.classList.remove('active'));
      const tab = document.getElementById('wreq-tab-' + status);
      if (tab) tab.classList.add('active');
      renderWorkerReqs();
    }
    window.filterWorkerReqs = filterWorkerReqs;

    function renderWorkerReqs() {
      const list = document.getElementById('worker-reqs-list');
      if (!list) return;
      const filtered = currentReqFilter === 'all' ? allWorkerReqs : allWorkerReqs.filter(o => o.status === currentReqFilter);
      if (!filtered.length) { list.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">لا توجد طلبات</p>'; return; }

      // ترتيب حسب الأولوية: الأهم أولاً
      const priorityOrder = { client_counter: 0, pending: 1, accepted: 2, worker_done_pending: 3, price_offered: 4, done: 5, cancelled: 6 };
      const sorted = [...filtered].sort((a, b) => {
        const pa = priorityOrder[a.status] ?? 9;
        const pb = priorityOrder[b.status] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      // شريط ملخص سريع
      const counts = { client_counter: 0, pending: 0, accepted: 0, worker_done_pending: 0, done: 0, cancelled: 0 };
      filtered.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
      const urgentCount = counts.client_counter + counts.pending;
      const summaryBar = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;">
        ${urgentCount > 0 ? `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.3);border-radius:20px;">
          <span style="width:7px;height:7px;background:#E74C3C;border-radius:50%;display:inline-block;animation:pulse-dot 1.2s infinite;"></span>
          <span style="font-size:12px;font-weight:800;color:#E74C3C;">${urgentCount} يحتاج ردك</span>
        </div>` : ''}
        ${counts.accepted > 0 ? `<div style="padding:4px 10px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.25);border-radius:20px;font-size:12px;font-weight:700;color:#2ECC71;">${counts.accepted} جاري</div>` : ''}
        ${counts.worker_done_pending > 0 ? `<div style="padding:4px 10px;background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.3);border-radius:20px;font-size:12px;font-weight:700;color:#C8873A;">${counts.worker_done_pending} بانتظار تأكيد</div>` : ''}
        ${counts.done > 0 ? `<div style="padding:4px 10px;background:rgba(39,174,96,0.08);border:1px solid rgba(39,174,96,0.2);border-radius:20px;font-size:12px;font-weight:700;color:#27AE60;">${counts.done} منجز</div>` : ''}
        <div style="margin-right:auto;font-size:12px;color:rgba(255,255,255,0.3);align-self:center;">${filtered.length} طلب إجمالي</div>
      </div>
      <style>@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:0.3}}</style>`;

      const statusColors = { pending: '#F39C12', price_offered: '#9B59B6', client_counter: '#E67E22', worker_counter: '#3498DB', accepted: '#2ECC71', worker_done_pending: '#C8873A', client_initiated_done: '#2ECC71', done: '#27AE60', cancelled: '#E74C3C' };
      const statusTxt = { pending: '⏳ جديد', price_offered: '💰 عرض سعر', client_counter: '🤝 عرض مضاد', worker_counter: '↩️ رددت بسعر', accepted: '✓ مقبول', worker_done_pending: '⏳ بانتظار العميل', client_initiated_done: '🏁 العميل قال خلص — أكّد؟', done: '✓ منجز', cancelled: '✗ ملغي' };
      const statusBorderHighlight = { client_counter: 'rgba(230,126,34,0.5)', worker_counter: 'rgba(52,152,219,0.4)', pending: 'rgba(243,156,18,0.4)', accepted: 'rgba(46,204,113,0.3)', worker_done_pending: 'rgba(200,135,58,0.4)', price_offered: 'rgba(155,89,182,0.3)', done: 'rgba(39,174,96,0.2)', cancelled: 'rgba(231,76,60,0.2)' };
      const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️' };

      const cards = sorted.map(o => {
        const color = statusColors[o.status] || '#F39C12';
        const txt = statusTxt[o.status] || '⏳ جديد';
        const borderColor = statusBorderHighlight[o.status] || 'rgba(255,255,255,0.08)';
        const icon = Object.entries(emojiMap).find(([k]) => o.service_type?.includes(k))?.[1] || '🔧';
        const hasImgs = o.images && o.images.length > 0;
        const isUrgent = ['client_counter', 'pending'].includes(o.status);
        const timeAgo = (() => {
          const diff = Date.now() - new Date(o.created_at).getTime();
          const h = Math.floor(diff / 3600000);
          const d = Math.floor(diff / 86400000);
          if (d > 0) return `منذ ${d} يوم`;
          if (h > 0) return `منذ ${h} ساعة`;
          return 'منذ قليل';
        })();
        return `<div onclick="openRequestDetail('${o.order_number}')" style="background:rgba(255,255,255,0.04);border:1.5px solid ${borderColor};border-radius:14px;padding:16px;cursor:pointer;transition:all 0.2s;${isUrgent ? 'box-shadow:0 0 0 1px ' + color + '22;' : ''}" onmouseover="this.style.borderColor='rgba(200,135,58,0.55)'" onmouseout="this.style.borderColor='${borderColor}'">
      ${isUrgent ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding:6px 10px;background:rgba(200,135,58,0.08);border-radius:8px;border-right:3px solid ${color};">
        <span style="font-size:11px;font-weight:800;color:${color};">🔔 يحتاج ردك الآن</span>
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;">${o.service_type || 'خدمة'}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:2px;">👤 ${o.client_name || '-'} · 📞 ${o.client_phone || '-'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);">📍 ${o.area || o.address || '-'} &nbsp;·&nbsp; ${timeAgo}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
          <span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;">${txt}</span>
          ${hasImgs ? `<span style="font-size:10px;color:rgba(255,255,255,0.35);">📷 ${o.images.length} صورة</span>` : ''}
        </div>
      </div>
      ${o.status === 'client_counter' ? `
      <div style="margin-top:10px;background:rgba(230,126,34,0.1);border:2px solid rgba(230,126,34,0.45);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:12px;color:rgba(255,255,255,0.5);">🤝 العميل بيفاصل بـ</span>
          <span style="font-size:20px;font-weight:900;color:#E67E22;">${o.client_counter_price} جنيه</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="event.stopPropagation();workerAcceptCounter('${o.order_number}')" style="flex:1;padding:9px 4px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:12px;font-weight:800;cursor:pointer;">✓ قبول ${o.client_counter_price} ج</button>
          <button onclick="event.stopPropagation();openWorkerCounterModal('${o.order_number}',${o.client_counter_price})" style="flex:1;padding:9px 4px;background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);border-radius:8px;color:#3498DB;font-family:Cairo,sans-serif;font-size:12px;font-weight:800;cursor:pointer;">↩️ فاصل</button>
          <button onclick="event.stopPropagation();updateOrderStatus('${o.order_number}','cancelled');showPage('worker-requests')" style="flex:1;padding:9px 4px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:12px;font-weight:800;cursor:pointer;">✗ رفض</button>
        </div>
      </div>` : ''}
      ${o.status === 'price_offered' ? `
      <div style="margin-top:10px;padding:9px 14px;background:rgba(155,89,182,0.1);border:1px solid rgba(155,89,182,0.3);border-radius:10px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:12px;color:rgba(255,255,255,0.4);">عرض سعرك</span>
        <span style="font-size:18px;font-weight:900;color:#9B59B6;">${o.offered_price} جنيه</span>
      </div>` : ''}
      ${o.status === 'worker_done_pending' ? `
      <div style="margin-top:10px;padding:9px 14px;background:rgba(241,196,15,0.08);border:1px solid rgba(241,196,15,0.3);border-radius:9px;color:#F1C40F;font-size:12px;font-weight:700;text-align:center;">⏳ في انتظار تأكيد العميل...</div>` : ''}
      ${o.status === 'client_initiated_done' ? `
      <div style="margin-top:10px;background:rgba(46,204,113,0.08);border:2px solid rgba(46,204,113,0.4);border-radius:10px;padding:12px;">
        <p style="color:#2ECC71;font-size:12px;font-weight:800;margin-bottom:9px;text-align:center;">🏁 العميل قال إن الشغل خلص — هل فعلاً خلّصت؟</p>
        <div style="display:flex;gap:7px;">
          <button onclick="event.stopPropagation();workerConfirmClientDone('${o.order_number}')" style="flex:1;padding:8px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:12px;font-weight:800;cursor:pointer;">✅ أيوه، خلّصت</button>
          <button onclick="event.stopPropagation();workerDenyClientDone('${o.order_number}')" style="flex:1;padding:8px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.4);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:12px;font-weight:800;cursor:pointer;">❌ لأ، لسه</button>
        </div>
      </div>` : ''}
      ${o.status === 'done' ? `
      <div style="margin-top:10px;padding:10px 14px;background:rgba(46,204,113,0.1);border:1px solid rgba(46,204,113,0.35);border-radius:9px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">🎉</span>
        <div>
          <div style="color:#2ECC71;font-size:12px;font-weight:800;">العميل أكد إن الشغل اتنجز!</div>
          <div style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:1px;">تم إغلاق الطلب ✓</div>
        </div>
      </div>` : ''}
      ${o.status === 'done' && !o.worker_rated ? `
      <button onclick="event.stopPropagation();openRatingModal('worker_rates_client','${o.order_number}')" style="width:100%;margin-top:10px;padding:8px;background:rgba(200,135,58,0.1);border:1px solid rgba(200,135,58,0.35);border-radius:9px;color:#C8873A;font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
        ⭐ قيّم العميل
      </button>` : ''}
      ${o.status === 'done' && o.worker_rated ? `
      <div style="margin-top:8px;padding:6px;text-align:center;color:rgba(255,255,255,0.25);font-size:11px;font-family:Cairo,sans-serif;">✓ تم تقييم العميل</div>` : ''}
    </div>`;
      }).join('');

      list.innerHTML = summaryBar + cards;
    }

    // ===== REALTIME LISTENER FOR REQUEST DETAIL PAGE =====
    let _requestDetailUnsub = null;
    function _stopRequestDetailListener() {
      if (_requestDetailUnsub) { try { _requestDetailUnsub(); } catch (e) { } _requestDetailUnsub = null; }
    }
    function _renderRequestDetail(o) {
      const statusColors = { pending: '#F39C12', price_offered: '#9B59B6', accepted: '#2ECC71', worker_done_pending: '#C8873A', done: '#27AE60', cancelled: '#E74C3C' };
      const statusTxt = { pending: '⏳ جديد', price_offered: '💰 عرض سعر', client_counter: '🤝 العميل فاصل', accepted: '✓ مقبول', worker_done_pending: '⏳ بانتظار العميل', done: '✓ منجز', cancelled: '✗ ملغي' };
      const color = statusColors[o.status] || '#F39C12';
      const txt = statusTxt[o.status] || '⏳ جديد';
      const content = document.getElementById('req-detail-content');
      content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h3 style="color:#C8873A;font-size:18px;">${o.service_type || 'خدمة'}</h3>
      <span style="color:${color};background:rgba(255,255,255,0.06);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;">${txt}</span>
    </div>
    <div style="display:grid;gap:12px;margin-bottom:20px;">
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">📋 رقم الطلب</div>
        <div style="font-size:14px;font-weight:700;color:#fff;">${o.order_number}</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">👤 العميل</div>
        <div style="font-size:14px;font-weight:700;color:#fff;">${o.client_name || '-'}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:2px;">📞 ${o.client_phone || '-'}</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">📍 العنوان</div>
        <div style="font-size:14px;color:#fff;">${o.address || '-'} ${o.area ? '- ' + o.area : ''}</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">🕐 الوقت المفضل</div>
        <div style="font-size:14px;color:#fff;">${o.preferred_time || '-'}</div>
      </div>
      ${o.description ? `<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;">📝 وصف المشكلة</div>
        <div style="font-size:14px;color:#fff;line-height:1.7;">${o.description}</div>
      </div>` : ''}
      ${o.images && o.images.length ? `<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:10px;">📷 صور المشكلة</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${o.images.map(img => `<img src="${img}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;border:2px solid rgba(200,135,58,0.3);cursor:zoom-in;" onclick="openLightbox(this.src)">`).join('')}</div>
      </div>` : ''}
    </div>
    ${o.status === 'pending' && currentProfile?.role === 'worker' ? `<div style="display:flex;gap:10px;">
      <button onclick="openPriceOfferModal('${o.order_number}')" style="flex:1;padding:12px;background:rgba(46,204,113,0.15);border:1px solid rgba(46,204,113,0.4);border-radius:10px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">✓ قبول وتحديد السعر</button>
      <button onclick="updateOrderStatus('${o.order_number}','cancelled');showPage('worker-requests')" style="flex:1;padding:12px;background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.4);border-radius:10px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">✗ رفض</button>
    </div>` : ''}
    ${o.status === 'price_offered' ? `<div style="padding:14px;background:rgba(155,89,182,0.1);border:1px solid rgba(155,89,182,0.35);border-radius:10px;display:flex;flex-direction:column;gap:8px;align-items:center;">
      <div style="font-size:22px;font-weight:900;color:#9B59B6;">💰 ${o.offered_price} جنيه</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);">⏳ بانتظار رد العميل...</div>
    </div>` : ''}
    ${o.status === 'client_counter' && currentProfile?.role === 'worker' ? `<div style="background:rgba(230,126,34,0.1);border:2px solid rgba(230,126,34,0.45);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;">
      <div style="text-align:center;">
        <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:4px;">🤝 العميل فاصل — عرضه المضاد</div>
        <div style="font-size:28px;font-weight:900;color:#E67E22;">${o.client_counter_price} <span style="font-size:14px;">جنيه</span></div>
        ${o.client_counter_note ? `<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:4px;">📝 ${o.client_counter_note}</div>` : ''}
        <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:6px;">سعرك الأصلي كان: ${o.offered_price} جنيه</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="workerAcceptCounter('${o.order_number}')" style="flex:1;padding:11px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:9px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">✓ قبول ${o.client_counter_price} جنيه</button>
        <button onclick="openWorkerCounterModal('${o.order_number}',${o.client_counter_price})" style="flex:1;padding:11px;background:rgba(52,152,219,0.15);border:1px solid rgba(52,152,219,0.4);border-radius:9px;color:#3498DB;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;">↩️ فاصل بسعر تاني</button>
      </div>
    </div>` : ''}
    ${o.status === 'worker_counter' && currentProfile?.role === 'worker' ? `<div style="background:rgba(52,152,219,0.08);border:2px solid rgba(52,152,219,0.35);border-radius:12px;padding:14px;text-align:center;">
      <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:6px;">↩️ بعتلهم سعرك المضاد</div>
      <div style="font-size:26px;font-weight:900;color:#3498DB;">${o.worker_counter_price} <span style="font-size:14px;">جنيه</span></div>
      <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;">⏳ في انتظار رد العميل...</div>
    </div>` : ''}
    ${o.status === 'accepted' && currentProfile?.role === 'worker' ? `<div style="display:flex;flex-direction:column;gap:10px;">
      <button onclick="updateOrderStatus('${o.order_number}','worker_done_pending');openRequestDetail('${o.order_number}')" style="width:100%;padding:12px;background:rgba(200,135,58,0.2);border:1px solid rgba(200,135,58,0.4);border-radius:10px;color:#C8873A;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">✓ تم التنفيذ — أبلّغ العميل</button>
      ${o.user_id ? `<button onclick="openChatWithUser('${o.user_id}','${(o.client_name || '').replace(/'/g, '')}','client')" style="width:100%;padding:12px;background:rgba(26,82,118,0.2);border:1px solid rgba(26,82,118,0.5);border-radius:10px;color:#5DADE2;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">💬 تكلم مع العميل</button>` : ''}
    </div>` : ''}
    ${o.status === 'worker_done_pending' ? `<div style="display:flex;flex-direction:column;gap:10px;">
      <div style="padding:14px;background:rgba(241,196,15,0.1);border:1px solid rgba(241,196,15,0.35);border-radius:10px;text-align:center;color:#F1C40F;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;">⏳ في انتظار تأكيد العميل...</div>
      ${o.user_id ? `<button onclick="openChatWithUser('${o.user_id}','${(o.client_name || '').replace(/'/g, '')}','client')" style="width:100%;padding:12px;background:rgba(26,82,118,0.2);border:1px solid rgba(26,82,118,0.5);border-radius:10px;color:#5DADE2;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">💬 تكلم مع العميل</button>` : ''}
    </div>` : ''}
    ${o.status === 'client_initiated_done' ? `<div style="display:flex;flex-direction:column;gap:10px;">
      <div style="padding:14px;background:rgba(46,204,113,0.1);border:2px solid rgba(46,204,113,0.45);border-radius:10px;">
        <div style="color:#2ECC71;font-family:Cairo,sans-serif;font-size:14px;font-weight:800;text-align:center;margin-bottom:12px;">🏁 العميل قال إن الشغل خلص — هل فعلاً خلّصت؟</div>
        <div style="display:flex;gap:8px;">
          <button onclick="workerConfirmClientDone('${o.order_number}')" style="flex:1;padding:12px;background:rgba(46,204,113,0.18);border:1px solid rgba(46,204,113,0.5);border-radius:10px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:14px;font-weight:800;cursor:pointer;">✅ أيوه، خلّصت</button>
          <button onclick="workerDenyClientDone('${o.order_number}')" style="flex:1;padding:12px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.4);border-radius:10px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:14px;font-weight:800;cursor:pointer;">❌ لأ، لسه</button>
        </div>
      </div>
      ${o.user_id ? `<button onclick="openChatWithUser('${o.user_id}','${(o.client_name || '').replace(/'/g, '')}','client')" style="width:100%;padding:12px;background:rgba(26,82,118,0.2);border:1px solid rgba(26,82,118,0.5);border-radius:10px;color:#5DADE2;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">💬 تكلم مع العميل</button>` : ''}
    </div>` : ''}
    ${o.status === 'done' ? `<div style="display:flex;flex-direction:column;gap:10px;">
      <div style="padding:14px;background:rgba(46,204,113,0.13);border:1px solid rgba(46,204,113,0.45);border-radius:10px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:26px;">🎉</span>
        <div>
          <div style="color:#2ECC71;font-family:Cairo,sans-serif;font-size:14px;font-weight:800;">العميل أكد إن الشغل اتنجز!</div>
          <div style="color:rgba(255,255,255,0.45);font-family:Cairo,sans-serif;font-size:12px;margin-top:3px;">تم إغلاق الطلب بنجاح ✓</div>
        </div>
      </div>
      ${o.status === 'done' && !o.worker_rated ? `<button onclick="openRatingModal('worker_rates_client','${o.order_number}')" style="width:100%;padding:12px;background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.4);border-radius:10px;color:#C8873A;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer;">⭐ قيّم العميل</button>` : '<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:13px;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;">✓ تم تقييم العميل بالفعل</div>'}
    </div>` : ''}
  `;
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-request-detail').classList.add('active');
      window.scrollTo(0, 0);
    }

    function openRequestDetail(orderNum) {
      // لو العميل وصل هنا بالغلط، وجّهه للمودال الصح بتاعه
      if (currentProfile?.role === 'client') {
        openClientOrderDetail(orderNum);
        return;
      }
      _stopRequestDetailListener();
      _requestDetailUnsub = onValue(ref(db, 'service_requests/' + orderNum), (snap) => {
        if (!snap.exists()) return;
        _renderRequestDetail(snap.val());
      });
    }
    window.openRequestDetail = openRequestDetail;

    function loadHomeStats() {
      // real-time listener للصنايعية — بيتحدث فور ما حد جديد يسجّل
      onValue(ref(db, 'craftsmen'), async (snap) => {
        try {
          if (snap.exists()) {
            const allList = Object.entries(snap.val());
            // جيب المحافظ عشان نعد بس اللي رصيده 50+ أو معملوش طلبات
            let wallets = {};
            try {
              const wSnap = await get(ref(db, 'wallets'));
              if (wSnap.exists()) wallets = wSnap.val();
            } catch (e) {}
            const list = allList
              .filter(([uid, c]) => {
                if (!c.available) return false;
                const bal = wallets[uid]?.balance ?? 0;
                if (bal >= 50) return true;
                const completed = wallets[uid]?.completed_orders ?? 0;
                return completed === 0; // أول طلب مجاناً — يظهر دايماً لو معملش طلبات
              })
              .map(([, c]) => c);
            if (document.getElementById('stat-craftsmen')) document.getElementById('stat-craftsmen').textContent = list.length;
            // حدّث كل الكاردز الموجودة في الـ DOM ديناميكياً (ثابتة + مخصصة)
            document.querySelectorAll('[id^="count-"]').forEach(el => {
              const trade = el.id.replace('count-', '');
              el.textContent = list.filter(c => c.trade?.includes(trade)).length + ' صنايعي';
            });
            const ratings = list.filter(c => c.rating).map(c => c.rating);
            if (ratings.length && document.getElementById('stat-rating')) {
              document.getElementById('stat-rating').textContent = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) + '⭐';
            }
          }
        } catch (e) { console.log('stats craftsmen error', e); }
      });
      // real-time listener للطلبات المنجزة
      onValue(ref(db, 'service_requests'), (reqSnap) => {
        try {
          if (reqSnap.exists()) {
            const reqs = Object.values(reqSnap.val());
            if (document.getElementById('stat-requests')) document.getElementById('stat-requests').textContent = reqs.filter(r => r.status === 'done').length;
          }
        } catch (e) { console.log('stats requests error', e); }
      });
    }

    // ===== CRAFTSMEN =====
    let craftsmen = [];
    async function loadCraftsmen() {
      try {
        const [cSnap, pSnap, wSnap] = await Promise.all([
          get(ref(db, 'craftsmen')),
          get(ref(db, 'profiles')),
          get(ref(db, 'wallets'))
        ]);
        craftsmen = [];
        if (cSnap.exists()) {
          const profiles = pSnap.exists() ? pSnap.val() : {};
          const wallets  = wSnap.exists()  ? wSnap.val()  : {};
          craftsmen = Object.entries(cSnap.val()).map(([id, c]) => {
            const p = profiles[id] || {};
            const w = wallets[id]  || {};
            return {
              id,
              user_id: id,
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
              wallet_balance: typeof w.balance === 'number' ? w.balance : null,
              completed_orders: w.completed_orders ?? 0
            };
          });
        }
        filterCards();
      } catch (e) { craftsmen = []; filterCards(); }
    }
    window.loadCraftsmen = loadCraftsmen;

    // ===== RENDER CRAFTSMEN =====
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
        if (!c.available) return false; // مش ظاهر لو مش متاح
        if ((c.wallet_balance ?? 0) < 50 && (c.completed_orders ?? 0) > 0) return false; // مخفي لو رصيده أقل من 50 ج وعنده طلبات سابقة
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
              // normalize: profile-client / profile-worker كلهم بيعتبروا 'profile'
              const normalizedName = name.startsWith('profile') ? (name === 'profile-worker' ? 'profile-worker' : 'profile-client') : name;
              if (!allowedPages.includes(normalizedName) && name !== 'auth') {
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
      if (name === 'profile-worker') { loadCurrentProfile(); setTimeout(loadSavedAvatars, 100); startRealtimeForWorkerProfile(); }
      window.scrollTo(0, 0);
    }
    window.showPage = showPage;

    // ========== ADMIN DASHBOARD ==========
    const OWNER_EMAIL = 'malaksameh350@gmail.com'; // ← غيّر الإيميل ده لإيميلك
    const OWNER_UID_KEY = 'admin_owner_uid';

    function isOwner() {
      if (!currentUser) return false;
      return currentUser.email === OWNER_EMAIL ||
        localStorage.getItem(OWNER_UID_KEY) === currentUser.uid;
    }

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
        // جيب craftsmen snapshot
        const craftsSnap = await get(ref(db, 'craftsmen'));
        const craftsmen = craftsSnap.exists() ? craftsSnap.val() : {};
        _adminData.workers = Object.entries(profiles)
          .filter(([, p]) => p.role === 'worker')
          .map(([uid, p]) => ({ ...p, uid, craftsmanData: craftsmen[uid] || {} }));
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
        // شغّل الـ listeners بعد التحميل الأول
        startAdminRealtimeListeners();
        startAdminMarketListener();
      } catch (e) { console.error('admin load error', e); }
    }

    function adminTab(tab) {
      document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      const btn = document.getElementById('atab-' + tab);
      if (btn) btn.classList.add('active');
      const sec = document.getElementById('asec-' + tab);
      if (sec) sec.classList.add('active');
      if (tab === 'permissions') loadPermissionsTab();
      if (tab === 'market') adminRenderMarket();
    }
    window.adminTab = adminTab;

    function renderAdminOverview() {
      const { workers, clients, orders, ratings } = _adminData;
      const avail = workers.filter(w => w.craftsmanData?.available).length;
      const done = orders.filter(o => o.status === 'done').length;
      const cancelled = orders.filter(o => o.status === 'cancelled').length;
      const pending = orders.filter(o => ['pending', 'price_offered', 'client_counter'].includes(o.status)).length;
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
      orders.forEach(o => { if (statuses[o.status] !== undefined) statuses[o.status]++; });
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
      if (!list.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">لا يوجد صنايعية</td></tr>'; return; }
      const workerOrders = {};
      _adminData.orders.forEach(o => { if (o.worker_id) workerOrders[o.worker_id] = (workerOrders[o.worker_id] || 0) + 1; });
      tbody.innerHTML = list.map((w, i) => `
    <tr>
      <td style="color:rgba(255,255,255,0.3);font-size:11px;">${i + 1}</td>
      <td><strong>${w.full_name || '-'}</strong><br><span style="font-size:11px;color:rgba(255,255,255,0.35);">${w.email || ''}</span></td>
      <td><span style="background:rgba(200,135,58,0.1);color:#C8873A;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:700;">${w.trade || w.craftsmanData?.trade || '-'}</span></td>
      <td>${w.area || '-'}</td>
      <td style="direction:ltr;text-align:right;">${w.phone || '-'}</td>
      <td><span style="color:#C8873A;">★</span> ${w.craftsmanData?.avg_rating || '-'} <span style="font-size:11px;color:rgba(255,255,255,0.3);">(${w.craftsmanData?.rating_count || 0})</span></td>
      <td>${w.craftsmanData?.available ? '<span class="badge badge-active">● متاح</span>' : '<span class="badge badge-inactive">● غير متاح</span>'}</td>
      <td style="text-align:center;"><span style="background:rgba(255,255,255,0.06);padding:2px 10px;border-radius:6px;font-size:13px;font-weight:700;">${workerOrders[w.uid] || 0}</span></td>
      <td style="font-size:11px;color:rgba(255,255,255,0.35);">${w.created_at ? new Date(w.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        ${w.craftsmanData?.available
          ? `<button class="admin-btn admin-btn-warn" onclick="adminToggleWorker('${w.uid}', false)">⏸ إيقاف</button>`
          : `<button class="admin-btn admin-btn-success" onclick="adminToggleWorker('${w.uid}', true)">▶ تفعيل</button>`}
        <button class="admin-btn" onclick="adminOpenWallet('${w.uid}','${(w.full_name || '').replace(/'/g, '')}')" style="background:rgba(200,135,58,0.15);border:1px solid rgba(200,135,58,0.4);color:#C8873A;">💳 محفظة</button>
        <button class="admin-btn admin-btn-danger" onclick="adminDeleteUser('${w.uid}', 'worker', '${(w.full_name || '').replace(/'/g, '')}')">🗑 حذف</button>
        <button class="admin-btn" onclick="adminBlockUser('${w.uid}','${(w.full_name || '').replace(/'/g, '')}','${w.email || ''}')" style="background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.35);color:#E74C3C;">🚫 بلوك</button>
      </td>
    </tr>`).join('');
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
      <td style="direction:ltr;text-align:right;">${c.phone || '-'}</td>
      <td>${c.area || '-'}</td>
      <td style="text-align:center;"><span style="background:rgba(255,255,255,0.06);padding:2px 10px;border-radius:6px;font-size:13px;font-weight:700;">${clientOrders[c.uid] || 0}</span></td>
      <td style="font-size:11px;color:rgba(255,255,255,0.4);">${clientLastOrder[c.uid] ? new Date(clientLastOrder[c.uid]).toLocaleDateString('ar-EG') : '-'}</td>
      <td style="font-size:12px;color:rgba(255,255,255,0.4);">${c.created_at ? new Date(c.created_at).toLocaleDateString('ar-EG') : '-'}</td>
      <td><button class="admin-btn admin-btn-danger" onclick="adminDeleteUser('${c.uid}', 'client', '${(c.full_name || '').replace(/'/g, '')}')">🗑 حذف</button>
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
      setText2('adm-ord-mini-pending', allOrders.filter(o => ['pending', 'price_offered', 'client_counter'].includes(o.status)).length);
      setText2('adm-ord-mini-accepted', allOrders.filter(o => ['accepted', 'worker_done_pending'].includes(o.status)).length);
      setText2('adm-ord-mini-done', allOrders.filter(o => o.status === 'done').length);
      setText2('adm-ord-mini-cancelled', allOrders.filter(o => o.status === 'cancelled').length);
      const totalRevenue = allOrders.filter(o => o.status === 'done').reduce((acc, o) => acc + (parseFloat(o.offered_price || o.client_counter_price || 0)), 0);
      setText2('adm-ord-mini-revenue', totalRevenue > 0 ? totalRevenue.toLocaleString('ar-EG') + ' ج' : '-');
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
      <td><button class="admin-btn admin-btn-danger" onclick="adminDeleteOrder('${o._key}')">🗑</button></td>
    </tr>`).join('');
    }

    function renderAdminRatings(filterStars) {
      const el = document.getElementById('adm-ratings-list');
      const summaryEl = document.getElementById('adm-ratings-summary');
      if (!el) return;
      // Render summary bar
      if (summaryEl && !filterStars) {
        const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        _adminData.ratings.forEach(r => { if (r.stars >= 1 && r.stars <= 5) dist[r.stars]++; });
        const maxD = Math.max(...Object.values(dist), 1);
        summaryEl.innerHTML = `<div style="font-size:13px;font-weight:800;color:rgba(255,255,255,0.6);margin-bottom:12px;">توزيع التقييمات (${_adminData.ratings.length} تقييم)</div>` +
          [5, 4, 3, 2, 1].map(s => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <div style="width:32px;text-align:left;font-size:12px;color:#C8873A;font-weight:700;">${'★'.repeat(s)}</div>
            <div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${(dist[s] / maxD) * 100}%;background:linear-gradient(90deg,#C8873A,#E09940);border-radius:4px;"></div>
            </div>
            <div style="width:28px;font-size:12px;color:rgba(255,255,255,0.5);text-align:left;">${dist[s]}</div>
          </div>`).join('');
      }
      const list = filterStars ? _adminData.ratings.filter(r => r.stars === filterStars) : _adminData.ratings;
      if (!list.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:2rem;">لا توجد تقييمات</p>'; return; }
      el.innerHTML = list.slice(0, 40).map(r => {
        const stars = '★'.repeat(r.stars || 0) + '☆'.repeat(5 - (r.stars || 0));
        const starColor = r.stars >= 4 ? '#27AE60' : r.stars >= 3 ? '#C8873A' : '#E74C3C';
        return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="font-size:13px;font-weight:700;color:#fff;">👤 ${r.from_name || '-'}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.3);">→</div>
          <div style="font-size:13px;font-weight:700;color:#C8873A;">🔧 ${r.worker_name || '-'}</div>
        </div>
        <div style="color:${starColor};font-size:18px;letter-spacing:3px;margin-bottom:4px;">${stars}</div>
        ${r.comment ? `<div style="font-size:13px;color:rgba(255,255,255,0.6);font-style:italic;background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:8px;border-right:3px solid rgba(200,135,58,0.4);">"${r.comment}"</div>` : ''}
      </div>
      <div style="text-align:left;">
        <div style="font-size:11px;color:rgba(255,255,255,0.3);">${r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : ''}</div>
      </div>
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
      if (active) { active.style.background = 'rgba(200,135,58,0.15)'; active.style.borderColor = '#C8873A'; active.style.color = '#C8873A'; }
      renderAdminRatings(stars === 0 ? null : stars);
    };

    function renderAdminActivity(filterType) {
      const tbody = document.getElementById('adm-activity-body');
      if (!tbody) return;
      // Build events from orders
      const statusLabels = { pending: 'طلب جديد', price_offered: 'عرض سعر', client_counter: 'مفاوضة', accepted: 'مقبول', worker_done_pending: 'انتظار التأكيد', done: 'منجز', cancelled: 'ملغي' };
      const statusColors = { pending: '#C8873A', price_offered: '#E67E22', client_counter: '#9B59B6', accepted: '#2E86C1', worker_done_pending: '#1ABC9C', done: '#27AE60', cancelled: '#E74C3C' };
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

    async function adminDeleteUser(uid, role, name) {
      if (!confirm(`⚠️ هتحذف ${role === 'worker' ? 'الصنايعي' : 'العميل'} "${name}" — متأكد؟`)) return;
      try {
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
        // update overview stats
        const all = Object.values(_adminMarketAll);
        const openCount = all.filter(r => r.status === 'open').length;
        const totalOffers = all.reduce((s, r) => s + (r.offers ? Object.keys(r.offers).length : 0), 0);
        const acceptedCount = all.filter(r => r.status === 'accepted' || r.status === 'done').length;
        setText('adm-market-open', openCount);
        setText('adm-market-total', all.length + ' إجمالي');
        setText('adm-market-offers', totalOffers);
        setText('adm-market-accepted', acceptedCount + ' مقبول');
        // badge on sidebar
        const badge = document.getElementById('atab-market-badge');
        if (badge) { badge.textContent = openCount || ''; badge.style.display = openCount > 0 ? 'inline-flex' : 'none'; }
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
        const map = { open: ['#9B59B6', '🟢 مفتوح'], accepted: ['#E67E22', '🔄 مقبول'], done: ['#27AE60', '✅ منتهي'], cancelled: ['#E74C3C', '❌ ملغي'] };
        const [c, l] = map[s] || ['#888', s];
        return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">${l}</span>`;
      };
      tbody.innerHTML = list.map(r => {
        const offersCount = r.offers ? Object.keys(r.offers).length : 0;
        const acceptedOffer = r.accepted_offer_id && r.offers ? r.offers[r.accepted_offer_id] : null;
        const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : '-';
        return `<tr>
          <td><code style="color:#9B59B6;font-size:12px;">${r.id}</code></td>
          <td><strong>${r.user_name || '-'}</strong><br><span style="font-size:11px;color:rgba(255,255,255,0.35);">${r.user_phone || ''}</span></td>
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
          <td>
            <button class="admin-btn admin-btn-danger" onclick="adminDeleteMarketReq('${r.id}')">حذف</button>
          </td>
        </tr>`;
      }).join('');
    }
    window.adminRenderMarket = adminRenderMarket;

    function adminFilterMarketSearch(q) { adminRenderMarket(); }
    window.adminFilterMarketSearch = adminFilterMarketSearch;

    function adminShowMarketOffers(reqId) {
      const r = _adminMarketAll[reqId];
      if (!r) return;
      const offers = r.offers ? Object.entries(r.offers) : [];
      const detailEl = document.getElementById('adm-market-offers-detail');
      const titleEl = document.getElementById('adm-market-detail-title');
      const bodyEl = document.getElementById('adm-market-offers-body');
      if (!detailEl || !bodyEl) return;
      titleEl.textContent = `💼 عروض طلب: ${r.title || reqId} (${offers.length} عرض)`;
      if (!offers.length) {
        bodyEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1rem;">لا توجد عروض</p>';
      } else {
        bodyEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">` +
          offers.map(([oid, o]) => {
            const isAccepted = r.accepted_offer_id === oid;
            const isRejected = o.rejected;
            const statusColor = isAccepted ? '#2ECC71' : isRejected ? '#E74C3C' : '#E67E22';
            const statusLabel = isAccepted ? '✅ مقبول' : isRejected ? '❌ مرفوض' : '⏳ بانتظار';
            return `<div style="background:rgba(255,255,255,0.04);border:1px solid ${isAccepted ? 'rgba(46,204,113,0.3)' : 'rgba(255,255,255,0.08)'};border-radius:12px;padding:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div style="font-weight:800;font-size:14px;margin-bottom:4px;">🔧 ${o.worker_name || 'صنايعي'} <span style="font-size:12px;color:#C8873A;font-weight:600;">${o.worker_trade || ''}</span></div>
                <div style="font-size:13px;color:rgba(255,255,255,0.5);">${o.worker_phone || ''}</div>
                ${o.note ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:5px;font-style:italic;">"${o.note}"</div>` : ''}
                ${o.client_counter_price ? `<div style="font-size:12px;color:#E67E22;margin-top:5px;">🤝 عرض مضاد من العميل: ${o.client_counter_price} جنيه</div>` : ''}
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
      const map = { pending: ['badge-pending', 'معلّق'], accepted: ['badge-active', 'مقبول'], done: ['badge-done', 'منجز'], cancelled: ['badge-inactive', 'ملغي'], worker_done_pending: ['badge-pending', 'بانتظار تأكيد'] };
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
    let _firstOrderFreeEnabled = false;

    function toggleFirstOrderFree() {
      _firstOrderFreeEnabled = !_firstOrderFreeEnabled;
      const toggle = document.getElementById('first-order-toggle');
      const knob = document.getElementById('first-order-knob');
      if (_firstOrderFreeEnabled) {
        toggle.style.background = '#9B59B6';
        knob.style.transform = 'translateX(-18px)';
      } else {
        toggle.style.background = 'rgba(255,255,255,0.1)';
        knob.style.transform = 'translateX(0)';
      }
    }
    window.toggleFirstOrderFree = toggleFirstOrderFree;

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
        document.getElementById('promo-banner-detail').textContent = (activePromo.note || '') + (activePromo.first_order_free ? ' | 🎁 أول طلب مجاناً مفعّل' : '');
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
          ${p.first_order_free ? '<div style="font-size:11px;padding:4px 10px;background:rgba(155,89,182,0.15);border:1px solid rgba(155,89,182,0.3);border-radius:8px;display:inline-block;margin-bottom:8px;">🎁 أول طلب مجاناً مفعّل</div>' : ''}
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
          first_order_free: _firstOrderFreeEnabled,
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
        if (_firstOrderFreeEnabled) toggleFirstOrderFree();
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
        // فلتر رسائلي بالـ session_id
        const allMyMsgs = Object.values(snap.val()).filter(m => m.session_id === sid);
        // احسب كل ردود الأدمن
        let totalAdminReplies = 0;
        allMyMsgs.forEach(m => {
          if (m.reply && m.reply.trim()) totalAdminReplies++;
          if (m.thread) Object.values(m.thread).forEach(t => { if (t.from === 'admin') totalAdminReplies++; });
        });
        // لو في ردود جديدة من الأدمن — ظهّر toast
        if (_prevAdminReplyCount !== null && totalAdminReplies > _prevAdminReplyCount) {
          showNotifToast('📬', 'رد من خدمة العملاء', 'ردوا على رسالتك — افتح تواصل معنا لتشوف الرد', '#C8873A');
        }
        _prevAdminReplyCount = totalAdminReplies;
        const myMsgs = allMyMsgs.filter(m => m.reply && m.reply.trim());
        if (myMsgs.length === 0) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        list.innerHTML = myMsgs
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .map(m => {
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
            const msgKey = Object.keys(snap.val()).find(k => snap.val()[k].session_id === getContactSessionId() && snap.val()[k].message === m.message) || '';
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
      // تحديث أزرار الفلتر
      ['all', 'unread', 'client_replied', 'replied', 'no_reply'].forEach(f => {
        const btn = document.getElementById('amsg-tab-' + f);
        if (!btn) return;
        if (f === filter) {
          btn.style.borderColor = '#C8873A';
          btn.style.background = 'rgba(200,135,58,0.15)';
          btn.style.color = '#C8873A';
        } else {
          btn.style.borderColor = 'rgba(255,255,255,0.12)';
          btn.style.background = 'transparent';
          btn.style.color = 'rgba(255,255,255,0.45)';
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
      else if (_adminMsgFilter === 'no_reply') filtered = _allAdminMsgs.filter(([, m]) => !m.replied);

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
          <div onclick="toggleAdminMsg('${key}')" style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:rgba(255,255,255,0.02);cursor:pointer;user-select:none;transition:background 0.18s;"
            onmouseover="this.style.background='rgba(200,135,58,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
            <div style="width:40px;height:40px;border-radius:12px;background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">👤</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:800;color:#fff;">${m.name || '-'}</div>
              <div style="display:flex;align-items:center;gap:10px;margin-top:2px;flex-wrap:wrap;">
                ${m.phone ? `<a href="tel:${m.phone}" onclick="event.stopPropagation()" style="font-size:12px;color:#C8873A;text-decoration:none;font-weight:700;">📞 ${m.phone}</a>` : '<span style="font-size:12px;color:rgba(255,255,255,0.3);">بدون رقم</span>'}
                <span style="font-size:11px;color:rgba(255,255,255,0.3);">· ${timeAgo}</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">
                ${m.client_replied ? '<span style="background:rgba(46,134,193,0.18);color:#2E86C1;border:1px solid rgba(46,134,193,0.35);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:800;">💬 العميل رد</span>' : ''}
                ${!m.read && !m.client_replied ? '<span style="background:rgba(200,135,58,0.18);color:#C8873A;border:1px solid rgba(200,135,58,0.35);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:800;">جديدة ✨</span>' : ''}
                ${m.replied && !m.client_replied ? '<span style="background:rgba(39,174,96,0.12);color:#27AE60;border:1px solid rgba(39,174,96,0.25);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;">تم الرد ✓</span>' : ''}
                ${!m.replied ? '<span style="background:rgba(231,76,60,0.1);color:#E74C3C;border:1px solid rgba(231,76,60,0.25);padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;">لم يُرد ⏳</span>' : ''}
              </div>
              <!-- سهم الأكورديون -->
              <div id="arrow-${key}" style="font-size:18px;color:rgba(255,255,255,0.4);transition:transform 0.25s;transform:${autoOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">⌄</div>
            </div>
          </div>
          <!-- المحادثة وخانة الرد — مخفية افتراضياً -->
          <div id="body-${key}" style="display:${autoOpen ? 'block' : 'none'};">
            <!-- المحادثة -->
            <div style="padding:14px 18px;display:flex;flex-direction:column;gap:0;border-top:1px solid rgba(255,255,255,0.05);">
              ${threadHtml}
            </div>
            <!-- خانة الرد السريع -->
            <div style="padding:12px 18px 14px;border-top:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.02);">
              <div style="display:flex;gap:8px;align-items:flex-end;">
                <textarea id="reply-${key}" placeholder="اكتب ردك على ${m.name || 'العميل'}..." rows="2"
                  style="flex:1;padding:10px 13px;background:#1C1A17;border:1.5px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:Cairo,sans-serif;font-size:13px;outline:none;resize:none;line-height:1.6;"
                  onfocus="this.style.borderColor='#C8873A'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
                  onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();adminReplyMsg('${key}')}"></textarea>
                <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
                  <button onclick="adminReplyMsg('${key}')"
                    style="padding:9px 18px;background:linear-gradient(135deg,#C8873A,#8B5E25);color:#1C1A17;border:none;border-radius:9px;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;">
                    إرسال ↩
                  </button>
                  <button onclick="adminDeleteMsg('${key}')"
                    style="padding:7px 18px;background:rgba(192,57,43,0.1);border:1px solid rgba(192,57,43,0.3);color:#E74C3C;border-radius:9px;font-family:Cairo,sans-serif;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
                    حذف 🗑
                  </button>
                </div>
              </div>
              <div style="font-size:11px;color:rgba(255,255,255,0.2);margin-top:6px;">Enter للإرسال · Shift+Enter لسطر جديد</div>
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
      await push(ref(db, 'contact_messages/' + key + '/thread'), {
        from: 'admin', text: reply, created_at: new Date().toISOString()
      });
      await update(ref(db, 'contact_messages/' + key), {
        reply, replied: true, replied_at: new Date().toISOString(), read: true, client_replied: false
      });
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
      Array.from(grid.querySelectorAll('.service-card')).slice(8).forEach(c => c.remove());
      customServices.forEach(s => {
        grid.insertAdjacentHTML('beforeend', `<div class="service-card" onclick="filterCraftsmen('${s.key}')"><span class="service-icon">${s.icon}</span><div class="service-name">${s.name}</div><div class="service-count" id="count-${s.key}">0 صنايعي</div></div>`);
      });
      // بعد ما الكاردز اتضافت، حدّث أعدادها — رصيد 50+ أو معملوش طلبات
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
            if (bal >= 50) return true;
            const completed = wallets[uid]?.completed_orders ?? 0;
            return completed === 0; // أول طلب مجاناً — يظهر دايماً
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
        const unread = Object.values(snap.val()).filter(m => !m.read).length;
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
      showPage('request');
    }
    window.goToRequest = goToRequest;

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

    // ===== AUTH =====
    let selectedRole = '';
    function selectRole(r) {
      selectedRole = r;
      document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('role-' + r).classList.add('active');
      // إظهار حقل الحرفة للصنايعي فقط
      const tradeGroup = document.getElementById('reg-trade-group');
      if (tradeGroup) tradeGroup.style.display = r === 'worker' ? 'block' : 'none';
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
      const btn = document.querySelector('#form-register .auth-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري إنشاء الحساب...';
      try {
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        currentUser = result.user;
        const profileData = {
          full_name: name, email: email, phone: phone, area: area, role: role,
          created_at: new Date().toISOString()
        };
        if (role === 'worker') profileData.trade = trade;
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
            available: true,
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
        document.getElementById('register-success').style.display = 'block';
        setTimeout(() => {
          document.getElementById('register-success').style.display = 'none';
          showPage('home');
        }, 1500);
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
      if (!service || !name || !phone || !address) { alert('من فضلك اكمل كل الحقول المطلوبة'); return; }
      const btn = document.querySelector('.submit-btn');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
      const orderNum = 'ASW-' + Math.floor(1000 + Math.random() * 9000);
      // تحويل الصور لـ base64
      const images = window._reqImages && window._reqImages.length ? await imagesToBase64(window._reqImages) : [];
      try {
        await set(ref(db, 'service_requests/' + orderNum), {
          order_number: orderNum, service_type: service, client_name: name, client_phone: phone,
          address, area, preferred_time: time, description: desc,
          status: 'pending', user_id: currentUser?.uid || null,
          worker_id: window._targetWorkerId || null,
          images: images,
          created_at: new Date().toISOString()
        });
        // لو الطلب موجه لصنايعي معين، ابعتله إشعار
        if (window._targetWorkerId) {
          await push(ref(db, 'notifications/' + window._targetWorkerId), {
            type: 'new_request',
            title: 'طلب خدمة جديد! 🔔',
            body: name + ' عايز ' + service + ' في ' + (area || address),
            client_id: currentUser?.uid || null,
            client_name: name,
            order_num: orderNum,
            read: false,
            created_at: new Date().toISOString()
          });
          window._targetWorkerId = null;
        }
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
    }
    window.resetRequest = resetRequest;

    // ===== WORKER ORDERS =====
    async function loadWorkerOrders() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      const list = document.getElementById('worker-orders-list');
      if (!list) return;
      try {
        const snap = await get(ref(db, 'service_requests'));
        if (!snap.exists()) return;
        const allOrders = Object.values(snap.val());
        // بيجيب الطلبات الموجهة للصنايعي ده بس
        const active = allOrders.filter(o => o.worker_id === currentUser.uid && o.status !== 'cancelled').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
        if (!active.length) {
          list.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1.5rem;font-size:14px;">لا توجد طلبات جارية</p>';
          return;
        }
        const statusMap = { pending: { cls: 'pending', txt: '⏳ جاري' }, price_offered: { cls: 'pending', txt: '💰 عرض سعر — بانتظار العميل' }, client_counter: { cls: 'pending', txt: '🤝 العميل فاصل — بانتظار ردك' }, accepted: { cls: 'pending', txt: '✓ العميل وافق' }, worker_done_pending: { cls: 'worker-done', txt: '⏳ بانتظار تأكيد العميل' }, done: { cls: 'done', txt: '✓ منجز' }, cancelled: { cls: 'cancelled', txt: '✗ ملغي' } };
        const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️' };
        list.innerHTML = active.map(o => {
          const s = statusMap[o.status] || statusMap.pending;
          const icon = Object.entries(emojiMap).find(([k]) => o.service_type?.includes(k))?.[1] || '🔧';
          return '<div class="order-item" style="flex-direction:column;align-items:flex-start;gap:10px;">' +
            '<div style="display:flex;align-items:center;gap:12px;width:100%;">' +
            '<div class="order-icon">' + icon + '</div>' +
            '<div class="order-info" style="flex:1;">' +
            '<div class="order-title">' + (o.service_type || 'خدمة') + ' - ' + (o.area || '') + '</div>' +
            '<div class="order-meta">' + o.order_number + ' · ' + new Date(o.created_at).toLocaleDateString('ar-EG') + ' · ' + (o.client_name || '') + '</div>' +
            (o.description ? '<div class="order-meta" style="margin-top:4px;color:rgba(255,255,255,0.5);">' + o.description + '</div>' : '') +
            '</div>' +
            '<span class="order-status ' + s.cls + '">' + s.txt + '</span>' +
            '</div>' +
            (o.status === 'pending' ?
              '<div style="display:flex;gap:8px;width:100%;">' +
              '<button onclick="openPriceOfferModal(\'' + o.order_number + '\')" style="flex:1;padding:8px;background:rgba(30,132,73,0.2);border:1px solid rgba(30,132,73,0.4);border-radius:8px;color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✓ قبول وسعر</button>' +
              '<button onclick="updateOrderStatus(\'' + o.order_number + '\', \'cancelled\')" style="flex:1;padding:8px;background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.3);border-radius:8px;color:#E74C3C;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✗ رفض</button>' +
              '</div>'
              : '') +
            (o.status === 'accepted' ?
              '<button onclick="updateOrderStatus(\'' + o.order_number + '\', \'done\')" style="width:100%;padding:9px;background:rgba(200,135,58,0.15);border:1px solid rgba(200,135,58,0.3);border-radius:9px;color:#C8873A;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">✓ تم التنفيذ — أبلّغ العميل</button>'
              : '') +
            (o.status === 'worker_done_pending' ?
              '<div style="width:100%;padding:10px 14px;background:rgba(241,196,15,0.1);border:1px solid rgba(241,196,15,0.35);border-radius:9px;color:#F1C40F;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;text-align:center;">⏳ في انتظار تأكيد العميل...</div>'
              : '') +
            (o.status === 'done' && !o._doneNotified ?
              '<div style="width:100%;padding:12px 14px;background:rgba(46,204,113,0.13);border:1px solid rgba(46,204,113,0.45);border-radius:9px;display:flex;align-items:center;gap:10px;">' +
              '<span style="font-size:22px;">🎉</span>' +
              '<div style="flex:1;">' +
              '<div style="color:#2ECC71;font-family:Cairo,sans-serif;font-size:13px;font-weight:800;">العميل أكد إن الشغل اتنجز!</div>' +
              '<div style="color:rgba(255,255,255,0.45);font-family:Cairo,sans-serif;font-size:12px;margin-top:2px;">تم إغلاق الطلب بنجاح ✓</div>' +
              '</div>' +
              '</div>'
              : '') +
            (o.status === 'done' && !o.worker_rated ?
              '<button onclick="openRatingModal(\'worker_rates_client\', \'' + o.order_number + '\')" style="width:100%;padding:9px;background:rgba(200,135,58,0.12);border:1px solid rgba(200,135,58,0.4);border-radius:9px;color:#C8873A;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">⭐ قيّم العميل</button>'
              : '') +
            (o.status === 'done' && o.worker_rated ?
              '<div style="padding:6px;text-align:center;color:rgba(255,255,255,0.25);font-size:11px;font-family:Cairo,sans-serif;">✓ تم تقييم العميل</div>'
              : '') +
            '</div>';
        }).join('');
        // update worker stats
        const myDone = allOrders.filter(o => o.worker_id === currentUser.uid && o.status === 'done').length;
        if (document.getElementById('worker-stat-done')) document.getElementById('worker-stat-done').textContent = myDone;
      } catch (e) { console.log('worker orders error', e); }
    }
    window.loadWorkerOrders = loadWorkerOrders;

    function openChatWithUser(userId, userName, userRole) {
      if (!userId || !currentUser) return;
      const partner = { full_name: userName || (userRole === 'worker' ? 'الصنايعي' : 'العميل'), role: userRole || 'client' };
      // افتح الشات كـ modal فوق الصفحة الحالية
      openChatModal(userId, partner);
    }
    window.openChatWithUser = openChatWithUser;

    // ===== CHAT MODAL =====
    function openChatModal(partnerId, partner) {
      document.getElementById('chat-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
      document.getElementById('chat-modal-partner-name').textContent = partner.full_name || 'مستخدم';
      document.getElementById('chat-modal-partner-role').textContent = partner.role === 'worker' ? '🔧 صنايعي' : '👤 عميل';
      document.getElementById('chat-modal-partner-avatar').textContent = partner.role === 'worker' ? '🔧' : '👤';
      document.getElementById('chat-modal-messages').innerHTML = '';

      if (chatListener) { chatListener(); chatListener = null; }
      currentChatId = getChatId(currentUser.uid, partnerId);

      chatListener = onValue(ref(db, 'chats/' + currentChatId + '/messages'), (snap) => {
        const container = document.getElementById('chat-modal-messages');
        container.innerHTML = '';
        if (!snap.exists()) return;
        const raw = snap.val();
        // دعم حقل sender و from على حد سواء
        const msgs = Object.values(raw).sort((a, b) => (a.ts || a.timestamp || 0) - (b.ts || b.timestamp || 0));
        // mark unread as read
        const updates = {};
        Object.entries(raw).forEach(([key, m]) => {
          const msgSender = m.sender || m.from;
          if (msgSender !== currentUser.uid && !m.read) updates[key + '/read'] = true;
        });
        if (Object.keys(updates).length) {
          update(ref(db, 'chats/' + currentChatId + '/messages'), updates).catch(() => { });
        }
        msgs.forEach(m => {
          const msgSender = m.sender || m.from;
          const msgTime = m.ts || m.timestamp || Date.now();
          const isMine = msgSender === currentUser.uid;
          const div = document.createElement('div');
          div.className = 'msg ' + (isMine ? 'sent' : 'received');
          const readMark = isMine ? `<div class="msg-status ${m.read ? 'read' : ''}">${m.read ? '✓✓' : '✓'}</div>` : '';
          const timeStr = new Date(msgTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
          div.innerHTML = `<span style="white-space:pre-line;">${m.text || ''}</span><div class="msg-time">${timeStr}</div>${readMark}`;
          container.appendChild(div);
        });
        container.scrollTop = container.scrollHeight;
      });
    }
    window.openChatModal = openChatModal;

    function closeChatModal() {
      document.getElementById('chat-modal').style.display = 'none';
      document.body.style.overflow = '';
      if (chatListener) { chatListener(); chatListener = null; }
      currentChatId = null;
    }
    window.closeChatModal = closeChatModal;

    async function sendChatModalMessage() {
      const input = document.getElementById('chat-modal-input');
      const text = input.value.trim();
      if (!text || !currentChatId) return;
      input.value = '';
      await push(ref(db, 'chats/' + currentChatId + '/messages'), {
        text, sender: currentUser.uid, ts: Date.now(), read: false
      });
    }
    window.sendChatModalMessage = sendChatModalMessage;

    async function updateOrderStatus(orderNum, status) {
      // لو الصنايعي ضغط "تم التنفيذ" — مش بنغيرها مباشرة، بنطلب تأكيد من العميل
      if (status === 'done') {
        await update(ref(db, 'service_requests/' + orderNum), { status: 'worker_done_pending' });
        // إشعار للعميل يأكد
        const snap2 = await get(ref(db, 'service_requests/' + orderNum));
        if (snap2.exists()) {
          const order2 = snap2.val();
          if (order2.user_id) {
            await push(ref(db, 'notifications/' + order2.user_id), {
              type: 'confirm_done', title: 'الصنايعي قال إنه خلّص! ✅',
              body: 'طلب ' + orderNum + ' - ' + (order2.service_type || '') + ' — هل تأكد إن الشغل اتنجز؟',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        loadWorkerOrders();
        loadWorkerRequests();
        return;
      }
      await update(ref(db, 'service_requests/' + orderNum), { status });
      loadWorkerOrders();
      loadWorkerRequests();
      const snap = await get(ref(db, 'service_requests/' + orderNum));
      if (snap.exists()) {
        const order = snap.val();
        if (order.user_id) {
          const msgs = { accepted: 'تم قبول طلبك ✅', cancelled: 'تم رفض طلبك ✗' };
          if (msgs[status]) {
            await push(ref(db, 'notifications/' + order.user_id), {
              type: 'order_update', title: msgs[status],
              body: 'طلب ' + order.order_number + ' - ' + (order.service_type || ''),
              read: false, created_at: new Date().toISOString()
            });
          }
          // لو قبول — ابعت رسالة أوتوماتيك في الشات وسجّل اسم الصنايعي
          if (status === 'accepted' && currentUser) {
            const workerName = currentProfile?.full_name || 'الصنايعي';
            // سجّل اسم الصنايعي في الطلب عشان العميل يشوفه
            await update(ref(db, 'service_requests/' + order.order_number), { worker_name: workerName });
            const chatId = [currentUser.uid, order.user_id].sort().join('_');
            const autoMsg = '✅ أهلاً! أنا ' + workerName + '، تم قبول طلبك رقم ' + order.order_number + ' (' + (order.service_type || 'خدمة') + ') 🎉\nهتواصل معاك قريباً إن شاء الله 🙏';
            await push(ref(db, 'chats/' + chatId + '/messages'), {
              text: autoMsg,
              sender: currentUser.uid,
              ts: Date.now(),
              read: false,
              auto: true
            });
            // ✅ Firebase notification للعميل بقبول الطلب
            await push(ref(db, 'notifications/' + order.user_id), {
              type: 'worker_accepted', title: '✅ الصنايعي قبل طلبك!',
              body: workerName + ' قبل طلبك رقم ' + order.order_number + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — افتح الشات للتواصل معاه 🙏',
              order_num: order.order_number, read: false, created_at: new Date().toISOString()
            });
          }
        }
      }
    }
    window.updateOrderStatus = updateOrderStatus;

    // ===== CLIENT CONFIRM DONE =====
    let _confirmDoneOrderNum = null;
    function openConfirmDoneModal(orderNum, serviceType) {
      _confirmDoneOrderNum = orderNum;
      document.getElementById('confirm-done-order-info').textContent = 'طلب: ' + (serviceType || orderNum) + ' — هل تأكد إن الشغل اتنجز؟';
      document.getElementById('confirm-done-modal').style.display = 'flex';
    }
    window.openConfirmDoneModal = openConfirmDoneModal;

    function closeConfirmDoneModal() {
      document.getElementById('confirm-done-modal').style.display = 'none';
      _confirmDoneOrderNum = null;
    }
    window.closeConfirmDoneModal = closeConfirmDoneModal;

    async function clientConfirmDone(confirmed, directOrderNum) {
      const orderNum = directOrderNum || _confirmDoneOrderNum || window._confirmDoneOrderNum;
      if (!orderNum) { console.error('clientConfirmDone: no orderNum'); return; }
      _confirmDoneOrderNum = null;
      window._confirmDoneOrderNum = null;
      closeConfirmDoneModal();
      if (confirmed) {
        await update(ref(db, 'service_requests/' + orderNum), { status: 'done' });
        // إشعار للصنايعي
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.worker_id) {
            await push(ref(db, 'notifications/' + order.worker_id), {
              type: 'order_done', title: 'العميل أكد إنجاز الطلب ✅',
              body: 'طلب ' + orderNum + ' - ' + (order.service_type || '') + ' تم إغلاقه.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        loadMyOrders();
        loadClientOrders();
        // فتح تقييم العميل للصنايعي
        setTimeout(() => openRatingModal('client_rates_worker', orderNum), 400);
      } else {
        await update(ref(db, 'service_requests/' + orderNum), { status: 'accepted' });
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.worker_id) {
            await push(ref(db, 'notifications/' + order.worker_id), {
              type: 'done_rejected', title: 'العميل قال إن الشغل لسه مخلصش ⚠️',
              body: 'طلب ' + orderNum + ' - ' + (order.service_type || '') + ' — الطلب رجع لحالة مقبول.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        loadMyOrders();
        loadClientOrders();
        alert('تم إبلاغ الصنايعي إن الشغل لسه مخلصش.');
      }
    }
    window.clientConfirmDone = clientConfirmDone;

    // ===== CLIENT INITIATES DONE (يسأل الصنايعي أول) =====
    async function clientInitDone(orderNum) {
      if (!currentUser) return;
      if (!confirm('🏁 هتبعت للصنايعي إن الشغل خلص عشان يأكد — متأكد؟')) return;
      try {
        await update(ref(db, 'service_requests/' + orderNum), { status: 'client_initiated_done' });
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.worker_id) {
            await push(ref(db, 'notifications/' + order.worker_id), {
              type: 'client_says_done',
              title: '🏁 العميل قال إن الشغل خلص!',
              body: 'طلب ' + orderNum + ' - ' + (order.service_type || '') + ' — أكّد إنك فعلاً خلّصت.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        loadMyOrders();
        loadClientOrders();
        showToast('✅ تم إبلاغ الصنايعي — بينتظر تأكيده', '#C8873A');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.clientInitDone = clientInitDone;
    // ===== END CLIENT INITIATES DONE =====

    // ===== WORKER CONFIRMS/DENIES CLIENT-INITIATED DONE =====
    async function workerConfirmClientDone(orderNum) {
      if (!currentUser) return;
      if (!confirm('✅ هتأكد إن الشغل خلص فعلاً وتقفل الطلب؟')) return;
      try {
        await update(ref(db, 'service_requests/' + orderNum), { status: 'done' });
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.user_id) {
            await push(ref(db, 'notifications/' + order.user_id), {
              type: 'order_done', title: 'الصنايعي أكّد إن الشغل خلص ✅',
              body: 'طلب ' + orderNum + ' - ' + (order.service_type || '') + ' تم إغلاقه بنجاح.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        loadWorkerOrders();
        loadWorkerRequests();
        showToast('✅ تم إغلاق الطلب بنجاح!', '#27AE60');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.workerConfirmClientDone = workerConfirmClientDone;

    async function workerDenyClientDone(orderNum) {
      if (!currentUser) return;
      if (!confirm('⚠️ هترجع الطلب لحالة مقبول وتخبر العميل؟')) return;
      try {
        await update(ref(db, 'service_requests/' + orderNum), { status: 'accepted' });
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.user_id) {
            await push(ref(db, 'notifications/' + order.user_id), {
              type: 'worker_not_done_yet', title: '⚠️ الصنايعي قال إنه لسه مخلصش',
              body: 'طلب ' + orderNum + ' - ' + (order.service_type || '') + ' — رجع لحالة مقبول.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        loadWorkerOrders();
        loadWorkerRequests();
        showToast('تم إرجاع الطلب — العميل هيتواصل معاك', '#E67E22');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.workerDenyClientDone = workerDenyClientDone;
    // ===== END WORKER CONFIRMS CLIENT DONE =====

    // ===== LOAD WORKER RATINGS =====
    async function loadWorkerRatings() {
      if (!currentUser) return;
      const listEl = document.getElementById('worker-ratings-list');
      if (!listEl) return;
      try {
        const snap = await get(ref(db, 'craftsmen/' + currentUser.uid + '/ratings_list'));
        if (!snap.exists()) {
          listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1rem;font-size:13px;">لا توجد تقييمات بعد</p>';
          return;
        }
        const ratings = Object.values(snap.val()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const starLabelsArr = ['', 'ضعيف جداً 😕', 'ضعيف 😐', 'كويس 🙂', 'كويس جداً 😊', 'ممتاز! 🤩'];
        listEl.innerHTML = ratings.map(r => {
          const stars = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(200,135,58,0.15);border-radius:14px;padding:14px 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:36px;height:36px;border-radius:10px;background:rgba(200,135,58,0.15);display:flex;align-items:center;justify-content:center;font-size:18px;">👤</div>
            <div>
              <div style="font-size:14px;font-weight:700;color:#fff;">${r.from_name || 'عميل'}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);">${date}</div>
            </div>
          </div>
          <div style="text-align:left;">
            <div style="color:#C8873A;font-size:16px;letter-spacing:2px;">${stars}</div>
            <div style="font-size:11px;color:#C8873A;font-weight:700;text-align:center;">${starLabelsArr[r.stars] || ''}</div>
          </div>
        </div>
        ${r.comment ? `<p style="color:rgba(255,255,255,0.65);font-size:13px;line-height:1.7;margin:0;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">"${r.comment}"</p>` : ''}
      </div>`;
        }).join('');
      } catch (e) {
        console.log('ratings error', e);
        listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1rem;font-size:13px;">لا توجد تقييمات بعد</p>';
      }
    }
    window.loadWorkerRatings = loadWorkerRatings;

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
      };
      return map[type] || '#C8873A';
    }
    window.notifAccentColor = notifAccentColor;

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
      if (rows[0]) rows[0].textContent = p.phone || '-';
      if (rows[1]) rows[1].textContent = p.email || '-';
      if (rows[2]) rows[2].textContent = p.address || '-';
      if (rows[3]) rows[3].textContent = p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }) : '-';
    }

    function renderWorkerProfile(p) {
      if (!p || p.role !== 'worker') return;
      const page = document.getElementById('page-profile-worker');
      if (!page) return;
      const nameEl = page.querySelector('.profile-name');
      if (nameEl) nameEl.textContent = p.full_name || '-';
      const meta = page.querySelector('.profile-meta');
      if (meta) meta.innerHTML = '📍 ' + (p.work_area || '-') + ' &nbsp;·&nbsp; عضو منذ ' + (p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' }) : '');
      // target info-val inside the personal data card only
      const personalCard = page.querySelector('.profile-card');
      if (personalCard) {
        const rows = personalCard.querySelectorAll('.info-val');
        if (rows[0]) rows[0].textContent = p.phone || '-';
        if (rows[1]) rows[1].textContent = p.email || '-';
        if (rows[2]) rows[2].textContent = p.work_area || '-';
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
      const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️' };

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
      label.textContent = checkbox.checked ? '🟢 الحالة: متاح للعمل دلوقتي' : '🔴 الحالة: مش متاح دلوقتي';
      if (currentUser) {
        await update(ref(db, 'craftsmen/' + currentUser.uid), { available: checkbox.checked });
        // الـ real-time listener هيحدّث قائمة الصنايعية تلقائياً فوراً
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

    function bookCraftsman(c) {
      if (currentProfile?.role === 'worker') { alert('الصنايعي مش بيقدر يطلب خدمة!'); return; }
      window._targetWorkerId = c.user_id || c.id;
      showPage('request');
      setTimeout(() => {
        const sel = document.getElementById('req-service');
        for (let opt of sel.options) { if (opt.text.includes(c.trade)) { sel.value = opt.value; break; } }
        document.getElementById('req-desc').value = 'طلب خدمة من الصنايعي: ' + c.name + ' (' + c.trade + ')';
      }, 100);
    }
    window.bookCraftsman = bookCraftsman;

    // ===== GO TO MY PROFILE =====
    function goToMyProfile() {
      if (!currentUser) { showAuthPage('login'); return; }
      const dest = currentProfile?.role === 'worker' ? 'profile-worker' : 'profile-client';
      showPage(dest);
    }
    window.goToMyProfile = goToMyProfile;

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
            photo: c.photo || p.photo || p.avatar_url || ''
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

    // ===== GLOBAL PERSISTENT REALTIME LISTENER FOR WORKER =====
    let _workerGlobalListener = null;
    let _workerPrevStatuses = {}; // لتتبع تغيير الحالة

    function startWorkerGlobalListener() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      if (_workerGlobalListener) return; // already running
      _workerGlobalListener = onValueUnsubscribable(
        ref(db, 'service_requests'),
        (snap) => {
          if (!snap.exists()) return;
          const allOrders = Object.values(snap.val()).filter(o => o.worker_id === currentUser.uid);
          // تحديث badge الطلبات الجديدة
          // عدد الطلبات اللي محتاجة رد من الصنايعي
          const urgentStatuses = ['pending', 'client_counter', 'client_initiated_done'];
          // لو الصنايعي فاتح الصفحة دلوقتي — صفّر الـ badge
          const workerReqPageOpen = document.getElementById('page-worker-requests')?.classList.contains('active');
          const newCount = workerReqPageOpen ? 0 : allOrders.filter(o => urgentStatuses.includes(o.status)).length;
          const badge = document.getElementById('nav-reqs-badge');
          if (badge) { badge.textContent = newCount; badge.style.display = newCount > 0 ? 'inline' : 'none'; }
          const siBadge = document.getElementById('si-orders-badge');
          if (siBadge) { siBadge.textContent = newCount; siBadge.className = 'si-badge' + (newCount > 0 ? ' show' : ''); }
          const mbBadge = document.getElementById('mbnav-orders-badge');
          if (mbBadge) { mbBadge.textContent = newCount; mbBadge.className = 'm-badge' + (newCount > 0 ? ' show' : ''); }
          // لو الصنايعي في صفحة طلباته — حدّثها فوراً
          const workerReqPage = document.getElementById('page-worker-requests');
          if (workerReqPage && workerReqPage.classList.contains('active')) {
            allWorkerReqs = allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            renderWorkerReqs();
          }
          // لو الصنايعي في بروفايله — حدّث الطلبات الجارية
          const workerProfilePage = document.getElementById('page-profile-worker');
          if (workerProfilePage && workerProfilePage.classList.contains('active')) {
            loadWorkerOrders();
          }
          // ===== تتبع تغيير الحالة للصنايعي =====
          // زرار التقييم بيظهر في كارد الطلب بس لما status = done (بعد تأكيد العميل)
          allOrders.forEach(o => {
            _workerPrevStatuses[o.order_number] = o.status;
          });
        }
      );
    }
    window.startWorkerGlobalListener = startWorkerGlobalListener;

    function stopWorkerGlobalListener() {
      if (_workerGlobalListener) { try { _workerGlobalListener(); } catch (e) { } _workerGlobalListener = null; }
    }
    window.stopWorkerGlobalListener = stopWorkerGlobalListener;
    // ===== END GLOBAL WORKER LISTENER =====

    // ===== GLOBAL PERSISTENT REALTIME LISTENER FOR CLIENT =====
    let _clientGlobalListener = null;

    function startClientGlobalListener() {
      if (!currentUser || currentProfile?.role !== 'client') return;
      if (_clientGlobalListener) return;
      _clientGlobalListener = onValue(ref(db, 'service_requests'), (snap) => {
        if (!snap.exists()) { updateClientOrderBadge(0); return; }
        const myOrders = Object.values(snap.val()).filter(o => o.user_id === currentUser.uid);
        // لو العميل فاتح الصفحة دلوقتي — صفّر الـ badge وحدّث القايمة
        const clientOrdersPage = document.getElementById('page-client-orders');
        const isPageOpen = clientOrdersPage && clientOrdersPage.classList.contains('active');
        if (isPageOpen) {
          allClientOrders = myOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          renderClientOrders();
          updateClientOrderBadge(0);
        } else {
          // بعيد عن الصفحة — عدّ الطلبات اللي محتاجة رد
          const urgentStatuses = ['price_offered', 'worker_counter', 'worker_done_pending'];
          const newUpdates = myOrders.filter(o => urgentStatuses.includes(o.status)).length;
          updateClientOrderBadge(newUpdates);
        }
      });
    }
    window.startClientGlobalListener = startClientGlobalListener;

    function stopClientGlobalListener() {
      if (_clientGlobalListener) { try { _clientGlobalListener(); } catch (e) { } _clientGlobalListener = null; }
    }
    window.stopClientGlobalListener = stopClientGlobalListener;

    function updateClientOrderBadge(count) {
      const siOrderBadge = document.getElementById('si-orders-badge');
      if (siOrderBadge) { siOrderBadge.textContent = count || ''; siOrderBadge.className = 'si-badge' + (count > 0 ? ' show' : ''); }
      const mbOrderBadge = document.getElementById('mbnav-orders-badge');
      if (mbOrderBadge) { mbOrderBadge.textContent = count || ''; mbOrderBadge.className = 'm-badge' + (count > 0 ? ' show' : ''); }
      // nav dropdown client orders link
      const navClientLink = document.getElementById('nav-client-orders-link');
      if (navClientLink) {
        let sp = navClientLink.querySelector('.client-orders-badge');
        if (!sp && count > 0) { sp = document.createElement('span'); sp.className = 'client-orders-badge'; sp.style.cssText = 'background:#E74C3C;color:#fff;border-radius:50%;padding:1px 6px;font-size:11px;margin-right:4px;display:inline;'; navClientLink.appendChild(sp); }
        if (sp) { sp.textContent = count || ''; sp.style.display = count > 0 ? 'inline' : 'none'; }
      }
    }
    window.updateClientOrderBadge = updateClientOrderBadge;

    function stopRealtimeListeners() {
      Object.values(_activeListeners).forEach(unsub => { try { unsub(); } catch (e) { } });
      _activeListeners = {};
    }
    window.stopRealtimeListeners = stopRealtimeListeners;

    // onValue بيرجع دالة unsubscribe — نستخدمها مباشرةً
    function onValueUnsubscribable(r, cb) {
      return onValue(r, cb);
    }

    function startRealtimeForClientOrders() {
      if (!currentUser) return;
      stopRealtimeListeners();
      _activeListeners['client-orders'] = onValueUnsubscribable(
        ref(db, 'service_requests'),
        (snap) => {
          if (!snap.exists()) { allClientOrders = []; renderClientOrders(); return; }
          allClientOrders = Object.values(snap.val())
            .filter(o => o.user_id === currentUser.uid)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          renderClientOrders();
          // لما الصفحة مفتوحة — صفّر الـ badge فوراً
          updateClientOrderBadge(0);
        }
      );
    }
    window.startRealtimeForClientOrders = startRealtimeForClientOrders;

    function startRealtimeForWorkerRequests() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      stopRealtimeListeners();
      _activeListeners['worker-requests'] = onValueUnsubscribable(
        ref(db, 'service_requests'),
        (snap) => {
          if (!snap.exists()) { allWorkerReqs = []; renderWorkerReqs(); return; }
          allWorkerReqs = Object.values(snap.val())
            .filter(o => o.worker_id === currentUser.uid)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          renderWorkerReqs();
          // لما الصنايعي يفتح الصفحة — صفّر الـ badge فوراً
          const badge = document.getElementById('nav-reqs-badge');
          if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
          const siBadge2 = document.getElementById('si-orders-badge');
          if (siBadge2) { siBadge2.textContent = ''; siBadge2.className = 'si-badge'; }
          const mbBadge2 = document.getElementById('mbnav-orders-badge');
          if (mbBadge2) { mbBadge2.textContent = ''; mbBadge2.className = 'm-badge'; }
        }
      );
    }
    window.startRealtimeForWorkerRequests = startRealtimeForWorkerRequests;

    function startRealtimeForWorkerProfile() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      stopRealtimeListeners();
      // طلبات الصنايعي الجارية
      _activeListeners['worker-orders'] = onValueUnsubscribable(
        ref(db, 'service_requests'),
        (snap) => {
          if (!snap.exists()) return;
          const allOrders = Object.values(snap.val());
          const active = allOrders.filter(o => o.worker_id === currentUser.uid && o.status !== 'cancelled')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
          const listEl = document.getElementById('worker-orders-list');
          if (listEl) {
            if (!active.length) {
              listEl.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1.5rem;font-size:14px;">لا توجد طلبات جارية</p>';
            } else {
              loadWorkerOrders(); // يعيد رسم الكارت الكاملة
            }
          }
        }
      );
      // تقييمات الصنايعي
      _activeListeners['worker-ratings'] = onValueUnsubscribable(
        ref(db, 'craftsmen/' + currentUser.uid + '/ratings_list'),
        () => loadWorkerRatings()
      );
    }
    window.startRealtimeForWorkerProfile = startRealtimeForWorkerProfile;

    function startRealtimeForClientProfile() {
      if (!currentUser) return;
      stopRealtimeListeners();
      _activeListeners['client-stats'] = onValueUnsubscribable(
        ref(db, 'service_requests'),
        (snap) => {
          if (!snap.exists()) return;
          const data = Object.values(snap.val()).filter(o => o.user_id === currentUser.uid);
          const boxes = document.querySelectorAll('#page-profile-client .stat-box-num');
          if (boxes[0]) boxes[0].textContent = data.filter(o => o.status === 'done').length;
          if (boxes[1]) boxes[1].textContent = data.filter(o => ['pending', 'accepted', 'worker_done_pending'].includes(o.status)).length;
        }
      );
      // listener على تعليقات الصنايعية للعميل — تحديث فوري
      _activeListeners['client-ratings'] = onValueUnsubscribable(
        ref(db, 'profiles/' + currentUser.uid + '/ratings_list'),
        () => loadClientRatings()
      );
    }

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

      const statusColors = { pending: '#F39C12', price_offered: '#9B59B6', client_counter: '#E67E22', worker_counter: '#3498DB', accepted: '#2ECC71', worker_done_pending: '#C8873A', client_initiated_done: '#27AE60', done: '#27AE60', cancelled: '#E74C3C' };
      const statusTxt = { pending: '⏳ جديد', price_offered: '💰 عرض سعر جديد!', client_counter: '🤝 بينتظر ردك!', worker_counter: '↩️ الصنايعي رد بسعر!', accepted: '✓ مقبول', worker_done_pending: '⚠️ ينتظر تأكيدك', client_initiated_done: '⏳ بانتظار تأكيد الصنايعي', done: '✓ منجز', cancelled: '✗ ملغي' };
      const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️' };

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

      document.getElementById('cod-body').innerHTML =
        row('📋', 'رقم الطلب', o.order_number) +
        row('📅', 'تاريخ الطلب', new Date(o.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })) +
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