function openLightbox(src) { var lb = document.getElementById('img-lightbox'); document.getElementById('img-lightbox-src').src = src; lb.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    function closeLightbox() { var lb = document.getElementById('img-lightbox'); lb.style.display = 'none'; document.getElementById('img-lightbox-src').src = ''; document.body.style.overflow = ''; }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
    window.openLightbox = openLightbox; window.closeLightbox = closeLightbox;