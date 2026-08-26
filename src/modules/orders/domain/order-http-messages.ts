/**
 * Displayable Order HTTP boundary messages (ORD-03A).
 * Stable English codes live on ApplicationError / BadRequestException bodies.
 */
export const OrderHttpMessage = {
  IDEMPOTENCY_KEY_REQUIRED:
    '\u06A9\u0644\u06CC\u062F \u06CC\u06A9\u062A\u0627\u06CC\u06CC \u0639\u0645\u0644\u06CC\u0627\u062A \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A.',
  IDEMPOTENCY_KEY_INVALID:
    '\u06A9\u0644\u06CC\u062F \u06CC\u06A9\u062A\u0627\u06CC\u06CC \u0639\u0645\u0644\u06CC\u0627\u062A \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A.',
} as const;
