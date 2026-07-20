/** Public surface for the Gmail domain layer: pure classification and extraction, no I/O. */
export { classify } from './classify.js';
export { extractCompany, extractRole } from './extract-company.js';
export type { Classification, EmailClass, EmailMeta } from './types.js';
