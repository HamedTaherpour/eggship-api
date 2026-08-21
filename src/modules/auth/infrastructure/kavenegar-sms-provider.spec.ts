import {
  buildKavenegarLookupUrl,
  isKavenegarSuccess,
  KavenegarSmsProvider,
  toKavenegarReceptor,
} from './kavenegar-sms-provider';
import type { KavenegarHttpTransport } from './kavenegar-http-transport';
import { SmsDeliveryError } from '../domain/sms-provider';

describe('KavenegarSmsProvider', () => {
  it('formats Iranian canonical phones as domestic 09 receptors', () => {
    expect(toKavenegarReceptor('+989121234567')).toBe('09121234567');
  });

  it('builds verify/lookup request without leaking credentials in helpers', () => {
    const url = buildKavenegarLookupUrl(
      'https://api.kavenegar.com',
      'test-api-key',
    );
    expect(url).toBe(
      'https://api.kavenegar.com/v1/test-api-key/verify/lookup.json',
    );
  });

  it('posts receptor, token, and template through the transport', async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const transport: KavenegarHttpTransport = {
      postForm: (
        url: string,
        body: URLSearchParams,
      ): Promise<{ status: number; bodyText: string }> => {
        calls.push({ url, body });
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({ return: { status: 200, message: 'OK' } }),
        });
      },
    };

    const provider = new KavenegarSmsProvider({
      apiKey: 'test-api-key',
      template: 'eggship-otp',
      transport,
      baseUrl: 'https://api.kavenegar.com',
    });

    await provider.sendOtp({ phone: '+989121234567', code: '482913' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/v1/test-api-key/verify/lookup.json');
    expect(calls[0]?.body.get('receptor')).toBe('09121234567');
    expect(calls[0]?.body.get('token')).toBe('482913');
    expect(calls[0]?.body.get('template')).toBe('eggship-otp');
  });

  it('maps provider failures to SmsDeliveryError without exposing body text', async () => {
    const transport: KavenegarHttpTransport = {
      postForm: (): Promise<{ status: number; bodyText: string }> =>
        Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({
            return: { status: 424, message: 'template missing secret detail' },
          }),
        }),
    };
    const provider = new KavenegarSmsProvider({
      apiKey: 'test-api-key',
      template: 'eggship-otp',
      transport,
    });

    await expect(
      provider.sendOtp({ phone: '+989121234567', code: '482913' }),
    ).rejects.toBeInstanceOf(SmsDeliveryError);

    await expect(
      provider.sendOtp({ phone: '+989121234567', code: '482913' }),
    ).rejects.not.toThrow(/template missing/u);
  });

  it('recognizes Kavenegar success envelopes', () => {
    expect(
      isKavenegarSuccess(
        200,
        JSON.stringify({ return: { status: 200, message: 'OK' } }),
      ),
    ).toBe(true);
    expect(
      isKavenegarSuccess(
        200,
        JSON.stringify({ return: { status: 418, message: 'no credit' } }),
      ),
    ).toBe(false);
    expect(isKavenegarSuccess(500, '{}')).toBe(false);
  });
});
