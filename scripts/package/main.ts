// npm run package [<out-dir>] — builds the npm package (default dist/package). Publishing is a separate, deliberate step.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage } from './build.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(process.argv[2] ?? 'dist/package');
const { files } = buildPackage(repo, out);
process.stdout.write(`package: ${out} (${files.length} files)\n`);
