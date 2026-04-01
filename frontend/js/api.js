function readSiteBootstrap() {
  const el = document.getElementById('site-bootstrap');
  if (!el) return null;

  try {
    return JSON.parse(el.textContent || 'null');
  } catch {
    return null;
  }
}

const BOOTSTRAP_SITE = readSiteBootstrap();
const ACTIVE_SITE = BOOTSTRAP_SITE?.business?.slug
  ? {
      api: {
        baseUrl: window.location.origin,
        slug: BOOTSTRAP_SITE.business.slug,
      },
    }
  : SITE;
const API_BASE = ACTIVE_SITE.api.baseUrl || window.location.origin;

export async function createLead(slug, data) {
  const businessSlug = slug || ACTIVE_SITE.api.slug;
  const res = await fetch(`${API_BASE}/api/public/${businessSlug}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(
      typeof body.error === 'string' ? body.error : 'Request failed'
    );
  }

  return body;
}
