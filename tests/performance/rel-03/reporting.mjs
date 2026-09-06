const rejectionMetricCodes = {
  ORDER_IDEMPOTENCY_CONFLICT: 'expected_rejection_order_idempotency_conflict',
  ORDERING_CLOSED: 'expected_rejection_ordering_closed',
  ORDERING_POLICY_UNAVAILABLE: 'expected_rejection_ordering_policy_unavailable',
  ORDER_MINIMUM_QUANTITY_NOT_MET:
    'expected_rejection_order_minimum_quantity_not_met',
  INVENTORY_INSUFFICIENT_STOCK:
    'expected_rejection_inventory_insufficient_stock',
  INVENTORY_NOT_FOUND: 'expected_rejection_inventory_not_found',
  INVENTORY_RESERVATION_CONFLICT:
    'expected_rejection_inventory_reservation_conflict',
  IDEMPOTENCY_CONFLICT: 'expected_rejection_idempotency_conflict',
  ORDER_INVALID_INPUT: 'expected_rejection_order_invalid_input',
  ORDER_INVALID_USER: 'expected_rejection_order_invalid_user',
  ORDER_INVALID_REGION: 'expected_rejection_order_invalid_region',
  ORDER_INVALID_PRODUCT: 'expected_rejection_order_invalid_product',
};

export function classifyExpectedBusinessRejection(body) {
  const code = body?.error?.code;
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(rejectionMetricCodes, code)
    ? code
    : undefined;
}

const requiredTrendStatistics = [
  ['p50', 'med'],
  ['p90', 'p(90)'],
  ['p95', 'p(95)'],
  ['p99', 'p(99)'],
  ['max', 'max'],
];

function requiredMetricValue(metric, label, key) {
  const value = metric[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(
      `REL-03 summary is missing required latency statistic: ${label}`,
    );
  return value;
}

export function safeBaseUrl(raw) {
  try {
    if (typeof raw !== 'string') return 'unavailable';
    const match = raw.match(
      /^(https?):\/\/([^/?#]*)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/iu,
    );
    if (!match) return 'unavailable';

    const protocol = match[1].toLowerCase();
    const authority = match[2];
    const path = match[3] || '';
    const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
    if (!hostPort || hostPort.includes('@') || /[\s\\]/u.test(hostPort))
      return 'unavailable';

    let hostname = hostPort;
    let port = '';
    if (hostPort.startsWith('[')) {
      const closingBracket = hostPort.indexOf(']');
      if (closingBracket < 0) return 'unavailable';
      hostname = hostPort.slice(0, closingBracket + 1);
      port = hostPort.slice(closingBracket + 1);
      if (port && !/^:\d+$/u.test(port)) return 'unavailable';
    } else {
      const separator = hostPort.lastIndexOf(':');
      if (separator >= 0) {
        hostname = hostPort.slice(0, separator);
        port = hostPort.slice(separator);
        if (!/^:\d+$/u.test(port)) return 'unavailable';
      }
    }
    if (
      !hostname ||
      (hostname.startsWith('[')
        ? !/^\[[0-9a-f:.]+\]$/iu.test(hostname)
        : !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu.test(hostname))
    )
      return 'unavailable';
    if (port && (Number(port.slice(1)) < 1 || Number(port.slice(1)) > 65535))
      return 'unavailable';

    if (/[\s\\]/u.test(path)) return 'unavailable';
    const sanitizedPath = path.replace(/\/+$/u, '');
    return `${protocol}://${hostname.toLowerCase()}${port}${sanitizedPath}`;
  } catch {
    return 'unavailable';
  }
}

export function buildRel03Summary(data, context) {
  const metric = data.metrics.http_req_duration?.values;
  if (!metric)
    throw new Error('REL-03 summary is missing http_req_duration metrics');
  const counts = data.metrics.http_reqs?.values || {};
  const count = (name) => data.metrics[name]?.values?.count || 0;
  const business = {
    submissions: count('order_submissions'),
    iterations: data.metrics.iterations?.values?.count || 0,
    successfulOperations:
      count('successful_operations') || count('successful_orders'),
    successfulOrders: count('successful_orders'),
    expectedBusinessRejections: count('expected_business_rejections'),
    unexpectedFailures: count('unexpected_failures'),
  };
  const expectedBusinessRejections = Object.fromEntries(
    Object.entries(rejectionMetricCodes)
      .map(([code, metricName]) => [code, count(metricName)])
      .filter(([, value]) => value > 0),
  );
  const unclassified = count('expected_rejection_unclassified');
  if (unclassified) expectedBusinessRejections.UNCLASSIFIED = unclassified;
  const durationSeconds = Number.parseInt(context.duration, 10) || 0;
  const result = {
    timestamp: new Date().toISOString(),
    scenario: context.scenario || 'unknown',
    environment: context.environment || 'unknown',
    baseUrl: context.baseUrl,
    gitSha: context.gitSha,
    appVersion: context.appVersion,
    execution: { vus: context.vus, duration: context.duration },
    submissions: business.submissions,
    iterations: business.iterations,
    requests: counts.count || 0,
    throughputRps: durationSeconds ? (counts.count || 0) / durationSeconds : 0,
    statusClasses: Object.fromEntries(
      ['2xx', '3xx', '4xx', '5xx'].map((key) => [key, count(`status_${key}`)]),
    ),
    latencyMs: {
      ...Object.fromEntries(
        requiredTrendStatistics.map(([label, key]) => [
          label,
          requiredMetricValue(metric, label, key),
        ]),
      ),
      median: requiredMetricValue(metric, 'p50', 'med'),
    },
    successfulOperations: business.successfulOperations,
    successfulOrders: business.successfulOrders,
    expectedBusinessRejections: expectedBusinessRejections,
    expectedBusinessRejectionCount: business.expectedBusinessRejections,
    unexpectedFailures: business.unexpectedFailures,
    verdict: business.unexpectedFailures === 0 ? 'PASS' : 'FAIL',
  };
  result.markdown = `# REL-03 ${result.scenario}\n\n- Verdict: **${result.verdict}**\n- Environment: ${result.environment}\n- Base URL: ${result.baseUrl}\n- Timestamp: ${result.timestamp}\n- Execution: ${result.execution.vus} VUs / ${result.execution.duration}\n- Requests: ${result.requests}\n- Successful operations: ${result.successfulOperations}\n- Expected business rejections: ${result.expectedBusinessRejectionCount}\n- Unexpected failures: ${result.unexpectedFailures}\n- Latency ms: median ${result.latencyMs.median}, p90 ${result.latencyMs.p90}, p95 ${result.latencyMs.p95}, p99 ${result.latencyMs.p99}, max ${result.latencyMs.max}\n- Rejection codes: ${JSON.stringify(result.expectedBusinessRejections)}\n\nThese are local/staging harness-correctness results, not capacity or SLA claims.\n`;
  return result;
}

export { rejectionMetricCodes };
