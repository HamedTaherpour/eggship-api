/* global __ENV */
import { get, record, auth } from './common.js';
export { handleSummary, options } from './common.js';
export default function () {
  const headers = auth(__ENV.LOAD_TEST_ADMIN_TOKEN);
  record(get('/api/v1/admin/analytics/today-pulse', headers));
  record(
    get(
      '/api/v1/admin/analytics/sales-overview?from=2026-01-01&to=2026-01-02',
      headers,
    ),
  );
  record(
    get(
      '/api/v1/admin/analytics/top-products?from=2026-01-01&to=2026-01-02&limit=10',
      headers,
    ),
  );
  if (__ENV.LOAD_TEST_PRODUCT_IDS)
    record(
      get(
        `/api/v1/admin/analytics/products/${__ENV.LOAD_TEST_PRODUCT_IDS.split(',')[0]}/stock`,
        headers,
      ),
    );
}
