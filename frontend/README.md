# Indian SME Engine — Frontend

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-F7DF1E?logo=javascript&logoColor=black)
![Netlify](https://img.shields.io/badge/Deployed-Netlify-00C7B7?logo=netlify&logoColor=white)

A **production-ready public landing page** for Sharma JEE Academy — a JEE coaching institute in New Delhi. Built entirely in vanilla HTML, CSS, and JavaScript (no frameworks, no build tools). Connects to the live backend API to capture real student enquiries.

---

## Live URL

> Replace this with your Netlify URL after deploying:
> **https://your-site.netlify.app**

---

## Features

- **100% dynamic content** — all text, data, and API settings live in `config.js`. Change one file to rebrand for any business.
- **Card selection animation** — students pick their programme (JEE Main / JEE Advanced / Test Series) with spring animations, orange highlight, and dimming of other cards. Selection pre-fills the enquiry form.
- **Lead capture form** — validated name, Indian phone number (+91 format), optional email and message. Honeypot field blocks bots.
- **Real-time form states** — loading spinner text, success confirmation, granular error messages (network down, rate limited, not found).
- **Scroll animations** — elements fade in on enter using `IntersectionObserver`.
- **Animated counters** — stats bar counts up with easeOut cubic curve when scrolled into view.
- **Scroll spy** — active nav link updates as the user scrolls between sections.
- **Mobile-first responsive** — breakpoints at 480px, 600px, 960px. Collapsible hamburger nav on mobile.
- **Performance** — no frameworks, no bundler, minimal JS. Single Google Font loaded with `preconnect`.

---

## Screenshots

> Add screenshots here after deployment.

| Desktop | Mobile |
|---------|--------|
| _(screenshot)_ | _(screenshot)_ |

---

## File Structure

```
frontend/
├── index.html           ← zero-content template — all text injected by JS
├── config.js            ← single source of truth for ALL site content + API settings
├── script.js            ← render functions, animations, card selection, form logic
├── style.css            ← full design system — CSS custom properties, BEM, responsive
└── js/
    └── api.js           ← single source of truth for all backend communication
```

**Script load order matters:**
```html
<script src="config.js"></script>   ← defines window.SITE
<script src="js/api.js"></script>   ← defines window.API (reads SITE)
<script src="script.js"></script>   ← renders + wires everything (reads SITE + API)
```

---

## How It Connects to the Backend

`config.js` holds the backend URL and business slug:

```js
api: {
  baseUrl: 'https://YOUR-BACKEND-URL.onrender.com',
  slug:    'sharma-jee-academy-delhi',
}
```

`js/api.js` uses these to build the endpoint:

```
POST https://YOUR-BACKEND-URL.onrender.com/api/public/sharma-jee-academy-delhi/leads
```

The backend looks up the business by slug, creates a `Lead` record, and returns `{ ok: true }`. No auth token required for public lead submission.

---

## To Rebrand for Another Business

1. Open `config.js`
2. Update `SITE.api.slug` to the new business slug
3. Update `SITE.api.baseUrl` if using a different backend
4. Update all text fields (`nav`, `hero`, `about`, `services`, `testimonials`, `contact`, `footer`)
5. Deploy — no code changes needed anywhere else

---

## Local Development

```bash
# Serve the frontend locally (no build step needed)
npx serve .
# → http://localhost:3000
```

For local testing with the backend, temporarily set `config.js`:
```js
baseUrl: 'http://localhost:4000',
```

---

## Deployment (Netlify)

**Via Netlify UI:**
1. Connect your GitHub repo at [app.netlify.com](https://app.netlify.com)
2. Set **Publish directory** to `frontend`
3. No build command needed
4. Deploy

**Via Netlify CLI:**
```bash
npm install -g netlify-cli
netlify deploy --prod --dir frontend
```
