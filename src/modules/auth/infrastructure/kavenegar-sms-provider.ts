import { Injectable } from '@nestjs/common';
import { SmsDeliveryError, type SmsProvider } from '../domain/sms-provider';
import type { KavenegarHttpTransport } from './kavenegar-http-transport';

export interface KavenegarSmsProviderOptions {
  apiKey: string;
  template: string;
  transport: KavenegarHttpTransport;
  /**
   * Override for tests. Production uses https://api.kavenegar.com
   */
  baseUrl?: string;
}

/**
 * Kavenegar verify/lookup adapter.
 *
 * Contract (documented): POST /v1/{API-KEY}/verify/lookup.json
 * with receptor, token, template.
 *
 * Receptor formatting: Iranian E.164 +989… is sent as 09… national form for
 * domestic delivery; international numbers use 00{country}{national} per docs.
 *
 * Live credentialed verification is pending — unit tests use a fake transport.
 */
@Injectable()
export class KavenegarSmsProvider implements SmsProvider {
  private readonly apiKey: string;
  private readonly template: string;
  private readonly transport: KavenegarHttpTransport;
  private readonly baseUrl: string;

  constructor(options: KavenegarSmsProviderOptions) {
    this.apiKey = options.apiKey;
    this.template = options.template;
    this.transport = options.transport;
    this.baseUrl = options.baseUrl ?? 'https://api.kavenegar.com';
  }

  async sendOtp(input: { phone: string; code: string }): Promise<void> {
    const url = `${this.baseUrl}/v1/${this.apiKey}/verify/lookup.json`;
    const body = new URLSearchParams({
      receptor: toKavenegarReceptor(input.phone),
      token: input.code,
      template: this.template,
    });

    let response: { status: number; bodyText: string };
    try {
      response = await this.transport.postForm(url, body);
    } catch {
      throw new SmsDeliveryError('OTP SMS delivery failed.');
    }

    if (!isKavenegarSuccess(response.status, response.bodyText)) {
      throw new SmsDeliveryError('OTP SMS delivery failed.');
    }
  }
}

/**
 * Convert canonical +98… to Kavenegar receptor form.
 * Domestic Iran: 09xxxxxxxxx. Other E.164: 00{digits without +}.
 */
export function toKavenegarReceptor(canonicalPhone: string): string {
  if (canonicalPhone.startsWith('+98') && canonicalPhone.length === 13) {
    return `0${canonicalPhone.slice(3)}`;
  }
  if (canonicalPhone.startsWith('+')) {
    return `00${canonicalPhone.slice(1)}`;
  }
  return canonicalPhone;
}

/**
 * Kavenegar returns HTTP 200 with a JSON return.status; treat non-success
 * safely without leaking provider payloads to callers.
 */
export function isKavenegarSuccess(
  httpStatus: number,
  bodyText: string,
): boolean {
  if (httpStatus < 200 || httpStatus >= 300) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    const returnBlock = (parsed as { return?: unknown }).return;
    if (typeof returnBlock !== 'object' || returnBlock === null) {
      return false;
    }
    const status = (returnBlock as { status?: unknown }).status;
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * Builds the lookup URL path segment pattern for tests (API key redacted in assertions).
 */
export function buildKavenegarLookupUrl(
  baseUrl: string,
  apiKey: string,
): string {
  return `${baseUrl}/v1/${apiKey}/verify/lookup.json`;
}
