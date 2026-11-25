/**
 * Writes the synthetic sample statements as PDFs for the web demo ("Try a sample").
 * Run: npm run samples
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSamplePdf, samples } from '../packages/core/test/fixtures/samples.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/public/samples');
mkdirSync(outDir, { recursive: true });

const index = [];
for (const s of samples) {
  const file = `${s.id}.pdf`;
  writeFileSync(join(outDir, file), await renderSamplePdf(s));
  index.push({
    id: s.id,
    file,
    country: s.country,
    currency: s.currency,
    title: s.title,
    description: s.description,
    ...(s.group ? { group: s.group } : {}),
  });
  console.log(`wrote samples/${file}`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
