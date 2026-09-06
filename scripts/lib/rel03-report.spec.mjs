import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildRel03Summary,
  classifyExpectedBusinessRejection,
  safeBaseUrl,
} from '../../tests/performance/rel-03/reporting.mjs';

const metric = (count) => ({ values: { count } });

describe('REL-03 reporting', () => {
  it('transforms metrics into JSON-safe evidence and Markdown', () => {
    const result = buildRel03Summary(
      {
        metrics: {
          http_req_duration: {
            values: { med: 10, 'p(90)': 20, 'p(95)': 30, 'p(99)': 40, max: 50 },
          },
          http_reqs: metric(12),
          iterations: metric(4),
          order_submissions: metric(4),
          successful_orders: metric(3),
          successful_operations: metric(3),
          expected_business_rejections: metric(1),
          unexpected_failures: metric(0),
          expected_rejection_ordering_closed: metric(1),
          status_2xx: metric(3),
          status_4xx: metric(1),
        },
      },
      {
        baseUrl: 'http://127.0.0.1:3000',
        environment: 'local',
        scenario: 'orders',
        vus: 5,
        duration: '30s',
        gitSha: 'local',
        appVersion: '0.1.0',
      },
    );
    assert.equal(result.verdict, 'PASS');
    assert.equal(result.baseUrl, 'http://127.0.0.1:3000');
    assert.equal(result.expectedBusinessRejections.ORDERING_CLOSED, 1);
    assert.match(result.markdown, /Successful operations: 3/);
  });
  it('sanitizes localhost', () => {
    assert.equal(safeBaseUrl('http://localhost'), 'http://localhost');
  });
  it('preserves a loopback host and explicit port', () => {
    assert.equal(safeBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  });
  it('preserves HTTPS hosts', () => {
    assert.equal(safeBaseUrl('https://example.test'), 'https://example.test');
  });
  it('works when the runtime has no global URL constructor', () => {
    const originalUrl = globalThis.URL;
    try {
      globalThis.URL = undefined;
      assert.equal(
        safeBaseUrl('http://127.0.0.1:3000'),
        'http://127.0.0.1:3000',
      );
    } finally {
      globalThis.URL = originalUrl;
    }
  });
  it('strips credentials, query, fragment, and the root trailing slash', () => {
    assert.equal(
      safeBaseUrl('https://user:secret@example.test/api/?token=x#frag'),
      'https://example.test/api',
    );
    assert.equal(safeBaseUrl('https://example.test/'), 'https://example.test');
  });
  it('fails closed for malformed URLs', () => {
    assert.equal(safeBaseUrl('not-a-url'), 'unavailable');
    assert.equal(safeBaseUrl('https://example.test:bad'), 'unavailable');
  });
  it('does not leak URL credentials or query secrets', () => {
    const sanitized = safeBaseUrl(
      'https://user:secret@example.test/api?token=private#fragment',
    );
    assert.equal(sanitized, 'https://example.test/api');
    assert.doesNotMatch(sanitized, /user|secret|private|token|fragment/iu);
  });
  it('classifies the current EggShip error envelope by its allowlisted code', () => {
    assert.equal(
      classifyExpectedBusinessRejection({
        error: {
          code: 'INVENTORY_INSUFFICIENT_STOCK',
          message: 'must not be persisted',
          details: { phone: '+10000000000' },
        },
        requestId: 'request-id',
      }),
      'INVENTORY_INSUFFICIENT_STOCK',
    );
    assert.equal(
      classifyExpectedBusinessRejection({
        code: 'INVENTORY_INSUFFICIENT_STOCK',
      }),
      undefined,
    );
    assert.equal(
      classifyExpectedBusinessRejection({
        error: { code: 'NEW_UNKNOWN_CODE' },
      }),
      undefined,
    );
  });
  it('does not fabricate missing latency statistics', () => {
    assert.throws(
      () =>
        buildRel03Summary(
          { metrics: { http_req_duration: { values: { med: 10 } } } },
          { scenario: 'smoke', duration: '20s' },
        ),
      /missing required latency statistic: p90/u,
    );
  });
  it('does not serialize secrets, PII, cookies, or idempotency keys', () => {
    const result = JSON.stringify(
      buildRel03Summary(
        {
          metrics: {
            http_req_duration: {
              values: { med: 1, 'p(90)': 2, 'p(95)': 3, 'p(99)': 4, max: 5 },
            },
          },
        },
        {
          baseUrl: 'http://127.0.0.1:3000',
          environment: 'local',
          scenario: 'smoke',
          vus: 2,
          duration: '20s',
          gitSha: 'local',
          appVersion: '0.1.0',
        },
      ),
    );
    for (const secret of [
      'secret',
      'Authorization',
      'Cookie',
      'phone',
      'idempotencyKey',
    ])
      assert.doesNotMatch(result, new RegExp(secret, 'i'));
  });
});
