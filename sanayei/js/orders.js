    // ===== فحص جودة وسلامة صورة البطاقة (وش / ضهر) =====
    // الفحص ده تقني بالكامل (دقة، إضاءة، وضوح، نسبة الأبعاد) ومش بيتأكد من صحة بيانات البطاقة نفسها
    // لأن ده محتاج خدمة OCR/تحقق حكومي خارجي. الهدف إنه يرفض الصور الواضح إنها مش صورة بطاقة سليمة.
    function _loadImageFromFile(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('الملف ده مش صورة سليمة')); };
        img.src = url;
      });
    }

    function analyzeIdCardImage(img) {
      const issues = [];
      const warnings = [];

      // 1) الدقة - لازم تكون عالية بما يكفي إن البيانات تتقرى
      const minWidth = 480, minHeight = 300;
      if (img.naturalWidth < minWidth || img.naturalHeight < minHeight) {
        issues.push('الصورة دقتها منخفضة جداً، صعب نقرا البيانات منها');
      }

      // 2) نسبة الأبعاد - البطاقة الشخصية المصرية شكلها مستطيل بنسبة قريبة من 1.59:1 (زي الكارنيهات)
      const ratio = Math.max(img.naturalWidth, img.naturalHeight) / Math.min(img.naturalWidth, img.naturalHeight);
      if (ratio < 1.25 || ratio > 2.3) {
        warnings.push('شكل الصورة مش قريب من شكل البطاقة الشخصية المعتاد، تأكد إنك مصور البطاقة كاملة وبدون قص زيادة');
      }

      // 3) تحليل البكسلات (سطوع + تباين + تقدير وضوح تقريبي) عبر canvas
      const canvas = document.createElement('canvas');
      const sampleW = 200; // تصغير الصورة عشان التحليل يكون سريع
      const sampleH = Math.round(sampleW * (img.naturalHeight / img.naturalWidth));
      canvas.width = sampleW; canvas.height = sampleH || sampleW;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, sampleW, canvas.height);
      let pixels;
      try {
        pixels = ctx.getImageData(0, 0, sampleW, canvas.height).data;
      } catch (e) {
        // لو الصورة من مصدر برضو مش قادر نقراها (نادر، CORS مثلاً) - نتجاهل فحص البكسل بس من غير ما نفشل الرفع كله
        return { issues, warnings, brightness: null, sharpness: null };
      }

      // تحويل لمصفوفة درجات رمادي عشان حسابات السطوع والوضوح
      const gray = new Uint8ClampedArray(sampleW * canvas.height);
      for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        gray[p] = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      }

      // السطوع المتوسط (0-255)
      let sum = 0;
      for (let i = 0; i < gray.length; i++) sum += gray[i];
      const brightness = sum / gray.length;

      if (brightness < 35) issues.push('الصورة غامقة جداً، صورها في إضاءة أحسن');
      else if (brightness > 235) issues.push('الصورة فيها انعكاس/إضاءة زيادة وبيانات البطاقة مش واضحة');

      // تقدير الوضوح بطريقة تقريبية (فرق البكسلات المتجاورة - مؤشر على وجود حواف/تفاصيل)
      // الصور المهزوزة/المموهة بيكون التغيّر بين البكسلات المتجاورة قليل جداً
      let edgeSum = 0, edgeCount = 0;
      const w = sampleW, h = canvas.height;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          const gx = gray[idx + 1] - gray[idx - 1];
          const gy = gray[idx + w] - gray[idx - w];
          edgeSum += Math.abs(gx) + Math.abs(gy);
          edgeCount++;
        }
      }
      const sharpness = edgeCount ? edgeSum / edgeCount : 0;
      if (sharpness < 4) issues.push('الصورة مش واضحة (مهزوزة أو غير مركّزة)، حاول تاني وثبّت الكاميرا وقت التصوير');

      return { issues, warnings, brightness, sharpness };
    }

    async function handleIdCardUpload(input, side) {
      const file = input.files[0];
      const previewEl = document.getElementById('reg-id-' + side + '-preview');
      const statusEl = document.getElementById('reg-id-' + side + '-status');
      if (!file) { previewEl.innerHTML = ''; statusEl.innerHTML = ''; return; }

      statusEl.innerHTML = '<span style="color:rgba(255,255,255,0.5);">⏳ جاري فحص الصورة...</span>';
      previewEl.innerHTML = '';

      // لازم يكون فعلاً ملف صورة
      if (!file.type.startsWith('image/')) {
        statusEl.innerHTML = '<span style="color:#E74C3C;">❌ الملف ده لازم يكون صورة (jpg, png...)</span>';
        input.value = '';
        window['_idCard' + (side === 'front' ? 'Front' : 'Back')] = null;
        return;
      }
      // حجم معقول (لا صورة فاضية جداً ولا ملف ضخم جداً)
      if (file.size < 8 * 1024) {
        statusEl.innerHTML = '<span style="color:#E74C3C;">❌ حجم الصورة صغير جداً، يبدو إن الملف فاسد أو فاضي</span>';
        input.value = '';
        window['_idCard' + (side === 'front' ? 'Front' : 'Back')] = null;
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        statusEl.innerHTML = '<span style="color:#E74C3C;">❌ حجم الصورة كبير جداً (أقصى حد 12 ميجا)</span>';
        input.value = '';
        window['_idCard' + (side === 'front' ? 'Front' : 'Back')] = null;
        return;
      }

      try {
        const img = await _loadImageFromFile(file);
        const { issues, warnings } = analyzeIdCardImage(img);

        const reader = new FileReader();
        reader.onload = e => {
          previewEl.innerHTML = `<div style="position:relative;display:inline-block;">
            <img src="${e.target.result}" style="max-width:220px;max-height:140px;border-radius:10px;border:2px solid ${issues.length ? '#E74C3C' : 'rgba(46,204,113,0.6)'};object-fit:contain;background:#000;">
          </div>`;
        };
        reader.readAsDataURL(file);

        if (issues.length) {
          statusEl.innerHTML = '<span style="color:#E74C3C;">❌ ' + issues.join(' · ') + ' — من فضلك صور البطاقة تاني</span>';
          window['_idCard' + (side === 'front' ? 'Front' : 'Back')] = null;
        } else {
          const warnTxt = warnings.length ? ' (' + warnings.join(' · ') + ')' : '';
          statusEl.innerHTML = '<span style="color:#2ECC71;">✅ الصورة واضحة وتم قبولها' + warnTxt + '</span>';
          window['_idCard' + (side === 'front' ? 'Front' : 'Back')] = file;
        }
      } catch (e) {
        statusEl.innerHTML = '<span style="color:#E74C3C;">❌ ' + (e.message || 'حصل خطأ في فحص الصورة') + '</span>';
        input.value = '';
        window['_idCard' + (side === 'front' ? 'Front' : 'Back')] = null;
      }
    }
    window.handleIdCardUpload = handleIdCardUpload;

    // ===== WORKER REQUESTS PAGE =====
    let allWorkerReqs = [];
    let currentReqFilter = 'all';

    async function loadWorkerRequests() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      try {
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
      } catch(e) { console.error('loadWorkerRequests:', e); }
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
      const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️', 'دلفري': '🚚' };

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
          <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:2px;">👤 ${o.client_name || '-'}${['accepted','worker_done_pending','client_initiated_done','done'].includes(o.status) && o.client_phone ? ' · 📞 ' + o.client_phone : ''}</div>
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
      const statusColors = { pending: '#F39C12', price_offered: '#9B59B6', accepted: '#2ECC71', worker_done_pending: '#C8873A', client_initiated_done: '#2ECC71', done: '#27AE60', cancelled: '#E74C3C' };
      const statusTxt = { pending: '⏳ جديد', price_offered: '💰 عرض سعر', client_counter: '🤝 العميل فاصل', accepted: '✓ مقبول', worker_done_pending: '⏳ بانتظار العميل', client_initiated_done: '🏁 العميل قال خلص — أكّد؟', done: '✓ منجز', cancelled: '✗ ملغي' };
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
        ${['accepted','worker_done_pending','client_initiated_done','done'].includes(o.status) && o.client_phone
          ? `<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:4px;">📞 ${o.client_phone}</div>`
          : ''}
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
      ${o.details && Object.keys(o.details).length ? `<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;">📋 تفاصيل ${o.service_type || 'الخدمة'}</div>
        ${formatProfessionDetailsHTML(o.details)}
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
            // جيب المحافظ عشان نعد بس اللي رصيده أكتر من صفر أو معملوش طلبات
            let wallets = {};
            try {
              const wSnap = await get(ref(db, 'wallets'));
              if (wSnap.exists()) wallets = wSnap.val();
            } catch (e) {}
            const list = allList
              .filter(([uid, c]) => {
                if (!c.available) return false;
                const bal = wallets[uid]?.balance ?? 0;
                return bal > 0; // يظهر بس لو عنده رصيد
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
          // لو الـ wallets node نفسه مش موجود في Firebase خالص = فشل التحميل → ظهّر الكل
          // لو موجود بس صنايعي مش فيه = رصيده 0 فعلاً → يتخفى
          const walletsData = wSnap.exists() ? wSnap.val() : null;
          // الصنايعية المشغولين بطلب شغّال دلوقتي — هيتخفوا من القايمة لحد ما يخلصوا
          let busyMap = new Map();
          if (typeof window.getBusyWorkerIds === 'function') {
            try { busyMap = await window.getBusyWorkerIds(); } catch (e) { console.error('busy fetch error:', e); }
          }
          craftsmen = Object.entries(cSnap.val()).map(([id, c]) => {
            const p = profiles[id] || {};
            const w = walletsData ? (walletsData[id] || {}) : null;
            // w = null → Firebase مش شغال → wallet_balance = -1 (يظهر)
            // w = {} → مفيش record → wallet_balance = 0 (يتخفى)
            // w = {balance: X} → wallet_balance = X
            let walletBal;
            if (w === null) {
              walletBal = -1; // Firebase مش شغال، ظهّره
            } else {
              walletBal = typeof w.balance === 'number' ? w.balance : 0;
            }
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
              has_balance: c.has_balance, // من الـ craftsmen node مباشرة
              emoji: c.emoji || '🔧',
              phone: c.phone || p.phone || '',
              bio: c.bio || p.bio || '',
              photo: c.photo || p.photo || p.avatar_url || '',
              wallet_balance: walletBal,
              completed_orders: w ? (w.completed_orders ?? 0) : 0,
              is_busy: busyMap.has(id)
            };
          });
        }
        filterCards();
      } catch (e) { craftsmen = []; filterCards(); }
    }
    window.loadCraftsmen = loadCraftsmen;

    // ===== RENDER CRAFTSMEN =====

    // ===== WORKER ORDERS =====
    async function loadWorkerOrders() {
      if (!currentUser || currentProfile?.role !== 'worker') return;
      const list = document.getElementById('worker-orders-list');
      if (!list) return;
      try {
        const snap = await get(ref(db, 'service_requests'));
        if (!snap.exists()) return;
        const allOrders = Object.values(snap.val());
        const active = allOrders
          .filter(o => o.worker_id === currentUser.uid && o.status !== 'cancelled')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
        if (!active.length) {
          list.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:1.5rem;font-size:14px;">لا توجد طلبات جارية</p>';
          return;
        }
        const statusMap = { pending: { cls: 'pending', txt: '⏳ جاري' }, price_offered: { cls: 'pending', txt: '💰 عرض سعر — بانتظار العميل' }, client_counter: { cls: 'pending', txt: '🤝 العميل فاصل — بانتظار ردك' }, accepted: { cls: 'pending', txt: '✓ العميل وافق' }, worker_done_pending: { cls: 'worker-done', txt: '⏳ بانتظار تأكيد العميل' }, done: { cls: 'done', txt: '✓ منجز' }, cancelled: { cls: 'cancelled', txt: '✗ ملغي' } };
        const emojiMap = { 'كهرباء': '⚡', 'سباكة': '🔩', 'نجارة': '🪵', 'دهانات': '🎨', 'تكييف': '❄️', 'بناء': '🏗️', 'دلفري': '🚚' };
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
        if (!snap.exists()) { container.innerHTML = ''; return; }
        const raw = snap.val();
        // دعم حقل sender و from على حد سواء
        const entries = Object.entries(raw).sort((a, b) => ((a[1].ts || a[1].timestamp || 0) - (b[1].ts || b[1].timestamp || 0)));
        // mark unread as read
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
          const bodyHTML = `<span style="white-space:pre-line;">${m.text || ''}</span><div class="msg-time">${timeStr}</div>${readMark}`;

          let div = container.querySelector(`[data-msg-key="${key}"]`);
          if (!div) {
            div = document.createElement('div');
            div.setAttribute('data-msg-key', key);
            div.className = 'msg ' + (isMine ? 'sent' : 'received');
            div.innerHTML = bodyHTML;
            container.appendChild(div);
          } else if (div.innerHTML !== bodyHTML) {
            div.innerHTML = bodyHTML;
          }
        });

        container.querySelectorAll('[data-msg-key]').forEach(el => {
          if (!seenKeys.has(el.getAttribute('data-msg-key'))) el.remove();
        });

        if (wasNearBottom) container.scrollTop = container.scrollHeight;
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
      try {
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
            // سجّل اسم وتليفون الصنايعي في الطلب عشان العميل يشوفهم
            await update(ref(db, 'service_requests/' + order.order_number), { worker_name: workerName, worker_phone: currentProfile?.phone || '' });
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
      } catch(e) { console.error('updateOrderStatus:', e); showToast('❌ حصل خطأ في تحديث الطلب، حاول تاني'); }
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
            // خصم العمولة من محفظة الصنايعي (مع دعم الخصم الجزئي وتسجيل الدين)
            try {
              const workerUid = order.worker_id;
              const price = parseFloat(order.final_price || order.budget || order.price || 0);
              if (price > 0 && typeof window.getEffectiveCommission === 'function') {
                const wSnap = await get(walletRef(workerUid));
                const wData = wSnap.exists() ? wSnap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
                const promoResult = await window.getEffectiveCommission(workerUid, price, wData.completed_orders || 0, typeof order.commission_rate_override === 'number' ? order.commission_rate_override : undefined, typeof order.commission_amount_override === 'number' ? order.commission_amount_override : undefined);
                const totalCommission = promoResult.commission;
                const currentBal = wData.balance || 0;
                const existingDebt = wData.pending_commission_debt || 0;
                // اخصم اللي موجود في الرصيد، والباقي يتسجل دين
                const deductNow = Math.min(currentBal, totalCommission);
                const debtToAdd = totalCommission - deductNow;
                const newBal = currentBal - deductNow;
                const newDed = (wData.total_deducted || 0) + deductNow;
                const newDebt = existingDebt + debtToAdd;
                const completed = (wData.completed_orders || 0) + 1;
                await set(walletRef(workerUid), { ...wData, balance: newBal, total_deducted: newDed, completed_orders: completed, pending_commission_debt: newDebt });
                await update(ref(db, 'craftsmen/' + workerUid), { available: newBal > 0 }); // يتخفى أوتوماتيك لو رصيده صفر
                await push(walletTxnRef(workerUid), {
                  type: 'commission', amount: totalCommission,
                  deducted_now: deductNow, debt_added: debtToAdd,
                  description: 'عمولة طلب #' + orderNum + ' (' + (order.service_type || '') + ')',
                  order_num: orderNum, rate: promoResult.rate, order_price: price,
                  promo: promoResult.promo || null, created_at: new Date().toISOString()
                });
                let notifBody = 'طلب #' + orderNum + ' — ' + price + ' ج × ' + (promoResult.rate * 100).toFixed(0) + '% = ' + totalCommission + ' ج.';
                if (deductNow < totalCommission) {
                  notifBody += '\nتم خصم ' + deductNow + ' ج الآن — باقي ' + debtToAdd + ' ج هيتخصم لما تشحن 💳';
                } else {
                  notifBody += ' رصيدك: ' + newBal + ' ج';
                }
                await push(ref(db, 'notifications/' + workerUid), {
                  type: debtToAdd > 0 ? 'wallet_partial_deduction' : 'wallet_deduction',
                  title: deductNow < totalCommission ? '⚠️ عمولة جزئية — في باقي عليك' : '💳 تم خصم عمولة من محفظتك',
                  body: notifBody,
                  read: false, created_at: new Date().toISOString()
                });
              }
            } catch (commErr) { console.error('Commission deduction error:', commErr); }
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
          // خصم العمولة من محفظة الصنايعي (مع دعم الخصم الجزئي وتسجيل الدين)
          try {
            const workerUid = currentUser.uid;
            const price = parseFloat(order.final_price || order.budget || order.price || 0);
            if (price > 0 && typeof window.getEffectiveCommission === 'function') {
              const wSnap = await get(walletRef(workerUid));
              const wData = wSnap.exists() ? wSnap.val() : { balance: 0, total_deposited: 0, total_deducted: 0, completed_orders: 0 };
              const promoResult = await window.getEffectiveCommission(workerUid, price, wData.completed_orders || 0, typeof order.commission_rate_override === 'number' ? order.commission_rate_override : undefined, typeof order.commission_amount_override === 'number' ? order.commission_amount_override : undefined);
              const totalCommission = promoResult.commission;
              const currentBal = wData.balance || 0;
              const existingDebt = wData.pending_commission_debt || 0;
              // اخصم اللي موجود في الرصيد، والباقي يتسجل دين
              const deductNow = Math.min(currentBal, totalCommission);
              const debtToAdd = totalCommission - deductNow;
              const newBal = currentBal - deductNow;
              const newDed = (wData.total_deducted || 0) + deductNow;
              const newDebt = existingDebt + debtToAdd;
              const completed = (wData.completed_orders || 0) + 1;
              await set(walletRef(workerUid), { ...wData, balance: newBal, total_deducted: newDed, completed_orders: completed, pending_commission_debt: newDebt });
              await update(ref(db, 'craftsmen/' + workerUid), { available: newBal > 0 }); // يتخفى أوتوماتيك لو رصيده صفر
              await push(walletTxnRef(workerUid), {
                type: 'commission', amount: totalCommission,
                deducted_now: deductNow, debt_added: debtToAdd,
                description: 'عمولة طلب #' + orderNum + ' (' + (order.service_type || '') + ')',
                order_num: orderNum, rate: promoResult.rate, order_price: price,
                promo: promoResult.promo || null, created_at: new Date().toISOString()
              });
              let notifBody = 'طلب #' + orderNum + ' — ' + price + ' ج × ' + (promoResult.rate * 100).toFixed(0) + '% = ' + totalCommission + ' ج.';
              if (deductNow < totalCommission) {
                notifBody += '\nتم خصم ' + deductNow + ' ج الآن — باقي ' + debtToAdd + ' ج هيتخصم لما تشحن 💳';
              } else {
                notifBody += ' رصيدك: ' + newBal + ' ج';
              }
              await push(ref(db, 'notifications/' + workerUid), {
                type: debtToAdd > 0 ? 'wallet_partial_deduction' : 'wallet_deduction',
                title: deductNow < totalCommission ? '⚠️ عمولة جزئية — في باقي عليك' : '💳 تم خصم عمولة من محفظتك',
                body: notifBody,
                read: false, created_at: new Date().toISOString()
              });
              const toastMsg = promoResult.promo === 'first_month'
                  ? '🌟 عرض الشهر الأول: تم خصم ' + deductNow + ' ج فقط (5%)' + (debtToAdd > 0 ? ' — وباقي ' + debtToAdd + ' ج عليك' : '')
                  : debtToAdd > 0
                    ? '⚠️ تم خصم ' + deductNow + ' ج — وباقي ' + debtToAdd + ' ج عمولة هتتخصم لما تشحن'
                    : '💳 تم خصم عمولة ' + totalCommission + ' ج من محفظتك';
              showToast(toastMsg, debtToAdd > 0 ? '#E67E22' : (promoResult.promo === 'first_month' ? '#2ECC71' : '#C8873A'));
              if (document.getElementById('page-wallet')?.classList.contains('active')) loadWallet();
            }
          } catch (commErr) { console.error('Commission deduction error:', commErr); }
        }
        loadWorkerOrders();
        loadWorkerRequests();
        showToast('✅ تم إغلاق الطلب بنجاح!', '#27AE60');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.workerConfirmClientDone = workerConfirmClientDone;

    async function workerDenyClientDone(orderNum) {
      if (!currentUser) return;
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
        _stopRequestDetailListener();
        const onDetailPage = document.getElementById('page-request-detail')?.classList.contains('active');
        if (onDetailPage) {
          showPage('worker-requests');
        } else {
          loadWorkerRequests();
        }
        showToast('⚠️ أبلغنا العميل — الطلب رجع لحالة مقبول', '#E67E22');
      } catch (e) { console.error(e); showToast('❌ حصل خطأ'); }
    }
    window.workerDenyClientDone = workerDenyClientDone;
    // ===== END WORKER CONFIRMS CLIENT DONE =====
