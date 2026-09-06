import { get, record, users, orders, pick, auth } from './common.js';
export { handleSummary, options } from './common.js';
export default function () {
  const token = pick(users());
  record(get('/api/v1/auth/me', auth(token)));
  const response = get('/api/v1/orders?page=1&pageSize=20', auth(token));
  if (record(response) && orders().length)
    record(get(`/api/v1/orders/${pick(orders())}`, auth(token)));
}
