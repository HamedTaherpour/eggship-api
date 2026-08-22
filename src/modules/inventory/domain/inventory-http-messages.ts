/**
 * Displayable Inventory messages (INV-02 HTTP + INV-03/INV-04 application contracts).
 * Stable English codes live on ApplicationError; messages are safe for UI.
 */
export const InventoryHttpMessage = {
  NOT_FOUND: 'موجودی این محصول پیدا نشد.',
  INVALID_QUANTITY: 'تعداد واردشده معتبر نیست.',
  INVALID_ADJUSTMENT: 'این تغییر موجودی با مقدار رزروشده سازگار نیست.',
  INSUFFICIENT_STOCK: 'موجودی برخی از محصولات برای ثبت سفارش کافی نیست.',
  RESERVATION_NOT_FOUND: 'رزرو موجودی این سفارش پیدا نشد.',
  RESERVATION_CONFLICT:
    'وضعیت رزرو موجودی این سفارش با عملیات درخواستی سازگار نیست.',
  SHIP_RESERVATION_CONFLICT:
    'وضعیت رزرو موجودی این سفارش با ارسال سازگار نیست.',
  IDEMPOTENCY_CONFLICT: 'این عملیات قبلاً با اطلاعات متفاوت ثبت شده است.',
  IDEMPOTENCY_KEY_REQUIRED: 'کلید یکتایی عملیات الزامی است.',
  IDEMPOTENCY_KEY_INVALID: 'کلید یکتایی عملیات معتبر نیست.',
  REASON_REQUIRED: 'دلیل تغییر موجودی الزامی است.',
  ADMIN_REQUIRED: 'این عملیات فقط برای مدیران مجاز است.',
} as const;
