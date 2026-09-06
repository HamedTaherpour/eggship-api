/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  buildRel03Summary,
  classifyExpectedBusinessRejection,
  rejectionMetricCodes,
  safeBaseUrl,
} from './reporting.mjs';

export const options = {
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export const submissions = new Counter('order_submissions');
export const successfulOrders = new Counter('successful_orders');
export const expectedRejections = new Counter('expected_business_rejections');
export const unexpectedFailures = new Counter('unexpected_failures');
export const successfulOperations = new Counter('successful_operations');
export const expectedBusinessRejectionCodes = Object.fromEntries(
  Object.entries(rejectionMetricCodes).map(([code, metricName]) => [
    code,
    new Counter(metricName),
  ]),
);
export const unclassifiedExpectedRejections = new Counter(
  'expected_rejection_unclassified',
);
export const statusClasses = {
  '2xx': new Counter('status_2xx'),
  '3xx': new Counter('status_3xx'),
  '4xx': new Counter('status_4xx'),
  '5xx': new Counter('status_5xx'),
};

const csv = (name) =>
  String(__ENV[name] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
export const users = () => csv('LOAD_TEST_USER_TOKENS');
export const products = () => csv('LOAD_TEST_PRODUCT_IDS');
export const orders = () => csv('LOAD_TEST_ORDER_IDS');
export const base = () =>
  String(__ENV.LOAD_TEST_BASE_URL || '').replace(/\/$/u, '');
export const auth = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
export const pick = (items) => items[(__VU + __ITER) % items.length];
export function get(path, params = {}) {
  return http.get(`${base()}${path}`, params);
}
export function recordStatus(response) {
  const klass = `${Math.floor(response.status / 100)}xx`;
  if (statusClasses[klass]) statusClasses[klass].add(1);
}
export function record(
  response,
  predicate = (status) => status >= 200 && status < 300,
) {
  recordStatus(response);
  const ok = check(response, {
    'status is expected': (r) => predicate(r.status),
    'response is JSON': (r) =>
      String(r.headers['Content-Type'] || '').includes('application/json'),
  });
  if (ok) successfulOperations.add(1);
  if (!ok) unexpectedFailures.add(1);
  return ok;
}
export function handleSummary(data) {
  const result = buildRel03Summary(data, {
    baseUrl: safeBaseUrl(__ENV.LOAD_TEST_BASE_URL),
    environment: __ENV.LOAD_TEST_ENV,
    scenario: __ENV.LOAD_TEST_SCENARIO,
    vus: Number(__ENV.LOAD_TEST_VUS || 0),
    duration: __ENV.LOAD_TEST_DURATION || 'unknown',
    gitSha: __ENV.GIT_SHA || 'unknown',
    appVersion: __ENV.APP_VERSION || 'unknown',
  });
  const stamp =
    __ENV.LOAD_TEST_ARTIFACT_STAMP ||
    new Date().toISOString().replace(/[:.]/gu, '-');
  const prefix = `artifacts/load-tests/${stamp}-${result.scenario}`;
  return {
    [`${prefix}.json`]: JSON.stringify(result, null, 2),
    [`${prefix}.md`]: result.markdown,
    stdout: JSON.stringify(result),
  };
}

export function recordExpectedBusinessRejection(response) {
  let body;
  try {
    body = response.json();
  } catch {
    body = undefined;
  }
  const code = classifyExpectedBusinessRejection(body);
  if (code) expectedBusinessRejectionCodes[code].add(1);
  else unclassifiedExpectedRejections.add(1);
}
