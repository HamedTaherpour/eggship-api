import { BlogInvalidBodyError } from './blog-errors';

export type BlogDirective =
  | { name: 'aparat'; id: string }
  | { name: 'media'; id: string; alt?: string; caption?: string };

const DIRECTIVE = /^::([a-z][a-z0-9-]*)\[((?:[^\\\]]|\\.)*)\]$/u;
const APARAT_ID = /^[a-z0-9]{3,32}$/iu;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Token-scans the approved Markdown profile without rendering or executing it. */
export function validateBlogMarkdown(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0)
    throw new BlogInvalidBodyError('Blog body must contain Markdown source.');
  if (Array.from(raw.trim()).length > 100000)
    throw new BlogInvalidBodyError('Blog body is too long.');
  if (
    /<\/?(?:script|iframe|object|embed|style|form|svg)(?:\s|>|\/)/iu.test(
      raw,
    ) ||
    /<[^>]+>/u.test(raw)
  ) {
    throw new BlogInvalidBodyError(
      'Raw HTML is not supported in Blog Markdown.',
    );
  }
  for (const match of raw.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1]!.trim().split(/\s+/u)[0]!;
    if (
      match[0].startsWith('!') ||
      target.startsWith('data:') ||
      target.startsWith('javascript:') ||
      target.startsWith('vbscript:')
    ) {
      throw new BlogInvalidBodyError(
        'Unsafe Markdown URL or remote image is not supported.',
      );
    }
    if (!/^(?:https?:|mailto:)/iu.test(target))
      throw new BlogInvalidBodyError(
        'Markdown links must use https or mailto.',
      );
  }
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trimStart().startsWith('::')) continue;
    const parsed = parseBlogDirective(line.trim());
    if (parsed.name === 'media') continue;
  }
  return raw.trim();
}

export function parseBlogDirective(line: string): BlogDirective {
  const match = DIRECTIVE.exec(line);
  if (!match) throw new BlogInvalidBodyError('Malformed Blog directive.');
  const name = match[1];
  if (name !== 'aparat' && name !== 'media')
    throw new BlogInvalidBodyError('Unknown Blog directive.');
  const attrs = new Map<string, string>();
  const source = match[2]!;
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
    const name = /^[a-z][a-z0-9_]*/u.exec(source.slice(cursor));
    if (name === null)
      throw new BlogInvalidBodyError('Malformed Blog directive attributes.');
    cursor += name[0].length;
    while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
    if (source[cursor] !== '=')
      throw new BlogInvalidBodyError('Malformed Blog directive attributes.');
    cursor += 1;
    while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
    if (source[cursor] !== '"')
      throw new BlogInvalidBodyError('Malformed Blog directive attributes.');
    cursor += 1;
    let value = '';
    let closed = false;
    while (cursor < source.length) {
      const character = source[cursor]!;
      if (character === '"') {
        cursor += 1;
        closed = true;
        break;
      }
      if (character === '\\') {
        const escaped = source[cursor + 1];
        if (escaped !== '\\' && escaped !== '"')
          throw new BlogInvalidBodyError(
            'Malformed Blog directive attributes.',
          );
        value += escaped;
        cursor += 2;
      } else {
        value += character;
        cursor += 1;
      }
    }
    if (!closed)
      throw new BlogInvalidBodyError('Malformed Blog directive attributes.');
    if (attrs.has(name[0]))
      throw new BlogInvalidBodyError('Duplicate Blog directive attribute.');
    attrs.set(name[0], value);
    if (cursor < source.length && !/\s/u.test(source[cursor]!))
      throw new BlogInvalidBodyError('Malformed Blog directive attributes.');
  }
  if (!attrs.has('id'))
    throw new BlogInvalidBodyError('Blog directive requires id.');
  for (const key of attrs.keys())
    if (
      name === 'aparat' ? key !== 'id' : !['id', 'alt', 'caption'].includes(key)
    )
      throw new BlogInvalidBodyError('Unknown Blog directive attribute.');
  const id = attrs.get('id')!;
  if (name === 'aparat' && !APARAT_ID.test(id))
    throw new BlogInvalidBodyError('Aparat identifier is invalid.');
  if (name === 'media' && !UUID.test(id))
    throw new BlogInvalidBodyError('Media identifier is invalid.');
  if (name === 'aparat') return { name, id };
  return {
    name,
    id,
    ...(attrs.has('alt') ? { alt: attrs.get('alt') } : {}),
    ...(attrs.has('caption') ? { caption: attrs.get('caption') } : {}),
  };
}
