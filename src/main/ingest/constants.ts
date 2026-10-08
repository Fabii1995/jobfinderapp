/** Neutral constants module (no imports) so sources can use these without importing refresh.ts. */

/**
 * Jobs scoring below this are dropped before storage. 30 is reached by:
 *   - one strong target-role title (QA/backend/python/AI-solutions/FDE) with no seniority penalty,
 *   - a general software title plus any junior signal, or
 *   - a general software title whose posting states no experience requirement at all
 *     (the no-experience baseline, exactly 30).
 * Below it: bare general titles with a stated non-junior requirement (20), role-less junior
 * postings (capped at NO_ROLE_TITLE_CAP = 25), intern/student titles (capped at 20) and senior
 * titles (0).
 */
export const MIN_SCORE = 30
