/**
 * Windows CreateProcess has a ~8191-character command-line limit. A full-repo
 * first commit stages hundreds of paths; listing them all for eslint/prettier
 * fails with "The command line is too long." Batch or fall back to repo-wide
 * commands when the staged set is large.
 *
 * @param {string[]} files
 * @param {(batch: string[]) => string} build
 * @param {string} fallback
 * @param {number} maxBatchChars
 * @returns {string[]}
 */
function batchOrFallback(files, build, fallback, maxBatchChars = 5500) {
  if (files.length === 0) {
    return [];
  }

  const batches = [];
  let current = [];
  let currentLen = 0;

  for (const file of files) {
    const addition = file.length + 3;
    if (current.length > 0 && currentLen + addition > maxBatchChars) {
      batches.push(build(current));
      current = [];
      currentLen = 0;
    }
    current.push(file);
    currentLen += addition;
  }

  if (current.length > 0) {
    batches.push(build(current));
  }

  // Extremely large staged sets: prefer one repo-wide pass over dozens of batches.
  if (batches.length > 8) {
    return [fallback];
  }

  return batches;
}

/** @type {import('lint-staged').Configuration} */
export default {
  '*.{ts,js,mjs,cjs}': (files) => [
    ...batchOrFallback(
      files,
      (batch) => `eslint --fix --max-warnings=0 ${batch.map(quote).join(' ')}`,
      'eslint --fix --max-warnings=0 .',
    ),
    ...batchOrFallback(
      files,
      (batch) => `prettier --write ${batch.map(quote).join(' ')}`,
      'prettier --write .',
    ),
  ],
  '*.{json,md,yml,yaml}': (files) =>
    batchOrFallback(
      files,
      (batch) => `prettier --write ${batch.map(quote).join(' ')}`,
      'prettier --write .',
    ),
  '*.prisma': 'prisma format --schema',
};

/**
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return `"${value.replaceAll('"', '\\"')}"`;
}
