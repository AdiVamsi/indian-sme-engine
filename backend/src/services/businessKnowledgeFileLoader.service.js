'use strict';

const fs = require('fs/promises');
const path = require('path');

const { getAgentConfigPreset } = require('../constants/agentConfig.presets');
const {
  normalizeBusinessKnowledgeConfig,
  normalizeKnowledgeCategory,
  SUPPORTED_KNOWLEDGE_INTENTS,
} = require('./businessKnowledge.service');

const BUSINESS_KNOWLEDGE_DATA_ROOT = path.resolve(__dirname, '../../data/business-knowledge');
const BUSINESS_KNOWLEDGE_FILE_ORDER = [
  'business-profile.json',
  'courses-and-batches.json',
  'fees-and-payment.json',
  'admissions-and-demo.json',
  'scholarship-and-policies.json',
  'locations-and-timings.json',
  'faqs.json',
];

const BUSINESS_KNOWLEDGE_FOLDER_REGISTRY = Object.freeze({
  'aarohan-jee-academy-delhi': 'aarohan-jee-academy-delhi',
});

class BusinessKnowledgeFileLoaderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BusinessKnowledgeFileLoaderError';
    Object.assign(this, details);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStringArray(values, {
  fileName,
  fieldName,
  transform = (value) => value,
} = {}) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new BusinessKnowledgeFileLoaderError(
      `${fileName}: "${fieldName}" must be an array of strings`
    );
  }

  return [...new Set(values.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BusinessKnowledgeFileLoaderError(
        `${fileName}: "${fieldName}" entry ${index + 1} must be a non-empty string`
      );
    }
    return transform(value.trim());
  }))];
}

function sortKnowledgeFileNames(fileNames = []) {
  const order = new Map(BUSINESS_KNOWLEDGE_FILE_ORDER.map((fileName, index) => [fileName, index]));
  return [...fileNames].sort((a, b) => {
    const aRank = order.has(a) ? order.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = order.has(b) ? order.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
}

function validateDocumentShape(document, fileName) {
  if (!isPlainObject(document)) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: top-level JSON must be an object`);
  }

  if (document.enabled !== undefined && typeof document.enabled !== 'boolean') {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: "enabled" must be a boolean when provided`);
  }

  if (!Array.isArray(document.entries)) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: "entries" is required and must be an array`);
  }

  if (document.sourceLabel !== undefined && (typeof document.sourceLabel !== 'string' || !document.sourceLabel.trim())) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: "sourceLabel" must be a non-empty string when provided`);
  }
}

