/**
 * agent.js — AgentConfig editor page.
 *
 * Reads token from localStorage (written by dashboard.js on login).
 * Calls GET /api/agent to populate the form.
 * Calls PUT /api/agent on save.
 *
 * No global state. No framework. ES module.
 */

import { API_BASE_URL } from './config.js';

const token = localStorage.getItem('dash_token');
if (!token) {
  window.location.href = '/dashboard/';
  throw new Error('Not authenticated');
}

const WHATSAPP_INTENTS = [
  'ADMISSION',
  'DEMO_REQUEST',
  'FEE_ENQUIRY',
  'SCHOLARSHIP_ENQUIRY',
  'CALLBACK_REQUEST',
  'GENERAL_ENQUIRY',
];

const INTENT_LABELS = {
  ADMISSION: 'Admission enquiry',
  DEMO_REQUEST: 'Demo request',
  FEE_ENQUIRY: 'Fee enquiry',
  SCHOLARSHIP_ENQUIRY: 'Scholarship enquiry',
  CALLBACK_REQUEST: 'Callback request',
  GENERAL_ENQUIRY: 'General enquiry',
};

const REQUIRED_FIELD_OPTIONS = [
  { value: 'studentClass', label: 'Student class' },
  { value: 'preferredCallTime', label: 'Preferred call time' },
  { value: 'recentMarks', label: 'Recent marks' },
  { value: 'topic', label: 'Requested topic' },
];

const HANDOFF_TEMPLATE_KEYS = [
  'genericHighPriority',
  'lowConfidence',
  'inProgress',
  'offFlow',
];

const KNOWLEDGE_INTENTS = [
  'ADMISSION',
  'BATCH_TIMING',
  'COURSE_INFO',
  'DEMO_REQUEST',
  'FEE_ENQUIRY',
  'GENERAL_ENQUIRY',
  'SCHOLARSHIP_ENQUIRY',
];

const KNOWLEDGE_INTENT_LABELS = {
  ADMISSION: 'Admission enquiry',
  BATCH_TIMING: 'Batch timing',
  COURSE_INFO: 'Course information',
  DEMO_REQUEST: 'Demo request',
  FEE_ENQUIRY: 'Fee enquiry',
  GENERAL_ENQUIRY: 'General enquiry',
  SCHOLARSHIP_ENQUIRY: 'Scholarship enquiry',
};

const KNOWLEDGE_CATEGORY_OPTIONS = [
  { value: 'fees', label: 'Fees' },
  { value: 'timings', label: 'Timings' },
  { value: 'online_classes', label: 'Online classes' },
  { value: 'demo_class', label: 'Demo class' },
  { value: 'admission', label: 'Admission' },
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'branch_location', label: 'Branch / location' },
  { value: 'courses', label: 'Courses' },
  { value: 'general', label: 'General' },
];

let whatsappPreset = null;
let currentIndustry = 'other';
let knowledgePreset = { enabled: false, entries: [] };
let knowledgeEntries = [];
let knowledgeEnabled = false;
let knowledgeUsesPreset = true;
let activeKnowledgeEntryId = null;

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

async function fetchConfig() {
  const res = await fetch(`${API_BASE_URL}/api/agent`, {
    method: 'GET',
    headers: headers(),
  });
  if (res.status === 401) {
    localStorage.removeItem('dash_token');
    window.location.href = '/dashboard/';
  }
  if (!res.ok) throw new Error(`GET /api/agent → ${res.status}`);
  return res.json();
}

async function saveConfig(body) {
  const res = await fetch(`${API_BASE_URL}/api/agent`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    localStorage.removeItem('dash_token');
    window.location.href = '/dashboard/';
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showStatus(msg, type) {
  const el = $('status-banner');
  el.textContent = msg;
  el.className = `status-banner status-banner--${type}`;
  if (type === 'ok') {
    setTimeout(() => { el.className = 'status-banner'; }, 4000);
  }
}

function renderTemplate(template, tokens) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => tokens[key] || '');
}

