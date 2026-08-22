/**
 * Displayable Order messages. Stable English codes live on ApplicationError;
 * these strings are safe for UI.
 */
export const OrderMessage = {
  NOT_FOUND: 'سفارش پیدا نشد.',
  INVALID_TRANSITION: 'وضعیت فعلی سفارش با این عملیات سازگار نیست.',
  CUSTOMER_CANCEL_DENIED: 'این سفارش دیگر قابل لغو نیست.',
  CANCELLATION_REASON_REQUIRED: 'دلیل لغو سفارش الزامی است.',
  INVALID_INPUT: 'درخواست نامعتبر است.',
  INVALID_DELIVERY_AT: 'زمان تحویل نامعتبر است.',
} as const;
