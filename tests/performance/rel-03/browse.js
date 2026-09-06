import { get, record, products, pick } from './common.js';
export { handleSummary, options } from './common.js';
export default function () {
  record(get('/api/v1/categories'));
  record(get('/api/v1/regions'));
  const response = get('/api/v1/products?page=1&pageSize=20');
  if (record(response) && products().length)
    record(get(`/api/v1/products/${pick(products())}`));
}
