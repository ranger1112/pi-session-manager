import { join, resolve } from 'node:path';
export function sessionStorage({ agentDir, cwd, sessionDir, scope }) {
  const root = join(agentDir, 'sessions');
  const encoded = `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  const custom = normalize(sessionDir) !== normalize(join(root, encoded));
  return { directory: scope === 'current' || custom ? sessionDir : root,
    recursive: scope === 'all' && !custom, cwd: scope === 'current' ? cwd : undefined };
}
