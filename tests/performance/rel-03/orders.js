import { check } from 'k6';
/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import {
  base,
  auth,
  users,
  products,
  pick,
  submissions,
  successfulOrders,
  expectedRejections,
  unexpectedFailures,
  recordStatus,
  successfulOperations,
  recordExpectedBusinessRejection,
} from './common.js';
export { handleSummary, options } from './common.js';
export default function () {
  const token = pick(users());
  const key = `00000000-0000-4000-8000-${String(__VU).padStart(6, '0')}${String(__ITER).padStart(6, '0')}`;
  submissions.add(1);
  const response = http.post(
    `${base()}/api/v1/orders`,
    JSON.stringify({
      regionId: __ENV.LOAD_TEST_REGION_ID,
      lines: [{ productId: pick(products()), quantity: 1 }],
    }),
    {
      ...auth(token),
      headers: { ...auth(token).headers, 'Idempotency-Key': key },
    },
  );
  recordStatus(response);
  let body = {};
  try {
    body = response.json() || {};
  } catch {
    unexpectedFailures.add(1);
  }
  const businessReject =
    response.status === 400 ||
    response.status === 409 ||
    response.status === 422 ||
    response.status === 503;
  if (businessReject && body.error) expectedRejections.add(1);
  else if (response.status === 201 || response.status === 200) {
    successfulOrders.add(1);
    successfulOperations.add(1);
  } else unexpectedFailures.add(1);
  if (businessReject && body.error) recordExpectedBusinessRejection(response);
  check(response, {
    'order response is classified': () =>
      businessReject || response.status === 200 || response.status === 201,
  });
}
