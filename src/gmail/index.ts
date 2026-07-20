/** Public surface for the Gmail domain layer: classification, extraction, fetch, and AI tail. */
export { AiTailClassifier } from './ai-classify.js';
export type { AiClassificationResult } from './ai-classify.js';
export { classify } from './classify.js';
export { extractCompany, extractRole } from './extract-company.js';
export { buildGmailQuery, EmailFetcher } from './fetch.js';
export { EmailMetaSchema } from './types.js';
export type { Classification, EmailClass, EmailMeta } from './types.js';
