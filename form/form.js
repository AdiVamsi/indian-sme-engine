'use strict';

(function () {
  const formEl    = document.getElementById('enquiry-form');
  const formWrap  = document.getElementById('form-wrap');
  const successEl = document.getElementById('success-state');
  const errorEl   = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-btn');
  const anotherBtn = document.getElementById('btn-another');

  if (!formEl) return;

  const slug = formEl.dataset.slug;

  /* ── Submit ── */
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const body = {
      name:    formEl.elements['name'].value.trim(),
      phone:   formEl.elements['phone'].value.trim(),
      email:   formEl.elements['email'].value.trim() || undefined,
      message: formEl.elements['message'].value.trim() || undefined,
      hp:      formEl.elements['hp'].value,
    };

    try {
      const res  = await fetch(`/api/public/${slug}/leads`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok) {
        formWrap.classList.add('form-wrap--hidden');
        successEl.classList.add('visible');
        return;
      }

      /* Rate-limit gives a generic message; validation gives a specific one */
      errorEl.textContent = data.error || 'Something went wrong. Please try again.';
    } catch {
      errorEl.textContent = 'Network error. Please check your connection and try again.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send enquiry';
    }
  });

  /* ── Reset to empty form ── */
  if (anotherBtn) {
    anotherBtn.addEventListener('click', () => {
      formEl.reset();
      errorEl.textContent = '';
      formWrap.classList.remove('form-wrap--hidden');
      successEl.classList.remove('visible');
      formEl.elements['name'].focus();
    });
  }
})();
