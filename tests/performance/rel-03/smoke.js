import { get, record } from './common.js';
export { handleSummary, options } from './common.js';
export default function () {
  record(get('/api/v1/health'));
}
