(function () {
  const root = document.documentElement;
  // Supplemental UI translations. Proper names and file names are left intact.
  const pairs = [
    ['DOWNLOADS','ดาวน์โหลด'], ['INFO & STATUS','ข้อมูลและสถานะ'], ['UPTIME','เวลาการทำงาน'],
    ['NEXT BIRTHDAY','วันเกิดครั้งถัดไป'], ['SKILLS & EXPERTISE','ทักษะและความเชี่ยวชาญ'],
    ['Apps by SEEN','แอปโดย SEEN'], ['Windows & Android','สำหรับ Windows และ Android'],
    ['BASE SPEC','อุปกรณ์หลัก'], ['SYSTEM','ระบบ'], ['GRAPHICS CARD','การ์ดจอ'], ['MEMORY','หน่วยความจำ'],
    ['SUBTOTAL','รวมราคา'], ['Copy','คัดลอก'], ['Copied! ✓','คัดลอกแล้ว! ✓'],
    ['Home','หน้าหลัก'], ['Story','เรื่องราว'], ['Certificates','เกียรติบัตร'], ['Downloads','ดาวน์โหลด'],
    ['Source code','ซอร์สโค้ด'], ['Source','ซอร์สโค้ด']
  ];
  const dictionary = new Map();
  for (const pair of pairs) for (const value of pair) dictionary.set(value, pair);
  function value(text) {
    const trimmed = text.trim(); const pair = dictionary.get(trimmed);
    if (pair) return text.replace(trimmed, pair[root.lang === 'th' ? 1 : 0]);
    return text;
  }
  function translate(scope) {
    if (scope.nodeType === Node.TEXT_NODE) {
      if (!scope.parentElement?.closest('script,style,textarea,.download-name')) {
        const translated = value(scope.nodeValue); if (translated !== scope.nodeValue) scope.nodeValue = translated;
      }
      return;
    }
    if (scope.nodeType !== Node.ELEMENT_NODE || scope.matches('script,style,textarea,.download-name')) return;
    for (const attribute of ['title','aria-label','placeholder']) if (scope.hasAttribute(attribute)) {
      const before = scope.getAttribute(attribute), after = value(before);
      if (before !== after) scope.setAttribute(attribute, after);
    }
    for (const child of scope.childNodes) translate(child);
  }
  // Keep the existing page language switch and its fade effects.
  const setLanguage = window.setLanguage;
  window.setLanguage = function (lang) { setLanguage(lang); translate(document.body); };
  translate(document.body);
  // Added UI text needs translation; timer ticks and attribute changes do not
  // require rescanning their subtrees on every animation/scroll frame.
  new MutationObserver(records => {
    for (const record of records) {
      if (record.target.parentElement?.closest('#personal-status-section')) continue;
      for (const node of record.addedNodes) translate(node);
    }
  }).observe(document.body, {subtree:true, childList:true});
  const paused = new Set();
  function syncPageActivity() {
    root.classList.toggle('page-suspended', document.hidden);
    if(document.hidden) {
      for(const animation of document.getAnimations()) if(animation.playState === 'running') {
        paused.add(animation); animation.pause();
      }
    } else {
      for(const animation of paused) if(animation.playState === 'paused' && animation.effect?.target?.isConnected) animation.play();
      paused.clear();
    }
  }
  document.addEventListener('visibilitychange', syncPageActivity);
  syncPageActivity();
})();
