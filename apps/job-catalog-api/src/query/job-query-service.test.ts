import { describe, expect, test } from 'bun:test';
import { __jobQueryServiceTestOnly } from './job-query-service';

describe('JobQueryService helpers', () => {
  test('does not accept commerce filters through the job filter matcher', () => {
    const projection = {
      company: 'Qventus',
      location: 'San Francisco, CA, US',
      has_salary: true,
      salary_min: 120000,
      salary_max: 150000,
    };

    expect(__jobQueryServiceTestOnly.matchesFilters(projection, {
      company: 'Qventus',
      salary_min: 100000,
      salary_max: 160000,
    })).toBe(true);
    expect(__jobQueryServiceTestOnly.matchesFilters(projection, {
      company: 'Walmart',
    })).toBe(false);
  });

  test('semantic pack selects semantic mode so callers fail-loud when disabled', () => {
    expect(__jobQueryServiceTestOnly.selectQueryMode({
      query_pack: 'ocp.query.semantic.v1',
      query: 'AI roles',
      filters: {},
      limit: 10,
      offset: 0,
      explain: true,
    })).toBe('semantic');
  });

  test('missing salary or date does not satisfy salary/date filters', () => {
    expect(__jobQueryServiceTestOnly.matchesFilters({}, { salary_min: 100000 })).toBe(false);
    expect(__jobQueryServiceTestOnly.matchesFilters({}, { salary_max: 200000 })).toBe(false);
    expect(__jobQueryServiceTestOnly.matchesFilters({}, { date_posted_after: '2026-07-01' })).toBe(false);
    expect(__jobQueryServiceTestOnly.matchesFilters({}, { date_posted_before: '2026-07-31' })).toBe(false);
  });
});
