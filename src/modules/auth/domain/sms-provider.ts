/**
 * Minimal SMS delivery port for OTP. Auth application code must not import
 * provider SDKs; adapters live under infrastructure.
 */
export interface SmsProvider {
  sendOtp(input: { phone: string; code: string }): Promise<void>;
}

export class SmsDeliveryError extends Error {
  constructor(message = 'OTP SMS delivery failed.') {
    super(message);
    this.name = 'SmsDeliveryError';
  }
}
