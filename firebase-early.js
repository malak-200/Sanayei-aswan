// ===== EARLY PAGE SWITCHER (يشتغل فوراً قبل Firebase) =====
    function _earlyShowPage(name) {
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
      var el = document.getElementById('page-' + name);
      if (el) { el.classList.add('active'); window.scrollTo(0, 0); }
    }
    // تعريف مبكر للزرارين علشان يشتغلوا حتى لو Firebase اتأخر
    window._earlyShowPage = _earlyShowPage;