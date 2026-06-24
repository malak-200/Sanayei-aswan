// ==================== PORTFOLIO / معرض الأعمال ====================
(function () {
  const MAX_PHOTOS = 10;           // الحد الأقصى للصور
  const MAX_SIZE_MB = 2;           // الحد الأقصى لحجم الصورة بالميغابايت
  const THUMB_SIZE  = 600;         // حجم الصورة المصغرة (بكسل)

  // ─── تصغير الصورة قبل الحفظ ───
  function resizeImage(dataUrl, maxSize) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.src = dataUrl;
    });
  }

  // ─── رفع صورة جديدة ───
  window.handlePortfolioUpload = async function (input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';  // reset input

    const uid = window.currentUser?.uid;
    if (!uid) { showToast('⚠️ سجل دخولك أولاً', '#E67E22'); return; }

    // تحقق الحجم
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      showToast('❌ الصورة كبيرة جداً! الحد ' + MAX_SIZE_MB + ' MB', '#E74C3C');
      return;
    }

    // اقرأ عدد الصور الحالية
    const snap = await get(ref(db, 'portfolio/' + uid));
    const current = snap.exists() ? Object.keys(snap.val()).length : 0;
    if (current >= MAX_PHOTOS) {
      showToast('⚠️ وصلت للحد الأقصى (' + MAX_PHOTOS + ' صور)', '#E67E22');
      return;
    }

    showToast('⏳ جاري رفع الصورة...', '#C8873A');

    // قراءة وتصغير
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const resized = await resizeImage(e.target.result, THUMB_SIZE);

        // احفظ في Firebase
        const newRef = push(ref(db, 'portfolio/' + uid));
        await set(newRef, {
          img: resized,
          caption: '',
          created_at: new Date().toISOString()
        });

        showToast('✅ تمت إضافة الصورة بنجاح!', '#2ECC71');
        loadPortfolio(uid);
      } catch (err) {
        console.error(err);
        showToast('❌ حصل خطأ أثناء الرفع', '#E74C3C');
      }
    };
    reader.readAsDataURL(file);
  };

  // ─── حذف صورة ───
  window.deletePortfolioPhoto = async function (photoKey) {
    const uid = window.currentUser?.uid;
    if (!uid) return;
    if (!confirm('مسح الصورة دي من معرض أعمالك؟')) return;
    try {
      await remove(ref(db, 'portfolio/' + uid + '/' + photoKey));
      showToast('🗑️ تم مسح الصورة', '#C8873A');
      loadPortfolio(uid);
    } catch (err) {
      console.error(err);
      showToast('❌ حصل خطأ', '#E74C3C');
    }
  };

  // ─── تحميل وعرض المعرض ───
  window.loadPortfolio = async function (uid) {
    const grid    = document.getElementById('portfolio-grid');
    const counter = document.getElementById('portfolio-counter');
    const trigger = document.getElementById('portfolio-upload-trigger');
    if (!grid) return;

    let photos = [];
    try {
      const snap = await get(ref(db, 'portfolio/' + uid));
      if (snap.exists()) {
        const val = snap.val();
        photos = Object.entries(val)
          .map(([key, d]) => ({ key, ...d }))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
    } catch (e) { console.error(e); }

    const count = photos.length;
    if (counter) counter.textContent = count + ' / ' + MAX_PHOTOS + ' صور';

    // أعد بناء الـ grid — خلي زر الرفع دايماً أول عنصر
    grid.innerHTML = '';

    // زر الرفع (يختفي لو وصلنا للحد)
    const isOwner = window.currentUser?.uid === uid;
    if (isOwner && count < MAX_PHOTOS) {
      const uploadBtn = document.createElement('div');
      uploadBtn.className = 'portfolio-upload-btn';
      uploadBtn.id = 'portfolio-upload-trigger';
      uploadBtn.innerHTML = '<span class="port-upload-icon">📷</span><span>أضف صورة</span>';
      uploadBtn.onclick = () => document.getElementById('portfolio-file-input').click();
      grid.appendChild(uploadBtn);
    }

    if (count === 0 && isOwner) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.3);font-size:13px;padding:20px 0;';
      empty.textContent = 'لم تضف أي صورة لمعرض أعمالك بعد 📸';
      grid.appendChild(empty);
      return;
    }

    // الصور
    photos.forEach((photo, idx) => {
      const item = document.createElement('div');
      item.className = 'portfolio-item';
      item.innerHTML = `
        <img src="${photo.img}" alt="عمل ${idx + 1}" loading="lazy">
        ${photo.caption ? `<div class="port-caption">${photo.caption}</div>` : ''}
        ${isOwner ? `<button class="port-delete-btn" onclick="event.stopPropagation();deletePortfolioPhoto('${photo.key}')" title="مسح الصورة">🗑️</button>` : ''}
      `;
      item.addEventListener('click', () => openPortfolioLightbox(photo.img, photo.caption || ('صورة ' + (idx + 1))));
      grid.appendChild(item);
    });
  };

  // ─── Global Lightbox (GLB) ───
  window.GLB = (function () {
    let _imgs   = [];   // [{src, caption}]
    let _idx    = 0;
    let _touchX = null;

    const el = () => document.getElementById('glb');
    const img = () => document.getElementById('glb-img');
    const cap = () => document.getElementById('glb-caption');
    const ctr = () => document.getElementById('glb-counter');
    const dots = () => document.getElementById('glb-dots');
    const prev = () => document.querySelector('.glb-prev');
    const next = () => document.querySelector('.glb-next');

    function _render(idx, animate) {
      if (!_imgs.length) return;
      _idx = Math.max(0, Math.min(idx, _imgs.length - 1));
      const item = _imgs[_idx];

      if (animate) {
        img().classList.add('glb-fade');
        setTimeout(() => {
          img().src = item.src;
          cap().textContent = item.caption || '';
          img().classList.remove('glb-fade');
        }, 160);
      } else {
        img().src = item.src;
        cap().textContent = item.caption || '';
      }

      // counter
      ctr().textContent = _imgs.length > 1 ? (_idx + 1) + ' / ' + _imgs.length : '';

      // arrows
      if (_imgs.length <= 1) {
        prev().setAttribute('hidden',''); next().setAttribute('hidden','');
      } else {
        prev().removeAttribute('hidden'); next().removeAttribute('hidden');
      }

      // dots (show only if ≤ 12 images)
      const d = dots();
      if (_imgs.length > 1 && _imgs.length <= 12) {
        d.innerHTML = _imgs.map((_,i) =>
          `<div class="glb-dot${i===_idx?' active':''}"></div>`).join('');
      } else { d.innerHTML = ''; }
    }

    function open(images, startIdx) {
      // images: array of {src, caption} OR single src string
      if (typeof images === 'string') images = [{src: images, caption: ''}];
      _imgs = images.map(i => typeof i === 'string' ? {src:i, caption:''} : i);
      _render(startIdx || 0, false);
      el().classList.add('glb-open');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      el().classList.remove('glb-open');
      document.body.style.overflow = '';
      setTimeout(() => { img().src = ''; }, 250);
    }

    function go(dir) { _render(_idx + dir, true); }

    // keyboard
    document.addEventListener('keydown', e => {
      if (!el().classList.contains('glb-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   go(-1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  go(1);
    });

    // swipe (touch) — attach after DOM ready
    document.addEventListener('DOMContentLoaded', function() {
      const glbEl = document.getElementById('glb');
      if (!glbEl) return;
      glbEl.addEventListener('touchstart', e => { _touchX = e.touches[0].clientX; }, {passive:true});
      glbEl.addEventListener('touchend', e => {
        if (_touchX === null) return;
        const dx = e.changedTouches[0].clientX - _touchX;
        _touchX = null;
        if (Math.abs(dx) > 50) go(dx > 0 ? -1 : 1);
      }, {passive:true});
    });

    // ── backward compat aliases ──
    window.openPortfolioLightbox = (src, caption) => open([{src, caption}], 0);
    window.closePortfolioLightbox = close;

    return { open, close, go };
  })();

  // ── Global click delegation: any img with data-glb or .glb-img opens the lightbox ──
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (t.tagName !== 'IMG') return;

    // explicit opt-in via attribute or class
    const explicit = t.hasAttribute('data-glb') || t.classList.contains('glb-img');

    // implicit: images inside portfolio-grid or modal-portfolio-grid
    const inPortfolio = t.closest('#portfolio-grid, #modal-portfolio-grid, .portfolio-item');

    if (!explicit && !inPortfolio) return;

    e.stopPropagation();

    // collect sibling images for gallery navigation
    const container = t.closest('#portfolio-grid, #modal-portfolio-grid, .portfolio-item')
                   || t.closest('[data-glb-group]')
                   || null;

    if (container) {
      const parent = container.closest('#portfolio-grid, #modal-portfolio-grid') || container.parentElement;
      const imgs = Array.from(parent.querySelectorAll('img[src]:not([src=""])'))
        .filter(i => i.src && !i.src.endsWith('#'))
        .map(i => ({ src: i.src, caption: i.getAttribute('data-caption') || i.alt || '' }));
      const idx = imgs.findIndex(i => i.src === t.src);
      GLB.open(imgs, idx >= 0 ? idx : 0);
    } else {
      GLB.open([{ src: t.src, caption: t.getAttribute('data-caption') || t.alt || '' }], 0);
    }
  });

  // ─── تحميل المعرض تلقائياً لما تفتح صفحة البروفيل ───
  // الكود ده بيتنفذ في آخر الصفحة، فـ load event ممكن يكون اتفعّل بالفعل
  // لذلك بنعمل الـ hook مباشرةً بدون window.addEventListener('load')
  (function () {
    const _origShowPage = window.showPage;
    window.showPage = function (page) {
      if (typeof _origShowPage === 'function') _origShowPage(page);
      if (page === 'profile-worker' || page === 'worker-profile') {
        const uid = window.currentUser?.uid;
        if (uid) loadPortfolio(uid);
      }
    };

    // لو الصنايعي مفتوح الصفحة مباشرة
    if (document.getElementById('page-profile-worker')?.classList.contains('active')) {
      const uid = window.currentUser?.uid;
      if (uid) loadPortfolio(uid);
    }
  })();

  // ─── تحميل المعرض عند loadWorkerProfile ───
  // نعمل hook على auth state — لما يكون الـ profile worker ظاهر يحمّل المعرض
  const _checkAndLoad = setInterval(function () {
    if (typeof window.db !== 'undefined') {
      clearInterval(_checkAndLoad);
      // onAuthStateChanged موجود من قبل — بس نراقب showPage
      // المعرض يتحمل كمان عند showPage('profile-worker')
    }
  }, 500);

})();
// ==================== END PORTFOLIO ====================

