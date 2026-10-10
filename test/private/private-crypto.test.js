import { describe, it, expect } from 'vitest';

const c = await import('../../src/private/private-crypto.js');

describe('private folder keys', () => {
  it('recovery codes round-trip and forgive typing slips', () => {
    const code = c.generateRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);

    const bytes = c.recoveryCodeBytes(code);
    expect(bytes).toHaveLength(20);
    expect([...c.recoveryCodeBytes(code.toLowerCase().replace(/-/g, ' '))]).toEqual([...bytes]);
    expect([...c.recoveryCodeBytes(code.replace(/0/g, 'O').replace(/1/g, 'l'))]).toEqual([...bytes]);
    expect(c.recoveryCodeBytes('too short')).toBeNull();
  });

  it('the folder key opens with password or recovery code, bound to its folder', async () => {
    const key = c.generateFolderKey();
    const code = c.generateRecoveryCode();
    const pw = await c.wrapWithPassword(key, 'ordnerpw1', 'pf1');
    const rc = await c.wrapWithRecoveryCode(key, code, 'pf1');

    expect([...(await c.unwrapWithPassword(pw, 'ordnerpw1', 'pf1'))]).toEqual([...key]);
    expect(await c.unwrapWithPassword(pw, 'falsch', 'pf1')).toBeNull();
    expect(await c.unwrapWithPassword(pw, 'ordnerpw1', 'pf2')).toBeNull();

    expect([...(await c.unwrapWithRecoveryCode(rc, code, 'pf1'))]).toEqual([...key]);
    expect(await c.unwrapWithRecoveryCode(rc, c.generateRecoveryCode(), 'pf1')).toBeNull();
  }, 30_000);

  it('entries hide the doc name and open only under their key and folder', async () => {
    const key = c.generateFolderKey();
    const update = new TextEncoder().encode('Kolibri update');
    const sealed = await c.sealEntry(key, 'pf1', 'n:abc', update);

    expect(new TextDecoder().decode(sealed)).not.toContain('Kolibri');
    expect(new TextDecoder().decode(sealed)).not.toContain('n:abc');

    const opened = await c.openEntry(key, 'pf1', sealed);
    expect(opened.docName).toBe('n:abc');
    expect(new TextDecoder().decode(opened.update)).toBe('Kolibri update');

    expect(await c.openEntry(key, 'pf2', sealed)).toBeNull();
    expect(await c.openEntry(c.generateFolderKey(), 'pf1', sealed)).toBeNull();
  });
});
