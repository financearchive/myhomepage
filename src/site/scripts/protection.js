// 우클릭 방지
document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  return false;
});

// 키보드 단축키 방지 (Ctrl+A, Ctrl+C, Ctrl+V, F12 등)
document.addEventListener('keydown', function(e) {
  // Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+S
  if (e.ctrlKey && (e.key === 'a' || e.key === 'c' || e.key === 'v' || e.key === 's')) {
    e.preventDefault();
    return false;
  }
  
  // F12 (개발자도구)
  if (e.key === 'F12') {
    e.preventDefault();
    return false;
  }
  
  // Ctrl+Shift+I (개발자도구)
  if (e.ctrlKey && e.shiftKey && e.key === 'I') {
    e.preventDefault();
    return false;
  }
});

// 텍스트 선택 방지
document.onselectstart = function() {
  return false;
};

// 드래그 방지
document.ondragstart = function() {
  return false;
};
