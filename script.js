/* Basic browser helpers for the Pygame canvas page */
(() => {
  // Prevent the context menu so right-click events reach pygame
  document.addEventListener('contextmenu', (e) => {
    // Only block when right-clicking the canvas or body
    const target = e.target;
    if (target && (target.id === 'canvas' || target.tagName === 'CANVAS' || target === document.body)) {
      e.preventDefault();
    }
  }, { capture: true });

  // Focus canvas on click so keyboard events reach pygame
  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.addEventListener('click', () => {
      try { canvas.focus(); } catch (_) {}
    });
  }

  // Resize hint: CSS already scales the canvas; just keep full-viewport
  const resize = () => {
    // Nothing special needed; CSS width/height are 100vw/100vh.
    // If you want letterboxing instead of stretch, ensure Python side sets the aspect via set_mode.
  };
  window.addEventListener('resize', resize);
  resize();

  // Optional: prevent pinch-zoom on mobile
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
})();
