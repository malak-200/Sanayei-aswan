function switchGuideTab(tab, btn) {
    document.querySelectorAll('.guide-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.guide-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('guide-' + tab).classList.add('active');
  }
  window.switchGuideTab = switchGuideTab;