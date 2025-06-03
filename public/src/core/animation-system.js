// public/src/core/animation-system.js
/**
 * Sistema de animações e feedback sensível à acessibilidade
 */
export class AnimationSystem {
  constructor() {
    this.prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  animateElement(target, animation) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!element) return;

    if (this.prefersReducedMotion) {
      // Aplica estilo final somente se movimento for reduzido
      if (animation.keyframes && animation.keyframes.length) {
        Object.assign(element.style, animation.keyframes[animation.keyframes.length - 1]);
      }
      return;
    }

    element.animate(
      animation.keyframes,
      {
        duration: animation.duration || 300,
        easing: animation.easing || 'ease-in-out',
        fill: 'forwards'
      }
    );
  }

  scrollIntoView(selector, options = {}) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (el) el.scrollIntoView({ behavior: this.prefersReducedMotion ? 'auto' : (options.behavior || 'smooth'), block: options.block || 'nearest' });
  }

  playSound(sound) {
    // Caminho relativo a /sounds/
    const audio = new Audio(`/sounds/${sound}.mp3`);
    audio.play().catch(() => {});
  }

  hapticImpact(pattern = 10) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }
}

// Singleton
export const animationSystem = new AnimationSystem();