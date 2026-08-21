/**
 * HTTP transport for Kavenegar verify/lookup. Injectable for unit tests.
 */
export interface KavenegarHttpTransport {
  postForm(
    url: string,
    body: URLSearchParams,
  ): Promise<{ status: number; bodyText: string }>;
}

export class FetchKavenegarHttpTransport implements KavenegarHttpTransport {
  constructor(private readonly timeoutMs = 10_000) {}

  async postForm(
    url: string,
    body: URLSearchParams,
  ): Promise<{ status: number; bodyText: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });
      return {
        status: response.status,
        bodyText: await response.text(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