function formatList(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function normalizeListInput(raw) {
  return String(raw || '')
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fillListInput(id, items = []) {
  $(id).value = (Array.isArray(items) ? items : []).join('\n');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function truncateText(value, max = 180) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function makeKnowledgeId(title, category) {
  const base = slugify(`${category}_${title}`) || `knowledge_${Date.now()}`;
  if (!knowledgeEntries.some((entry) => entry.id === base)) return base;

  let suffix = 2;
  while (knowledgeEntries.some((entry) => entry.id === `${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function makeClassRow(tag = '', keywords = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="class-tag" placeholder="TAG_NAME" value="${esc(tag)}" /></td>
    <td><input type="text" class="class-kws" placeholder="demo, trial, walkthrough" value="${esc(keywords)}" /></td>
    <td><button type="button" class="btn-remove" title="Remove">✕</button></td>
  `;
  tr.querySelector('.btn-remove').addEventListener('click', () => tr.remove());
  return tr;
}

function populateClassRules(classificationRules) {
  const tbody = $('class-tbody');
  tbody.innerHTML = '';
  const keywords = classificationRules?.keywords ?? {};
  for (const [tag, kws] of Object.entries(keywords)) {
    tbody.appendChild(makeClassRow(tag, Array.isArray(kws) ? kws.join(', ') : ''));
  }
  if (!tbody.children.length) tbody.appendChild(makeClassRow());
}

function readKeywords() {
  const rows = $('class-tbody').querySelectorAll('tr');
  const keywords = {};
  rows.forEach((tr) => {
    const tag = tr.querySelector('.class-tag').value.trim().toUpperCase().replace(/\s+/g, '_');
    const kws = tr.querySelector('.class-kws').value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tag && kws.length) keywords[tag] = kws;
  });
  return keywords;
}

function makePrioRow(keyword = '', weight = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="prio-kw" placeholder="urgent" value="${esc(keyword)}" /></td>
    <td><input type="number" class="prio-weight" placeholder="30" value="${esc(String(weight))}" min="0" max="1000" /></td>
    <td><button type="button" class="btn-remove" title="Remove">✕</button></td>
  `;
  tr.querySelector('.btn-remove').addEventListener('click', () => tr.remove());
  return tr;
}

function populatePrioRules(priorityRules) {
  const tbody = $('prio-tbody');
  tbody.innerHTML = '';
  const weights = priorityRules?.weights ?? {};
  for (const [kw, w] of Object.entries(weights)) {
    tbody.appendChild(makePrioRow(kw, w));
  }
  if (!tbody.children.length) tbody.appendChild(makePrioRow());
}

function readPrioRules() {
  const rows = $('prio-tbody').querySelectorAll('tr');
  const weights = {};
  rows.forEach((tr) => {
    const kw = tr.querySelector('.prio-kw').value.trim().toLowerCase();
    const raw = parseFloat(tr.querySelector('.prio-weight').value);
    if (kw && !Number.isNaN(raw)) weights[kw] = raw;
  });
  return { weights };
}

function renderRequiredFieldsTable(requiredCollectedFields = {}) {
  const tbody = $('wa-required-fields-body');
  tbody.innerHTML = WHATSAPP_INTENTS.map((intent) => {
    const checked = new Set(requiredCollectedFields[intent] || []);
    const options = REQUIRED_FIELD_OPTIONS.map((field) => `
      <label class="wa-check">
        <input
          type="checkbox"
          data-intent="${intent}"
          value="${field.value}"
          ${checked.has(field.value) ? 'checked' : ''}
        />
        <span>${field.label}</span>
      </label>
    `).join('');

    return `
      <tr>
        <td>${INTENT_LABELS[intent] || intent}</td>
        <td><div class="wa-required__checks">${options}</div></td>
      </tr>
    `;
  }).join('');
}

function readRequiredCollectedFields() {
  const fields = {};
  WHATSAPP_INTENTS.forEach((intent) => {
    fields[intent] = [];
  });

  $('wa-required-fields-body').querySelectorAll('input[type="checkbox"]').forEach((input) => {
    if (input.checked) fields[input.dataset.intent].push(input.value);
  });

  return fields;
}

function populateWhatsAppReplyConfig(effective, preset, industry) {
  whatsappPreset = JSON.parse(JSON.stringify(preset || {}));
  currentIndustry = industry || 'other';

  $('wa-effective-badge').textContent = `Effective ${currentIndustry} WhatsApp reply settings`;
  $('wa-preset-note').textContent = `Industry preset: ${currentIndustry}. Reset restores the default WhatsApp reply behavior for this business type.`;

  $('wa-institution-label').value = effective?.institutionLabel || '';
  $('wa-primary-offering').value = effective?.primaryOffering || '';
  $('wa-preferred-language').value = effective?.preferredLanguage || 'english';
  fillListInput('wa-supported-offerings', effective?.supportedOfferings || []);
  fillListInput('wa-wrong-fit-categories', effective?.wrongFitCategories || []);

  renderRequiredFieldsTable(effective?.requiredCollectedFields || {});
  HANDOFF_TEMPLATE_KEYS.forEach((key) => {
    $(`wa-template-${key}`).value = effective?.handoffWording?.[key] || '';
  });

  renderPreview();
}

function readWhatsAppReplyConfig() {
  const config = {
    institutionLabel: $('wa-institution-label').value.trim(),
    primaryOffering: $('wa-primary-offering').value.trim(),
    supportedOfferings: normalizeListInput($('wa-supported-offerings').value),
    wrongFitCategories: normalizeListInput($('wa-wrong-fit-categories').value),
    preferredLanguage: $('wa-preferred-language').value.trim(),
    requiredCollectedFields: readRequiredCollectedFields(),
    handoffWording: {},
  };

  HANDOFF_TEMPLATE_KEYS.forEach((key) => {
    config.handoffWording[key] = $(`wa-template-${key}`).value.trim();
  });

  return config;
}

function validateWhatsAppReplyConfig(config) {
  if (!config.institutionLabel) return 'Institution label is required.';
  if (!config.primaryOffering) return 'Primary offering is required.';
  if (!config.preferredLanguage) return 'Preferred language is required.';

  const listFields = ['supportedOfferings', 'wrongFitCategories'];
  for (const key of listFields) {
    if (!Array.isArray(config[key]) || config[key].some((value) => typeof value !== 'string' || !value.trim())) {
      return `${key} must be a list of text values.`;
    }
  }

  if (!config.supportedOfferings.length) {
    return 'Please add at least one supported offering.';
  }

  if (!config.requiredCollectedFields || typeof config.requiredCollectedFields !== 'object') {
    return 'Required collected fields are invalid.';
  }

  for (const intent of WHATSAPP_INTENTS) {
    const values = config.requiredCollectedFields[intent];
    if (!Array.isArray(values)) return `Required collected fields for ${intent} are invalid.`;
    if (values.some((value) => !REQUIRED_FIELD_OPTIONS.some((field) => field.value === value))) {
      return `Required collected fields for ${intent} contain an unknown option.`;
    }
  }

  for (const key of HANDOFF_TEMPLATE_KEYS) {
    if (typeof config.handoffWording[key] !== 'string' || !config.handoffWording[key].trim()) {
      return `Please provide a value for the ${key} handoff template.`;
    }
  }

  return null;
}

function formatKnowledgeCategory(category) {
  return KNOWLEDGE_CATEGORY_OPTIONS.find((option) => option.value === category)?.label
    || category.replace(/_/g, ' ');
}

function readKnowledgeIntents() {
  return [...$('kb-intents').querySelectorAll('input[type="checkbox"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function setKnowledgeIntentSelection(intents = []) {
  const selected = new Set(intents);
  $('kb-intents').querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function renderKnowledgeStatus() {
  $('kb-effective-badge').textContent = knowledgeUsesPreset
    ? `Using ${currentIndustry} preset business knowledge`
    : `Business-specific knowledge override`;
  $('kb-preset-note').textContent = knowledgeUsesPreset
    ? `This business is using the default grounded-answer content for ${currentIndustry}. Add or edit entries below to create a business-specific override.`
    : `This business has its own grounded-answer content. Reset this section if you want to go back to the ${currentIndustry} preset.`;
  $('kb-enabled').checked = Boolean(knowledgeEnabled);
}

function populateBusinessKnowledgeConfig(effective, preset, usesPreset) {
  knowledgePreset = JSON.parse(JSON.stringify(preset || { enabled: false, entries: [] }));
  knowledgeEntries = JSON.parse(JSON.stringify(effective?.entries || []));
  knowledgeEnabled = Boolean(effective?.enabled);
  knowledgeUsesPreset = usesPreset !== false;
  activeKnowledgeEntryId = null;

  renderKnowledgeStatus();
  renderKnowledgeList();
  closeKnowledgeEditor();
}

function openKnowledgeEditor(entry = null) {
  const editing = Boolean(entry);
  activeKnowledgeEntryId = entry?.id || null;
  $('kb-editor-title').textContent = editing ? 'Edit knowledge entry' : 'Add knowledge entry';
  $('kb-editor-mode').textContent = editing ? 'Editing' : 'New entry';
  $('kb-title').value = entry?.title || '';
  $('kb-category').value = entry?.category || 'general';
  $('kb-source-label').value = entry?.sourceLabel || '';
  $('kb-entry-enabled').checked = entry?.enabled !== false;
  $('kb-keywords').value = Array.isArray(entry?.keywords) ? entry.keywords.join(', ') : '';
  $('kb-content').value = entry?.content || '';
  setKnowledgeIntentSelection(entry?.intents || []);
  $('kb-editor').hidden = false;
  requestAnimationFrame(() => $('kb-title')?.focus());
}

function closeKnowledgeEditor() {
  activeKnowledgeEntryId = null;
  $('kb-editor').hidden = true;
  $('kb-title').value = '';
  $('kb-category').value = 'general';
  $('kb-source-label').value = '';
  $('kb-entry-enabled').checked = true;
  $('kb-keywords').value = '';
  $('kb-content').value = '';
  setKnowledgeIntentSelection([]);
}

function validateKnowledgeEntry(entry) {
  if (!entry.title) return 'Knowledge title is required.';
  if (!entry.category) return 'Knowledge category is required.';
  if (!entry.content) return 'Knowledge content is required.';
  if (entry.title.length > 120) return 'Knowledge title must be 120 characters or fewer.';
  if (entry.content.length > 1200) return 'Knowledge content must be 1200 characters or fewer.';
  if (entry.sourceLabel && entry.sourceLabel.length > 160) return 'Source label must be 160 characters or fewer.';
  if (!KNOWLEDGE_CATEGORY_OPTIONS.some((option) => option.value === entry.category)) {
    return 'Please choose a valid knowledge category.';
  }
  if (entry.intents.some((intent) => !KNOWLEDGE_INTENTS.includes(intent))) {
    return 'Knowledge entry contains an unsupported intent.';
  }
  if (entry.keywords.some((keyword) => !keyword.trim())) {
    return 'Knowledge keywords cannot be empty.';
  }
  if (knowledgeEntries.some((existing) =>
    existing.id !== entry.id
    && existing.title.toLowerCase() === entry.title.toLowerCase()
    && existing.category === entry.category
  )) {
    return 'A knowledge entry with the same title and category already exists.';
  }
  return null;
}

function readKnowledgeEditorEntry() {
  const title = $('kb-title').value.trim();
  const category = $('kb-category').value;
  const sourceLabel = $('kb-source-label').value.trim();
  const content = $('kb-content').value.trim();
  const entry = {
    id: activeKnowledgeEntryId || makeKnowledgeId(title, category),
    title,
    category,
    intents: readKnowledgeIntents(),
    keywords: normalizeListInput($('kb-keywords').value).map((value) => value.toLowerCase()),
    content,
    sourceLabel: sourceLabel || title,
    enabled: $('kb-entry-enabled').checked,
  };

  return entry;
}

function persistKnowledgeEntry() {
  const entry = readKnowledgeEditorEntry();
  const error = validateKnowledgeEntry(entry);
  if (error) {
    showStatus(error, 'err');
    return;
  }

  knowledgeUsesPreset = false;
  if (activeKnowledgeEntryId) {
    knowledgeEntries = knowledgeEntries.map((existing) => existing.id === activeKnowledgeEntryId ? entry : existing);
  } else {
    knowledgeEntries = [entry, ...knowledgeEntries];
  }

  renderKnowledgeStatus();
  renderKnowledgeList();
  closeKnowledgeEditor();
  showStatus('Knowledge entry saved locally. Save changes to apply it to grounded answers.', 'ok');
}

function renderKnowledgeList() {
  const list = $('kb-list');
  const empty = $('kb-empty');
  const search = $('kb-search').value.trim().toLowerCase();
  const category = $('kb-category-filter').value;
  const entries = [...knowledgeEntries].filter((entry) => {
    const matchesSearch = !search || [
      entry.title,
      entry.sourceLabel,
      entry.content,
      ...(entry.keywords || []),
    ].some((value) => String(value || '').toLowerCase().includes(search));
    const matchesCategory = !category || entry.category === category;
    return matchesSearch && matchesCategory;
  });

  if (!entries.length) {
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = knowledgeEntries.length
      ? 'No entries match your current search or category filter.'
      : 'No business knowledge entries yet. Add practical facts your team repeats often, such as fee details, branch address, batch timings, or admission process.';
    return;
  }

  empty.hidden = true;
  list.innerHTML = entries.map((entry) => `
    <article class="kb-card${entry.enabled === false ? ' kb-card--disabled' : ''}">
      <div class="kb-card__top">
        <div>
          <h3 class="kb-card__title">${esc(entry.title)}</h3>
          <div class="kb-card__meta">
            <span class="kb-chip kb-chip--category">${esc(formatKnowledgeCategory(entry.category))}</span>
            <span class="kb-chip ${entry.enabled === false ? 'kb-chip--disabled' : 'kb-chip--enabled'}">${entry.enabled === false ? 'Disabled' : 'Enabled'}</span>
            ${(entry.intents || []).map((intent) => `<span class="kb-chip kb-chip--intent">${esc(KNOWLEDGE_INTENT_LABELS[intent] || intent)}</span>`).join('')}
          </div>
        </div>
      </div>

      <div class="kb-card__body">
        ${(entry.keywords || []).length ? `
          <div class="kb-card__meta">
            ${(entry.keywords || []).map((keyword) => `<span class="kb-chip kb-chip--keyword">${esc(keyword)}</span>`).join('')}
          </div>` : ''}
        <p class="kb-card__preview">${esc(truncateText(entry.content))}</p>
        <div class="kb-card__source">Source: ${esc(entry.sourceLabel || entry.title)}</div>
      </div>

      <div class="kb-card__actions">
        <button class="btn-secondary" type="button" data-kb-action="edit" data-kb-id="${esc(entry.id)}">Edit</button>
        <button class="btn-secondary" type="button" data-kb-action="toggle" data-kb-id="${esc(entry.id)}">${entry.enabled === false ? 'Enable' : 'Disable'}</button>
        <button class="btn-secondary" type="button" data-kb-action="delete" data-kb-id="${esc(entry.id)}">Delete</button>
      </div>
    </article>
  `).join('');
}

function readBusinessKnowledgeConfig() {
  if (knowledgeUsesPreset) return null;
  return {
    enabled: Boolean(knowledgeEnabled),
    entries: knowledgeEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      intents: entry.intents,
      keywords: entry.keywords,
      content: entry.content,
      sourceLabel: entry.sourceLabel,
      enabled: entry.enabled !== false,
    })),
  };
}

function validateBusinessKnowledgeConfig(config) {
  if (config === null) return null;
  if (config && !Array.isArray(config.entries)) return 'Business knowledge entries are invalid.';
  for (const entry of config?.entries || []) {
    const error = validateKnowledgeEntry(entry);
    if (error) return error;
  }
  return null;
}

function renderPreview() {
  const institutionLabel = $('wa-institution-label').value.trim() || 'counsellor';
  const supportedOfferings = normalizeListInput($('wa-supported-offerings').value);
  const preferredLanguage = $('wa-preferred-language').value.trim();
  const genericTemplate = $('wa-template-genericHighPriority').value.trim()
    || 'Thank you for your enquiry. Our {{institutionLabel}} will contact you shortly.';

  const offerText = formatList(supportedOfferings.slice(0, 3)) || 'fee details and admission guidance';
  const hindiSuffix = /hindi/i.test(preferredLanguage) ? ' We can assist in Hindi as well.' : '';
  $('wa-preview-first').textContent = `Certainly. Please share the student's class, and let us know if you need ${offerText}.${hindiSuffix}`.trim();
  $('wa-preview-handoff').textContent = renderTemplate(genericTemplate, { institutionLabel });
}

function readClassificationRules() {
  return {
    keywords: readKeywords(),
    whatsappReplyConfig: readWhatsAppReplyConfig(),
    businessKnowledge: readBusinessKnowledgeConfig(),
  };
}

async function init() {
  try {
    const config = await fetchConfig();

    $('followUpMinutes').value = config.followUpMinutes ?? 30;
    populateClassRules(config.classificationRules);
    populatePrioRules(config.priorityRules);
    populateWhatsAppReplyConfig(
      config.whatsappReplyConfig || config.classificationRules?.whatsappReplyConfig || {},
      config.whatsappReplyPreset || {},
      config.industry || 'other'
    );
    populateBusinessKnowledgeConfig(
      config.businessKnowledgeConfig || config.classificationRules?.businessKnowledge || { enabled: false, entries: [] },
      config.businessKnowledgePreset || { enabled: false, entries: [] },
      config.businessKnowledgeUsesPreset
    );
  } catch (err) {
    console.error('[agent.js] init failed:', err);
    showStatus('Failed to load config. Check console.', 'err');
  }
}

$('btn-add-class').addEventListener('click', () => {
  $('class-tbody').appendChild(makeClassRow());
});

$('btn-add-prio').addEventListener('click', () => {
  $('prio-tbody').appendChild(makePrioRow());
});

$('btn-reset-wa').addEventListener('click', () => {
  if (!whatsappPreset) return;
  populateWhatsAppReplyConfig(whatsappPreset, whatsappPreset, currentIndustry);
  showStatus('WhatsApp reply settings reset to the industry preset. Save to apply this change.', 'ok');
});

$('btn-add-knowledge').addEventListener('click', () => {
  openKnowledgeEditor();
});

$('btn-cancel-knowledge').addEventListener('click', () => {
  closeKnowledgeEditor();
});

$('btn-save-knowledge').addEventListener('click', () => {
  persistKnowledgeEntry();
});

$('btn-reset-knowledge').addEventListener('click', () => {
  populateBusinessKnowledgeConfig(knowledgePreset, knowledgePreset, true);
  showStatus('Business knowledge reset to the industry preset. Save changes to apply it.', 'ok');
});

$('kb-enabled').addEventListener('change', (event) => {
  knowledgeUsesPreset = false;
  knowledgeEnabled = event.target.checked;
  renderKnowledgeStatus();
});

$('kb-search').addEventListener('input', renderKnowledgeList);
$('kb-category-filter').addEventListener('change', renderKnowledgeList);

$('kb-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-kb-action]');
  if (!button) return;

  const entry = knowledgeEntries.find((item) => item.id === button.dataset.kbId);
  if (!entry) return;

  if (button.dataset.kbAction === 'edit') {
    openKnowledgeEditor(entry);
    return;
  }

  if (button.dataset.kbAction === 'toggle') {
    knowledgeUsesPreset = false;
    knowledgeEntries = knowledgeEntries.map((item) =>
      item.id === entry.id ? { ...item, enabled: item.enabled === false } : item
    );
    renderKnowledgeStatus();
    renderKnowledgeList();
    return;
  }

  if (button.dataset.kbAction === 'delete') {
    knowledgeUsesPreset = false;
    knowledgeEntries = knowledgeEntries.filter((item) => item.id !== entry.id);
    if (activeKnowledgeEntryId === entry.id) closeKnowledgeEditor();
    renderKnowledgeStatus();
    renderKnowledgeList();
  }
});

[
  'wa-institution-label',
  'wa-primary-offering',
  'wa-preferred-language',
  'wa-supported-offerings',
  'wa-wrong-fit-categories',
  'wa-template-genericHighPriority',
  'wa-template-lowConfidence',
  'wa-template-inProgress',
  'wa-template-offFlow',
].forEach((id) => {
  $(id).addEventListener('input', renderPreview);
});

$('wa-required-fields-body').addEventListener?.('change', renderPreview);
document.addEventListener('change', (event) => {
  if (event.target.closest('#wa-required-fields-body')) renderPreview();
});

$('btn-save').addEventListener('click', async () => {
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const followUpMinutes = parseInt($('followUpMinutes').value, 10);
  const classificationRules = readClassificationRules();
  const priorityRules = readPrioRules();
  const whatsappReplyConfig = classificationRules.whatsappReplyConfig;
  const businessKnowledge = classificationRules.businessKnowledge;

  if (!Number.isInteger(followUpMinutes) || followUpMinutes < 1 || followUpMinutes > 1440) {
    showStatus('Follow-up minutes must be between 1 and 1440.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save changes';
    return;
  }

  const validationError = validateWhatsAppReplyConfig(whatsappReplyConfig);
  if (validationError) {
    showStatus(validationError, 'err');
    btn.disabled = false;
    btn.textContent = 'Save changes';
    return;
  }

  const knowledgeValidationError = validateBusinessKnowledgeConfig(businessKnowledge);
  if (knowledgeValidationError) {
    showStatus(knowledgeValidationError, 'err');
    btn.disabled = false;
    btn.textContent = 'Save changes';
    return;
  }

  try {
    const saved = await saveConfig({ followUpMinutes, classificationRules, priorityRules });
    populateWhatsAppReplyConfig(
      saved.whatsappReplyConfig || saved.classificationRules?.whatsappReplyConfig || {},
      saved.whatsappReplyPreset || whatsappPreset || {},
      saved.industry || currentIndustry
    );
    populateBusinessKnowledgeConfig(
      saved.businessKnowledgeConfig || saved.classificationRules?.businessKnowledge || { enabled: false, entries: [] },
      saved.businessKnowledgePreset || knowledgePreset || { enabled: false, entries: [] },
      saved.businessKnowledgeUsesPreset
    );
    showStatus('Agent config saved. New WhatsApp replies and grounded business answers will use these settings immediately.', 'ok');
  } catch (err) {
    console.error('[agent.js] save failed:', err);
    showStatus(err.message || 'Save failed. Check console.', 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
});

init();
