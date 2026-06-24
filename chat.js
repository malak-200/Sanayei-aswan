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
        cm_client_says_done: '🏁', new_offer: '💰',
        cm_client_counter: '🤝', cm_counter_accepted: '✅', cm_worker_counter: '↩️',
        cm_worker_done: '🏁', cm_dispute: '⚠️', cm_done_confirmed: '✅',
        cm_worker_not_done: '⚠️', offer_accepted: '✅', offer_rejected: '❌'
      };
      return icons[type] || '🔔';
    }

    // إشعارات السوق (client_requests) — ليها بادج خاص بيها جوه صفحة السوق نفسها (مش بادج الطلبات العادية)
    // لازم تتستبعد من عداد "طلباتي" العادي، علشان كده كان البادج بيتحرك من غير ما يبان أي حاجة فعلية في صفحة الطلبات
    const MARKET_NOTIF_TYPES = ['new_offer', 'cm_client_says_done', 'cm_client_counter', 'cm_counter_accepted', 'cm_worker_counter', 'cm_worker_done', 'cm_dispute', 'cm_done_confirmed', 'cm_worker_not_done', 'offer_accepted', 'offer_rejected'];

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
        const ORDER_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'client_counter', 'worker_accepted', 'counter_accepted', 'admin_reply', 'worker_not_done_yet', 'client_says_done', 'new_order', 'worker_counter'];
        const chatUnread = allNotifs.filter(n => !n.read && !ORDER_TYPES.includes(n.type) && !MARKET_NOTIF_TYPES.includes(n.type) && n.type !== 'new_rating').length;
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
      // نتتبع كل key وحالة client_replied بتاعته + عدد الـ thread عشان منطلعش notification متكررة
      let _prevState = null; // Map: key -> { client_replied, threadCount }
      onValue(ref(db, 'contact_messages'), (snap) => {
        if (!snap.exists()) { _prevState = {}; return; }
        const msgs = Object.entries(snap.val());

        if (_prevState !== null) {
          msgs.forEach(([key, m]) => {
            // رسالة جديدة خالص
            if (!_prevState[key]) {
              sendBrowserNotif('💬 رسالة جديدة من عميل', m.name + ': ' + m.message);
              showToast('💬 رسالة جديدة من ' + (m.name || 'عميل'));
              return;
            }
            // رد العميل على محادثة — بس لو client_replied اتغيّر من false لـ true
            const prevClientReplied = _prevState[key].client_replied;
            const currThreadCount = m.thread ? Object.keys(m.thread).length : 0;
            const prevThreadCount = _prevState[key].threadCount;
            if (!prevClientReplied && m.client_replied) {
              sendBrowserNotif('↩ ' + (m.name || 'العميل') + ' رد عليك', m.message);
              showToast('↩ رد جديد من ' + (m.name || 'العميل'));
            } else if (currThreadCount > prevThreadCount && m.client_replied) {
              // رسالة جديدة في الـ thread من العميل
              showToast('↩ رد جديد من ' + (m.name || 'العميل'));
            }
          });
        }

        // حدّث الحالة السابقة
        _prevState = {};
        msgs.forEach(([key, m]) => {
          _prevState[key] = {
            client_replied: !!m.client_replied,
            threadCount: m.thread ? Object.keys(m.thread).length : 0
          };
        });
      });
    }
    // ===== END BROWSER PUSH NOTIFICATIONS =====




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
    const WORKER_ORDER_NOTIF_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'client_counter', 'worker_accepted', 'counter_accepted', 'admin_reply', 'worker_not_done_yet', 'client_says_done', 'new_order', 'worker_counter'];
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
    const CLIENT_ORDER_NOTIF_TYPES = ['order_update', 'confirm_done', 'order_done', 'done_rejected', 'price_offered', 'price_rejected', 'client_counter', 'worker_accepted', 'counter_accepted', 'admin_reply', 'worker_not_done_yet', 'client_says_done', 'new_order', 'worker_counter'];
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

    // مسح إشعارات السوق (عروض/مفاوضات/إلخ) لما المستخدم يفتح تابات السوق بتاعته
    async function markMarketNotifsRead() {
      if (!currentUser) return;
      try {
        const snap = await get(ref(db, 'notifications/' + currentUser.uid));
        if (!snap.exists()) return;
        const updates = {};
        Object.entries(snap.val()).forEach(([key, n]) => {
          if (!n.read && MARKET_NOTIF_TYPES.includes(n.type)) {
            updates[key + '/read'] = true;
          }
        });
        if (Object.keys(updates).length > 0) {
          await update(ref(db, 'notifications/' + currentUser.uid), updates);
        }
      } catch (e) { console.log('markMarketNotifsRead error', e); }
    }
    window.markMarketNotifsRead = markMarketNotifsRead;

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
      try {
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
      } catch(e) { console.error('loadChatList:', e); const _cl = document.getElementById('chat-list'); if(_cl) _cl.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:2rem;">⚠️ تعذّر تحميل المحادثات</p>'; }
    }

    async function openChat(partnerId, partner) {
      currentChatId = getChatId(currentUser.uid, partnerId);
      document.getElementById('chat-partner-name').textContent = partner.full_name || 'مستخدم';
      document.getElementById('chat-partner-role').textContent = partner.role === 'worker' ? '🔧 صنايعي' : '👤 عميل';
      document.getElementById('chat-partner-avatar').textContent = partner.role === 'worker' ? '🔧' : '👤';
      document.getElementById('chat-list-view').style.display = 'none';
      document.getElementById('chat-window-view').style.display = 'block';

      if (chatListener) { chatListener(); chatListener = null; }
      document.getElementById('chat-messages').innerHTML = ''; // تصفير الشات القديم قبل فتح شات جديد

      chatListener = onValue(ref(db, 'chats/' + currentChatId + '/messages'), (snap) => {
        const container = document.getElementById('chat-messages');
        if (!snap.exists()) { container.innerHTML = ''; return; }

        const raw = snap.val();
        // دعم حقل sender و from على حد سواء
        const entries = Object.entries(raw).sort((a, b) => ((a[1].ts || a[1].timestamp || 0) - (b[1].ts || b[1].timestamp || 0)));

        // mark unread messages as read (في تحديث منفصل، ما يكسرش الشات الحالي)
        const updates = {};
        entries.forEach(([key, m]) => {
          const msgSender = m.sender || m.from;
          if (msgSender !== currentUser.uid && !m.read) updates[key + '/read'] = true;
        });
        if (Object.keys(updates).length) {
          update(ref(db, 'chats/' + currentChatId + '/messages'), updates).catch(() => { });
        }

        // كان المستخدم لسه نازل لحد آخر الشات؟ لو كذا، نفضل ننزله بعد التحديث
        const wasNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        const seenKeys = new Set();
        entries.forEach(([key, m]) => {
          seenKeys.add(key);
          const msgSender = m.sender || m.from;
          const msgTime = m.ts || m.timestamp || Date.now();
          const isMine = msgSender === currentUser.uid;
          const readMark = isMine ? `<div class="msg-status ${m.read ? 'read' : ''}">${m.read ? '✓✓' : '✓'}</div>` : '';
          const timeStr = new Date(msgTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
          const bodyHTML = m.image
            ? `<img src="${m.image}" class="chat-img" onclick="openLightbox(this.src)"><div class="msg-time">${timeStr}</div>${readMark}`
            : `<span style="white-space:pre-line;">${m.text || ''}</span><div class="msg-time">${timeStr}</div>${readMark}`;

          let div = container.querySelector(`[data-msg-key="${key}"]`);
          if (!div) {
            // رسالة جديدة لسه ما ظهرتش — نضيفها في الآخر بدون لمس باقي الرسايل
            div = document.createElement('div');
            div.setAttribute('data-msg-key', key);
            div.className = 'msg ' + (isMine ? 'sent' : 'received');
            div.innerHTML = bodyHTML;
            container.appendChild(div);
          } else if (div.innerHTML !== bodyHTML) {
            // رسالة موجودة بس اتغيّر فيها شيء (مثلاً علامة القراية) — نحدّثها في مكانها فقط
            div.innerHTML = bodyHTML;
          }
        });

        // نشيل أي عنصر قديم اتمسح من قاعدة البيانات (نادر، بس للأمان)
        container.querySelectorAll('[data-msg-key]').forEach(el => {
          if (!seenKeys.has(el.getAttribute('data-msg-key'))) el.remove();
        });

        if (wasNearBottom) container.scrollTop = container.scrollHeight;
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
      try {
        await push(ref(db, 'chats/' + currentChatId + '/messages'), {
          text, sender: currentUser.uid,
          ts: Date.now(), read: false
        });
      } catch(e) { console.error('sendMessage:', e); showToast('⚠️ تعذّر إرسال الرسالة، تحقق من اتصالك'); input.value = text; }
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


    // ===== PRICE OFFER SYSTEM =====
    async function openPriceOfferModal(orderNum) {
      // تحقق من تطابق المهنة قبل فتح الموديل
      if (currentUser && currentProfile) {
        try {
          const orderSnap = await get(ref(db, 'service_requests/' + orderNum));
          if (orderSnap.exists()) {
            const order = orderSnap.val();
            const orderService = (order.service_type || '').trim();
            const workerTrade  = (currentProfile.trade || '').trim();

            // شيل الإيموجي والمسافات من أول النص
            const cleanService = orderService.replace(/^[^\u0621-\u064A\u0660-\u0669a-zA-Z]+/, '').trim();
            const cleanTrade   = workerTrade.replace(/^[^\u0621-\u064A\u0660-\u0669a-zA-Z]+/, '').trim();

            // لو المهنتين مختلفين امنعه
            if (cleanService && cleanTrade && !cleanService.includes(cleanTrade) && !cleanTrade.includes(cleanService)) {
              alert('⛔ مينفعش!\nأنت صنايعي ' + cleanTrade + ' ومينفعش تأخد طلب ' + cleanService + '.\nبس طلبات ' + cleanTrade + ' اللي تقدر تعرض عليها.');
              return;
            }
          }
        } catch (e) { console.error('Trade check error:', e); }
      }

      document.getElementById('price-offer-order-num').value = orderNum;
      document.getElementById('price-offer-amount').value = '';
      document.getElementById('price-offer-note').value = '';

      // ✅ بانر العروض
      const promoBanner = document.getElementById('price-offer-promo-banner');
      if (promoBanner && currentUser) {
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
          if (bannerMsg) { promoBanner.textContent = bannerMsg; promoBanner.style.display = 'block'; }
        } catch (e) { /* silent */ }
      }

      document.getElementById('price-offer-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.getElementById('price-offer-amount').focus(), 200);
    }
    window.openPriceOfferModal = openPriceOfferModal;

    function closePriceOfferModal() {
      document.getElementById('price-offer-modal').style.display = 'none';
      document.body.style.overflow = '';
    }
    window.closePriceOfferModal = closePriceOfferModal;

    async function submitPriceOffer() {
      const orderNum = document.getElementById('price-offer-order-num').value;
      const price = parseInt(document.getElementById('price-offer-amount').value);
      const note = document.getElementById('price-offer-note').value.trim();
      if (!price || price <= 0) { alert('اكتب سعر صحيح!'); return; }

      // ✅ شرط الرصيد — لازم يكون عنده رصيد أي حاجة > 0 (أو أول طلب مجاناً)
      if (currentUser) {
        try {
          const wSnap = await get(walletRef(currentUser.uid));
          const wData = wSnap.exists() ? wSnap.val() : {};
          const wBal = wData.balance || 0;
          const completedOrders = wData.completed_orders || 0;
          const pendingDebt = wData.pending_commission_debt || 0;

          // لو الرصيد صفر تماماً وعنده طلبات سابقة → امنعه
          if (wBal <= 0 && completedOrders > 0) {
            alert('❌ رصيدك في المحفظة صفر!\nمينفعش تقبل طلبات دلوقتي.\nاشحن رصيدك من صفحة المحفظة 💳');
            return;
          }
          // لو عنده دين معلق → وضّحله إن في جزء هيتخصم عند الإنجاز
          if (pendingDebt > 0) {
            const ok = confirm('⚠️ تنبيه: عندك عمولة متأخرة ' + pendingDebt + ' ج من طلبات سابقة.\nهتتخصم أوتوماتيك من رصيدك بعد إتمام هذا الطلب.\nهتكمل؟');
            if (!ok) return;
          }
        } catch (e) { console.error('Wallet check error:', e); }
      }

      const btn = document.querySelector('#price-offer-modal button[onclick="submitPriceOffer()"]');
      if (btn) { btn.disabled = true; btn.textContent = 'جاري الإرسال...'; }

      try {
        // جيب اسم الصنايعي
        const workerName = currentProfile?.full_name || 'الصنايعي';
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'price_offered',
          offered_price: price,
          offered_price_note: note || null,
          worker_name: workerName,
          worker_phone: currentProfile?.phone || '',
          worker_id: currentUser.uid
        });

        // إرسال إشعار للعميل عبر الشات
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.user_id) {
            const chatId = [currentUser.uid, order.user_id].sort().join('_');
            const chatRef = ref(db, 'chats/' + chatId + '/messages');
            const newMsgRef = push(chatRef);
            await set(newMsgRef, {
              from: currentUser.uid,
              text: '💰 عرض سعر لطلبك رقم ' + orderNum + '\n' +
                'السعر: ' + price + ' جنيه' +
                (note ? '\nملاحظة: ' + note : '') +
                '\n\nوافق أو ارفض من صفحة طلباتك.',
              timestamp: Date.now()
            });
            // ✅ Firebase notification للعميل
            await push(ref(db, 'notifications/' + order.user_id), {
              type: 'price_offered', title: '💰 عرض سعر جديد من الصنايعي!',
              body: workerName + ' عرض عليك ' + price + ' جنيه لطلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — وافق أو فاصل من طلباتك.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }

        closePriceOfferModal();
        // لو في صفحة التفاصيل — حدّثها
        const detailPage = document.getElementById('page-request-detail');
        if (detailPage && detailPage.classList.contains('active')) {
          openRequestDetail(orderNum);
        }
        alert('✅ تم إرسال عرض السعر للعميل!');
      } catch (e) {
        console.error(e);
        alert('حصل خطأ، حاول تاني.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<span>💰</span> إرسال عرض السعر للعميل'; }
      }
    }
    window.submitPriceOffer = submitPriceOffer;

    async function clientAcceptPrice(orderNum) {
      try {
        // ✅ FIX: حفظ final_price عشان العمولة تتحسب صح
        const preSnap = await get(ref(db, 'service_requests/' + orderNum));
        const finalPrice = preSnap.exists() ? (preSnap.val().offered_price || null) : null;
        const workerIdForCheck = preSnap.exists() ? preSnap.val().worker_id : null;
        if (workerIdForCheck && typeof window.getBusyWorkerIds === 'function') {
          const busyMap = await window.getBusyWorkerIds();
          if (busyMap.has(workerIdForCheck)) {
            alert('🔴 الصنايعي ده بقى مشغول بطلب تاني دلوقتي، استنى لما يخلصه.');
            return;
          }
        }
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'accepted',
          final_price: finalPrice
        });
        // إشعار الصنايعي عبر الشات
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists() && snap.val().worker_id && currentUser) {
          const order = snap.val();
          const chatId = [currentUser.uid, order.worker_id].sort().join('_');
          const chatRef = ref(db, 'chats/' + chatId + '/messages');
          await set(push(chatRef), {
            from: currentUser.uid,
            text: '✅ وافقت على عرض السعر (' + order.offered_price + ' جنيه) للطلب رقم ' + orderNum + '\nأهلاً بيك! 🙏',
            timestamp: Date.now()
          });
          // ✅ Firebase notification للصنايعي
          await push(ref(db, 'notifications/' + order.worker_id), {
            type: 'worker_accepted', title: '✅ العميل وافق على سعرك!',
            body: 'تم قبول عرضك (' + order.offered_price + ' جنيه) لطلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — ابدأ التواصل مع العميل.',
            order_num: orderNum, read: false, created_at: new Date().toISOString()
          });
        }
      } catch (e) { console.error(e); alert('حصل خطأ، حاول تاني.'); }
    }
    window.clientAcceptPrice = clientAcceptPrice;

    async function clientRejectPrice(orderNum) {
      if (!confirm('هترفض عرض السعر؟ الطلب هيرجع لحالة جديد.')) return;
      try {
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.worker_id) {
            // ✅ Firebase notification للصنايعي
            await push(ref(db, 'notifications/' + order.worker_id), {
              type: 'price_rejected', title: '❌ العميل رفض عرض السعر',
              body: 'العميل رفض عرضك (' + (order.offered_price || '') + ' جنيه) في طلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — الطلب رجع لحالة جديد.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'pending', offered_price: null, offered_price_note: null, worker_id: null, worker_name: null, worker_phone: null
        });
      } catch (e) { console.error(e); alert('حصل خطأ، حاول تاني.'); }
    }
    window.clientRejectPrice = clientRejectPrice;

    async function clientAcceptWorkerCounter(orderNum) {
      try {
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (!snap.exists()) return;
        const order = snap.val();
        if (order.worker_id && typeof window.getBusyWorkerIds === 'function') {
          const busyMap = await window.getBusyWorkerIds();
          if (busyMap.has(order.worker_id)) {
            alert('🔴 الصنايعي ده بقى مشغول بطلب تاني دلوقتي، استنى لما يخلصه.');
            return;
          }
        }
        // الموافقة على سعر الصنايعي المضاد — الطلب يبقى accepted مباشرة
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'accepted',
          offered_price: order.worker_counter_price,
          final_price: order.worker_counter_price,  // ✅ FIX: حفظ final_price
          worker_counter_price: null,
          worker_counter_note: null
        });
        // إشعار الصنايعي
        if (order.worker_id && currentUser) {
          const chatId = [currentUser.uid, order.worker_id].sort().join('_');
          await push(ref(db, 'chats/' + chatId + '/messages'), {
            from: currentUser.uid,
            text: '✅ وافقت على سعرك (' + order.worker_counter_price + ' جنيه) للطلب رقم ' + orderNum + '\nأهلاً بيك! 🙏',
            timestamp: Date.now()
          });
          await push(ref(db, 'notifications/' + order.worker_id), {
            type: 'counter_accepted', title: '✅ العميل وافق على سعرك!',
            body: 'العميل وافق على عرضك (' + order.worker_counter_price + ' جنيه) لطلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — ابدأ الشغل 🙏',
            order_num: orderNum, read: false, created_at: new Date().toISOString()
          });
        }
        loadMyOrders();
        loadClientOrders();
      } catch (e) { console.error(e); alert('حصل خطأ، حاول تاني.'); }
    }
    window.clientAcceptWorkerCounter = clientAcceptWorkerCounter;
    // ===== END PRICE OFFER SYSTEM =====

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
      // ✅ فحص الانشغال — مينفعش الصنايعي يقبل طلب جديد وهو لسه شغّال في طلب تاني
      if (currentUser && typeof window.getBusyWorkerIds === 'function') {
        try {
          const busyMap = await window.getBusyWorkerIds();
          if (busyMap.has(currentUser.uid)) {
            alert('🔴 انت مشغول بطلب تاني دلوقتي، لازم تخلصه وتأكد إنجازه الأول قبل ما تقبل طلب جديد.');
            return;
          }
        } catch (e) { console.error('busy check error:', e); }
      }
      // ✅ شرط الرصيد — لازم يكون عنده رصيد أي حاجة > 0 (أو أول طلب مجاناً)
      if (currentUser) {
        try {
          const wSnap = await get(walletRef(currentUser.uid));
          const wData = wSnap.exists() ? wSnap.val() : {};
          const wBal = wData.balance || 0;
          const completedOrders = wData.completed_orders || 0;
          const pendingDebt = wData.pending_commission_debt || 0;

          if (wBal <= 0 && completedOrders > 0) {
            // أول طلب مجاناً دايماً لأي حساب جديد
            alert('❌ رصيدك في المحفظة صفر!\nمينفعش تقبل طلبات دلوقتي.\nاشحن رصيدك من صفحة المحفظة 💳');
            return;
          }
          // لو عنده دين معلق → وضّحله
          if (pendingDebt > 0) {
            const ok = confirm('⚠️ تنبيه: عندك عمولة متأخرة ' + pendingDebt + ' ج من طلبات سابقة.\nهتتخصم أوتوماتيك من رصيدك بعد إتمام هذا الطلب.\nهتكمل؟');
            if (!ok) return;
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
          final_price: order.client_counter_price,  // ✅ FIX: حفظ final_price
          client_counter_price: null,
          client_counter_note: null,
          worker_id: currentUser.uid,
          worker_name: currentProfile?.full_name || order.worker_name || 'الصنايعي',
          worker_phone: currentProfile?.phone || order.worker_phone || ''
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

    // ===== WORKER COUNTER OFFER =====
    function openWorkerCounterModal(orderNum, clientPrice) {
      document.getElementById('wc-order-num').value = orderNum;
      document.getElementById('wc-amount').value = '';
      document.getElementById('wc-note').value = '';
      document.getElementById('wc-modal-sub').textContent = 'عرض العميل: ' + clientPrice + ' جنيه';
      document.getElementById('worker-counter-modal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
      setTimeout(() => document.getElementById('wc-amount').focus(), 200);
    }
    window.openWorkerCounterModal = openWorkerCounterModal;

    function closeWorkerCounterModal() {
      document.getElementById('worker-counter-modal').style.display = 'none';
      document.body.style.overflow = '';
    }
    window.closeWorkerCounterModal = closeWorkerCounterModal;

    async function submitWorkerCounter() {
      const orderNum = document.getElementById('wc-order-num').value;
      const price = parseInt(document.getElementById('wc-amount').value);
      const note = document.getElementById('wc-note').value.trim();
      if (!price || price <= 0) { alert('اكتب سعر صحيح!'); return; }

      const btn = document.getElementById('wc-submit-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'جاري الإرسال...'; }

      try {
        const workerName = currentProfile?.full_name || 'الصنايعي';
        // حفظ عرض الصنايعي المضاد
        await update(ref(db, 'service_requests/' + orderNum), {
          status: 'worker_counter',
          worker_counter_price: price,
          worker_counter_note: note || null,
          client_counter_price: null,
          client_counter_note: null,
          worker_id: currentUser.uid,
          worker_name: workerName,
          worker_phone: currentProfile?.phone || ''
        });

        // إشعار العميل
        const snap = await get(ref(db, 'service_requests/' + orderNum));
        if (snap.exists()) {
          const order = snap.val();
          if (order.user_id && currentUser) {
            // رسالة في الشات
            const chatId = [currentUser.uid, order.user_id].sort().join('_');
            await push(ref(db, 'chats/' + chatId + '/messages'), {
              from: currentUser.uid,
              text: '↩️ الصنايعي بيفاصل في طلب ' + orderNum +
                '\nعرضه الجديد: ' + price + ' جنيه' +
                (note ? '\nملاحظة: ' + note : '') +
                '\n\nوافق أو فاصل تاني من طلباتك.',
              timestamp: Date.now()
            });
            // إشعار
            await push(ref(db, 'notifications/' + order.user_id), {
              type: 'worker_counter',
              title: '↩️ الصنايعي رد بسعر جديد!',
              body: workerName + ' عرض ' + price + ' جنيه في طلب ' + orderNum + (order.service_type ? ' (' + order.service_type + ')' : '') + ' — وافق أو فاصل تاني.',
              order_num: orderNum, read: false, created_at: new Date().toISOString()
            });
          }
        }

        closeWorkerCounterModal();
        loadWorkerOrders();
        loadWorkerRequests();
        showToast('✅ تم إرسال عرضك للعميل!', '#3498DB');
      } catch (e) {
        console.error(e);
        alert('حصل خطأ، حاول تاني.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↩️ إرسال عرضي للعميل'; }
      }
    }
    window.submitWorkerCounter = submitWorkerCounter;
    // ===== END WORKER COUNTER OFFER =====
