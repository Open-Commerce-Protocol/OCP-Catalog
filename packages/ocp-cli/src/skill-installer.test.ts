import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctorOcpSkill, installOcpSkill, OCP_SKILL_MARKER, resolveSkillTargetDirs, uninstallOcpSkill } from './skill-installer';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OCP skill installer', () => {
  test('installs the bundled skill into an explicit skills directory', async () => {
    const target = await tempDir();

    const result = await installOcpSkill({ target });

    expect(result.ok).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.installed_dirs).toEqual([path.join(target, 'ocp-catalog')]);
    expect(existsSync(path.join(target, 'ocp-catalog', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(target, 'ocp-catalog', OCP_SKILL_MARKER))).toBe(true);

    const skill = await readFile(path.join(target, 'ocp-catalog', 'SKILL.md'), 'utf8');
    expect(skill).toContain('name: ocp-catalog');
    expect(skill).not.toContain('packages/ocp-cli');

    const marker = JSON.parse(await readFile(path.join(target, 'ocp-catalog', OCP_SKILL_MARKER), 'utf8'));
    expect(marker).toMatchObject({
      package_name: '@ocp-catalog/ocp-cli',
      package_version: '0.1.0',
      skill_name: 'ocp-catalog',
    });
    expect(marker.content_hash).toBeString();
  });

  test('dry-run returns the plan without writing files', async () => {
    const target = await tempDir();

    const result = await installOcpSkill({ target, dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.installed_dirs).toEqual([]);
    expect(existsSync(path.join(target, 'ocp-catalog'))).toBe(false);
  });

  test('doctor reports installed skill validity', async () => {
    const target = await tempDir();
    await installOcpSkill({ target });

    const result = await doctorOcpSkill(target);

    expect(result.targets).toEqual([{
      kind: 'custom',
      skills_dir: path.resolve(target),
      install_dir: path.join(path.resolve(target), 'ocp-catalog'),
      installed: true,
      valid: true,
      managed: true,
      marker: expect.objectContaining({
        package_name: '@ocp-catalog/ocp-cli',
        skill_name: 'ocp-catalog',
      }),
    }]);
  });

  test('refuses to overwrite unmanaged skill directories without force', async () => {
    const target = await tempDir();
    await mkdir(path.join(target, 'ocp-catalog'), { recursive: true });
    await writeFile(path.join(target, 'ocp-catalog', 'SKILL.md'), '---\nname: ocp-catalog\n---\n');

    await expect(installOcpSkill({ target })).rejects.toThrow('Refusing to overwrite unmanaged skill');

    const result = await installOcpSkill({ target, force: true });
    expect(result.force).toBe(true);
    expect(existsSync(path.join(target, 'ocp-catalog', OCP_SKILL_MARKER))).toBe(true);
  });

  test('uninstalls managed skill directories and refuses unmanaged directories', async () => {
    const target = await tempDir();
    await installOcpSkill({ target });

    const removed = await uninstallOcpSkill({ target });
    expect(removed.removed_dirs).toEqual([path.join(target, 'ocp-catalog')]);
    expect(existsSync(path.join(target, 'ocp-catalog'))).toBe(false);

    await mkdir(path.join(target, 'ocp-catalog'), { recursive: true });
    await writeFile(path.join(target, 'ocp-catalog', 'SKILL.md'), '---\nname: ocp-catalog\n---\n');
    await expect(uninstallOcpSkill({ target })).rejects.toThrow('Refusing to uninstall unmanaged skill');
  });

  test('both target resolves codex and agents skill directories', () => {
    const targets = resolveSkillTargetDirs('both');

    expect(targets.some((item) => item.replaceAll('\\', '/').endsWith('/.agents/skills'))).toBe(true);
    expect(targets.some((item) => item.replaceAll('\\', '/').endsWith('/.codex/skills'))).toBe(true);
  });
});

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ocp-skill-install-'));
  tempDirs.push(dir);
  return dir;
}
