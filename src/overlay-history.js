// src/overlay-history.js

export function pushOverlayState(id, data = {}) {
  window.history.pushState({ yantaOverlay: id, ...data }, '');
}

export function closeTopOverlay(closeCallback) {
  if (typeof closeCallback === 'function') {
    closeCallback();
  }
  window.history.back(); 
}

export function setupOverlayHistoryRouter() {
  window.addEventListener('popstate', (event) => {
    const state = event.state;
    const targetOverlayId = state?.yantaOverlay || null;

    // Dispatch the target ID so feature modules can open/close their UIs accordingly
    window.dispatchEvent(new CustomEvent('yanta-overlay-route', {
      detail: { id: targetOverlayId, state: state }
    }));
  });

  // Handle Escape key to behave exactly like native back button
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (window.history.state?.yantaOverlay) {
        window.history.back();
      }
    }
  });
}