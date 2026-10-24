import { join, resolve } from 'node:path';
import { pathKey } from './paths.mjs';
export function sessionStorage({ agentDir, cwd, sessionDir, scope }) {
  const root = join(agentDir, 'sessions');
  const encoded = `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  const custom = pathKey(sessionDir) !== pathKey(join(root, encoded));
  return { directory: scope === 'current' || custom ? sessionDir : root,
    recursive: scope === 'all' && !custom, cwd: scope === 'current' ? cwd : undefined };
}
