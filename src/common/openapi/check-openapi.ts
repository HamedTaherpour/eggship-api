import './openapi-process-env';
import { createOpenApiApplication } from './openapi-artifact';
import { assertOpenApiDocument } from './openapi-check';
import { createOpenApiDocument } from './openapi.document';

async function main(): Promise<void> {
  const app = await createOpenApiApplication();
  try {
    const document = createOpenApiDocument(app);
    const failures = assertOpenApiDocument(document);
    if (failures.length > 0) {
      for (const failure of failures) {
        process.stderr.write(`- ${failure.message}\n`);
      }
      process.exitCode = 1;
      return;
    }
    process.stdout.write('openapi:check ok\n');
  } finally {
    await app.close();
  }
}

void main();
