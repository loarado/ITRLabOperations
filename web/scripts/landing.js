'use strict';

document.querySelectorAll('.launch-button').forEach((button) => {
  const centerShine = () => {
    button.style.setProperty('--mx', '50%');
    button.style.setProperty('--my', '50%');
  };
  const trackShine = (event) => {
    const bounds = button.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    button.style.setProperty('--mx', `${x * 100}%`);
    button.style.setProperty('--my', `${y * 100}%`);
  };

  centerShine();
  button.addEventListener('pointerenter', trackShine);
  button.addEventListener('pointermove', trackShine);
  button.addEventListener('pointerleave', centerShine);
  button.addEventListener('focus', centerShine);
});
