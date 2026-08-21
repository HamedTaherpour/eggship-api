import './openapi-process-env';
import { writeOpenApiArtifact } from './openapi-artifact';

async function main(): Promise<void> {
  const path = await writeOpenApiArtifact();
  process.stdout.write(`Wrote OpenAPI document to ${path}\n`);
}

void main();
