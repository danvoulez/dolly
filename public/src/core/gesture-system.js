// public/src/core/gesture-system.js
/**
 * Sistema de gestos (swipe, tap) para desktop e mobile
 */
export class GestureSystem {
  registerSwipe(element, direction, threshold, callback) {
    let startX, startY, isSwiping = false;
    const thresholdPx = threshold * window.innerWidth;

    // Touch
    element.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isSwiping = true;
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      e.preventDefault();
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
      if (!isSwiping) return;
      this._checkSwipe(e.changedTouches[0].clientX, e.changedTouches[0].clientY, startX, startY, direction, thresholdPx, callback);
      isSwiping = false;
    }, { passive: true });

    // Mouse
    let mouseMoveHandler, mouseUpHandler;
    element.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      isSwiping = true;
      mouseMoveHandler = () => {};
      mouseUpHandler = (upEvent) => {
        if (!isSwiping) return;
        this._checkSwipe(upEvent.clientX, upEvent.clientY, startX, startY, direction, thresholdPx, callback);
        isSwiping = false;
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
      };
      document.addEventListener('mousemove', mouseMoveHandler);
      document.addEventListener('mouseup', mouseUpHandler);
    });
  }

  _checkSwipe(endX, endY, startX, startY, direction, thresholdPx, callback) {
    const diffX = endX - startX;
    const diffY = endY - startY;
    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (direction === 'left' && diffX < -thresholdPx) callback();
      else if (direction === 'right' && diffX > thresholdPx) callback();
    }
  }
}

// Singleton
export const gestureSystem = new GestureSystem();