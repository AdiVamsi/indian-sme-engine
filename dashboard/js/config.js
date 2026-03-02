/**
 * config.js — Multi-tenant, domain-aware configuration.
 *
 * Single source of truth for all environment-dependent values.
 * Nothing outside this file should contain a hostname, port, or slug logic.
 *
 * ── Hostname classification ──────────────────────────────────────────────
 *
 *  localhost / 127.0.0.1
 *    → local development
 *    → BUSINESS_SLUG = null  (login form shows the slug input)
 *
 *  indian-sme.com
 *    → platform root (main marketing / login page)
 *    → BUSINESS_SLUG = null
 *
 *  app.indian-sme.com  /  www.indian-sme.com  (reserved subdomains)
 *    → platform app entry, not a tenant
 *    → BUSINESS_SLUG = null
 *
 *  academy.indian-sme.com  (non-reserved subdomain of the platform domain)
 *    → platform-hosted tenant
 *    → BUSINESS_SLUG = 'academy'
 *
 *  crm.sharmajeeacademy.com  (custom domain with a vanity subdomain prefix)
 *    → custom-domain tenant
 *    → slug = second-level domain = 'sharmajeeacademy'
 *
 *  sharmajeeacademy.com  (bare custom domain, no subdomain)
 *    → custom-domain tenant
 *    → slug = second-level domain = 'sharmajeeacademy'
 *
 *  gym.brutalfightclub.in  (custom domain, country TLD)
 *    → custom-domain tenant
 *    → slug = second-level domain = 'brutalfightclub'
 *
 * ── Why SLD for custom domains? ──────────────────────────────────────────
 *
 *  For custom domains we extract `parts[parts.length - 2]` — always the
 *  segment immediately before the TLD. This works for any subdomain prefix
 *  the business chose (crm., dashboard., app., or none). No tenant names
 *  are hardcoded; the rule is purely structural.
 *
 *  Limitation: compound TLDs like .co.in are not handled here. Add a
 *  PUBLIC_SUFFIX_LIST lookup if those are ever needed.
 *
 * ── Adding staging ────────────────────────────────────────────────────────
 *
 *  const isStaging = hostname.endsWith(`.staging.${PLATFORM_DOMAIN}`);
 *  export const API_BASE_URL = isLocal ? LOCAL_API : isStaging ? STAGING_API : PLATFORM_API;
 */

/* ── Platform constants — the only hardcoded values in the entire codebase ── */
const PLATFORM_DOMAIN = 'indian-sme.com';
const PLATFORM_API    = 'https://api.indian-sme.com';
const LOCAL_API       = 'http://localhost:4000';

/**
 * Subdomains that belong to the platform itself, not to any tenant.
 * Any subdomain of PLATFORM_DOMAIN that is NOT in this set is a tenant slug.
 */
const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'dashboard', 'admin', 'staging']);

/* ── Runtime hostname ── */
const { hostname } = window.location;

/* ── Classification (evaluated once at module load) ── */
const isLocal            = hostname === 'localhost' || hostname === '127.0.0.1';
const isPlatformRoot     = !isLocal && hostname === PLATFORM_DOMAIN;
const isPlatformSubdomain = !isLocal && hostname.endsWith(`.${PLATFORM_DOMAIN}`);
// Anything that is none of the above is a custom tenant domain.

/* ──────────────────────────────────────────────────────────────────────────
   API_BASE_URL
   All traffic — regardless of tenant domain — routes to the single shared
   backend API. Tenants are scoped server-side by businessId from the JWT.
────────────────────────────────────────────────────────────────────────── */
export const API_BASE_URL = isLocal ? LOCAL_API : PLATFORM_API;

/* ──────────────────────────────────────────────────────────────────────────
   WS_BASE_URL
   Derived automatically from API_BASE_URL — never needs separate maintenance.
     http://localhost:4000              →  ws://localhost:4000
     https://api.indian-sme.com        →  wss://api.indian-sme.com
────────────────────────────────────────────────────────────────────────── */
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/* ──────────────────────────────────────────────────────────────────────────
   BUSINESS_SLUG
   Extracted from the hostname — never hardcoded.
   null  → multi-tenant login (user must type the slug)
   string → tenant is known; slug input can be hidden / pre-filled
────────────────────────────────────────────────────────────────────────── */
export const BUSINESS_SLUG = (() => {
  /* Local dev or platform root — no tenant context from the URL */
  if (isLocal || isPlatformRoot) return null;

  if (isPlatformSubdomain) {
    /* 'academy.indian-sme.com'  →  subdomain = 'academy'
       'app.indian-sme.com'      →  subdomain = 'app'  (reserved → null) */
    const subdomain = hostname.slice(0, hostname.indexOf('.'));
    return RESERVED_SUBDOMAINS.has(subdomain) ? null : subdomain;
  }

  /* Custom domain — extract the second-level domain (SLD).
   *
   *  crm.sharmajeeacademy.com  → ['crm', 'sharmajeeacademy', 'com']  → parts[1] = 'sharmajeeacademy'
   *  sharmajeeacademy.com      → ['sharmajeeacademy', 'com']          → parts[0] = 'sharmajeeacademy'
   *  gym.brutalfightclub.in    → ['gym', 'brutalfightclub', 'in']     → parts[1] = 'brutalfightclub'
   *
   *  In all cases: parts[parts.length - 2]
   */
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts[parts.length - 2] : null;
})();
