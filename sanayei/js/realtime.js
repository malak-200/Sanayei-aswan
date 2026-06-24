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
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
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

