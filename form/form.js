'use strict';

(function () {
  const formEl = document.getElementById('enquiry-form');
  const formWrap = document.getElementById('form-wrap');
  const successEl = document.getElementById('success-state');
  const errorEl = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-btn');
  const anotherBtn = document.getElementById('btn-another');

  if (!formEl) return;

  const slug = formEl.dataset.slug;

  /* ── Validation helpers ── */
  const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validate(body) {
    if (!body.name || body.name.length < 2) return 'Please enter your name (at least 2 characters).';
    if (!body.phone) return 'Please enter your phone number.';
    if (!PHONE_RE.test(body.phone)) return 'Please enter a valid phone number.';
    const digits = body.phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return 'Phone number must have 7–15 digits.';
    if (body.email && !EMAIL_RE.test(body.email)) return 'Please enter a valid email address.';
    return null;
  }

  /* ── Submit ── */
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const body = {
      name: formEl.elements['name'].value.trim(),
      phone: formEl.elements['phone'].value.trim(),
      email: formEl.elements['email'].value.trim() || undefined,
      message: formEl.elements['message'].value.trim() || undefined,
      hp: formEl.elements['hp'].value,
    };

    /* Client-side validation */
    const err = validate(body);
    if (err) {
      errorEl.textContent = err;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch(`/api/public/${slug}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

