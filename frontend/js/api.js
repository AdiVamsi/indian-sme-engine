const API_BASE = SITE.api.baseUrl;

export async function createLead(slug, data) {
  const res = await fetch(`${API_BASE}/api/public/${slug}/leads`, {
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
