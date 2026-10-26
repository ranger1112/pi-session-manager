import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveLanguage } from './i18n.mjs';

export const languageModes = ['auto', 'zh-CN', 'en'];
const filename = agentDir => join(agentDir, 'pi-main-session-manager.json');

export async function readLanguage(agentDir) {
  try {
    const value = JSON.parse(await readFile(filename(agentDir), 'utf8'));
    return languageModes.includes(value?.language) ? value.language : 'auto';
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return 'auto';
    throw error;
  }
}

export async function saveLanguage(agentDir, language) {
  if (!languageModes.includes(language)) throw new Error('Unsupported language');
  await mkdir(agentDir, { recursive: true });
  const target = filename(agentDir), temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ language }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function interfaceLanguage(agentDir) {
  return resolveLanguage(await readLanguage(agentDir));
}
