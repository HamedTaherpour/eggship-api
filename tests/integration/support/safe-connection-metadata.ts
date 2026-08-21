export interface SafeConnectionMetadata {
  protocol: string;
  host: string;
  port?: string;
  path?: string;
}

export type ConnectionKind = 'postgres' | 'redis';

/**
 * Returns host-level metadata only. Never include credentials or full URLs.
 */
export function safeConnectionMetadata(
  urlText: string,
  kind: ConnectionKind,
): SafeConnectionMetadata | undefined {
  try {
    const url = new URL(urlText);
    const protocolOk =
      kind === 'postgres'
        ? url.protocol === 'postgresql:' || url.protocol === 'postgres:'
        : url.protocol === 'redis:' || url.protocol === 'rediss:';
    if (!protocolOk || url.hostname === '') {
      return undefined;
    }
    return {
      protocol: url.protocol.replace(/:$/u, ''),
      host: url.hostname,
      ...(url.port === '' ? {} : { port: url.port }),
      ...(url.pathname === '' || url.pathname === '/'
        ? {}
        : { path: url.pathname }),
    };
  } catch {
    return undefined;
  }
}