function normalizeFileKnowledgeEntry(entry, {
  fileName,
  index,
  documentSourceLabel = '',
  documentEnabled = true,
  seenIds,
}) {
  if (!isPlainObject(entry)) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: entry ${index + 1} must be an object`);
  }

  if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: entry ${index + 1} "enabled" must be a boolean`);
  }

  const title = String(entry.title || '').trim();
  if (!title) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: entry ${index + 1} is missing required "title"`);
  }

  const category = normalizeKnowledgeCategory(entry.category);
  if (!category) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: entry "${title}" has an unsupported "category"`);
  }

  const content = String(entry.content || '').trim();
  if (!content) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: entry "${title}" is missing required "content"`);
  }

  const intents = normalizeStringArray(entry.intents, {
    fileName,
    fieldName: `entries[${index}].intents`,
    transform: (value) => value.toUpperCase(),
  });

  if (intents.some((intent) => !SUPPORTED_KNOWLEDGE_INTENTS.has(intent))) {
    throw new BusinessKnowledgeFileLoaderError(
      `${fileName}: entry "${title}" contains an unsupported intent`
    );
  }

  const keywords = normalizeStringArray(entry.keywords, {
    fileName,
    fieldName: `entries[${index}].keywords`,
    transform: (value) => value.toLowerCase(),
  });

  const sourceLabel = String(entry.sourceLabel || documentSourceLabel || title).trim();
  const id = String(entry.id || '').trim() || slugify(`${category}_${title}`) || `knowledge_${index + 1}`;

  if (seenIds.has(id)) {
    throw new BusinessKnowledgeFileLoaderError(`${fileName}: duplicate business knowledge id "${id}"`);
  }
  seenIds.add(id);

  return {
    id,
    title,
    category,
    intents,
    keywords,
    content,
    sourceLabel,
    enabled: entry.enabled !== undefined ? entry.enabled : documentEnabled,
  };
}

function normalizeKnowledgeDocument(document, {
  fileName,
  seenIds,
}) {
  validateDocumentShape(document, fileName);

  const documentSourceLabel = String(document.sourceLabel || '').trim();
  const documentEnabled = document.enabled !== false;

  return {
    fileName,
    sourceLabel: documentSourceLabel || fileName.replace(/\.json$/i, ''),
    enabled: documentEnabled,
    business: isPlainObject(document.business) ? cloneJson(document.business) : null,
    entries: document.entries.map((entry, index) => normalizeFileKnowledgeEntry(entry, {
      fileName,
      index,
      documentSourceLabel,
      documentEnabled,
      seenIds,
    })),
  };
}

function compileBusinessKnowledgeDocuments(documents = []) {
  const businessMeta = documents.find((document) => document.business)?.business || null;
  const knowledge = normalizeBusinessKnowledgeConfig({
    enabled: documents.some((document) => document.enabled !== false),
    entries: documents.flatMap((document) => document.entries),
  });

  return {
    business: businessMeta,
    knowledge,
  };
}

async function readKnowledgeDocument(filePath) {
  const fileName = path.basename(filePath);
  let raw = '';

  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    throw new BusinessKnowledgeFileLoaderError(
      `${fileName}: could not be read`,
      { cause: err, filePath }
    );
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new BusinessKnowledgeFileLoaderError(
      `${fileName}: contains invalid JSON`,
      { cause: err, filePath }
    );
  }
}

async function listBusinessKnowledgeFiles(folderPath) {
  let items;

  try {
    items = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (err) {
    throw new BusinessKnowledgeFileLoaderError(
      `Business knowledge folder could not be read: ${folderPath}`,
      { cause: err, folderPath }
    );
  }

  const fileNames = items
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.json'))
    .map((item) => item.name);

  if (!fileNames.length) {
    throw new BusinessKnowledgeFileLoaderError(
      `No JSON business knowledge files were found in ${folderPath}`
    );
  }

  return sortKnowledgeFileNames(fileNames);
}

function resolveBusinessKnowledgeFolderName(businessSlug) {
  if (!businessSlug || typeof businessSlug !== 'string') {
    throw new BusinessKnowledgeFileLoaderError('businessSlug is required to load file-based business knowledge');
  }

  return BUSINESS_KNOWLEDGE_FOLDER_REGISTRY[businessSlug] || businessSlug;
}

async function loadBusinessKnowledgeFileBundle({
  businessSlug,
  rootDir = BUSINESS_KNOWLEDGE_DATA_ROOT,
} = {}) {
  const folderName = resolveBusinessKnowledgeFolderName(businessSlug);
  const folderPath = path.join(rootDir, folderName);
  const fileNames = await listBusinessKnowledgeFiles(folderPath);
  const seenIds = new Set();
  const documents = [];

  for (const fileName of fileNames) {
    const filePath = path.join(folderPath, fileName);
    const document = await readKnowledgeDocument(filePath);
    documents.push(normalizeKnowledgeDocument(document, {
      fileName,
      seenIds,
    }));
  }

  const compiled = compileBusinessKnowledgeDocuments(documents);

  return {
    businessSlug,
    folderName,
    folderPath,
    fileNames,
    documentCount: documents.length,
    entryCount: compiled.knowledge.entries.length,
    business: compiled.business,
    knowledge: compiled.knowledge,
  };
}

function mergeBusinessKnowledgeIntoAgentConfig(baseConfig = {}, businessKnowledgeConfig = {}) {
  const nextConfig = cloneJson(baseConfig || {});
  const nextClassificationRules = isPlainObject(nextConfig.classificationRules)
    ? { ...nextConfig.classificationRules }
    : {};

  nextClassificationRules.businessKnowledge = normalizeBusinessKnowledgeConfig(businessKnowledgeConfig);
  nextConfig.classificationRules = nextClassificationRules;
  return nextConfig;
}

async function buildAgentConfigFromBusinessKnowledgeFiles({
  businessSlug,
  industry = 'other',
  baseConfig = null,
  rootDir = BUSINESS_KNOWLEDGE_DATA_ROOT,
} = {}) {
  const base = baseConfig ? cloneJson(baseConfig) : getAgentConfigPreset(industry);
  const bundle = await loadBusinessKnowledgeFileBundle({ businessSlug, rootDir });

  return {
    agentConfig: mergeBusinessKnowledgeIntoAgentConfig(base, bundle.knowledge),
    knowledgeBundle: bundle,
  };
}

module.exports = {
  BUSINESS_KNOWLEDGE_DATA_ROOT,
  BUSINESS_KNOWLEDGE_FILE_ORDER,
  BUSINESS_KNOWLEDGE_FOLDER_REGISTRY,
  BusinessKnowledgeFileLoaderError,
  buildAgentConfigFromBusinessKnowledgeFiles,
  compileBusinessKnowledgeDocuments,
  loadBusinessKnowledgeFileBundle,
  mergeBusinessKnowledgeIntoAgentConfig,
  normalizeKnowledgeDocument,
  resolveBusinessKnowledgeFolderName,
};
