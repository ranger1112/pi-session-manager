import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { messages, resolveLanguage } from '../src/i18n.mjs';
import { readLanguage, saveLanguage } from '../src/preferences.mjs';

test('两种语言文案键与嵌套分类原因完整一致', () => {
  const keys = value => Object.entries(value).flatMap(([k, v]) => typeof v === 'object'
    ? keys(v).map(child => `${k}.${child}`) : k).sort();
  assert.deepEqual(keys(messages.en), keys(messages['zh-CN']));
});

test('语言覆盖优先，环境按 LC_ALL/LC_MESSAGES/LANG 优先，未知回退英文', () => {
  assert.equal(resolveLanguage('zh-CN', { LC_ALL: 'en_US.UTF-8' }), 'zh-CN');
  assert.equal(resolveLanguage('en', { LANG: 'zh_CN.UTF-8' }), 'en');
  assert.equal(resolveLanguage('auto', { LC_ALL: 'en_US', LANG: 'zh_CN' }), 'en');
  assert.equal(resolveLanguage('auto', { LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en' }), 'zh-CN');
  assert.equal(resolveLanguage('auto', { LANG: 'zh-CN' }), 'zh-CN');
  assert.equal(resolveLanguage('auto', {}, 'zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveLanguage('auto', { LANG: 'C' }, 'zh-CN'), 'en');
  assert.equal(resolveLanguage('auto', {}, 'de-DE'), 'en');
});

test('语言偏好可持久化和重置，不修改其他配置，损坏配置回退自动', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-language-'));
  try {
    const settings = join(dir, 'settings.json');
    await writeFile(settings, '{"private":"unchanged"}');
    assert.equal(await readLanguage(dir), 'auto');
    await saveLanguage(dir, 'en');
    assert.equal(await readLanguage(dir), 'en');
    await saveLanguage(dir, 'zh-CN');
    assert.equal(await readLanguage(dir), 'zh-CN');
    await saveLanguage(dir, 'auto');
    assert.equal(await readLanguage(dir), 'auto');
    await assert.rejects(saveLanguage(dir, 'fr'), /Unsupported/);
    assert.equal(await readFile(settings, 'utf8'), '{"private":"unchanged"}');
    for (const content of ['broken', 'null', '{"language":"fr"}']) {
      await writeFile(join(dir, 'pi-main-session-manager.json'), content);
      assert.equal(await readLanguage(dir), 'auto');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
