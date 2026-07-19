import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { migrateLegacyAppDataEntries, migrateLegacyUserDirectory } from '../storage/vesper-migration.mjs'

test('legacy Pi user data is copied to the Vesper directory without deleting the source', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'vesper-user-dir-'))
  const sourceFile = join(home, '.pi', 'agent', 'settings.json')
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, '.pi', 'agent'), { recursive: true })
  await writeFile(sourceFile, '{"theme":"dark"}')

  const migration = await migrateLegacyUserDirectory({ home })
  assert.equal(migration.copied, true)
  assert.equal(await readFile(join(home, '.vesper', 'agent', 'settings.json'), 'utf8'), '{"theme":"dark"}')
  assert.equal(await readFile(sourceFile, 'utf8'), '{"theme":"dark"}')
  assert.equal((await migrateLegacyUserDirectory({ home })).copied, false)
})

test('legacy application data entries are renamed after the user directory is copied', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-data-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'pi-coder-assets'), { recursive: true })
  await writeFile(join(directory, 'pi-coder.json'), '{"toolMode":"workspace"}')
  await writeFile(join(directory, 'pi-coder-assets', 'asset.txt'), 'asset')

  const migrated = await migrateLegacyAppDataEntries(directory)
  assert.equal(migrated.length, 2)
  assert.equal(await readFile(join(directory, 'vesper.json'), 'utf8'), '{"toolMode":"workspace"}')
  assert.equal(await readFile(join(directory, 'vesper-assets', 'asset.txt'), 'utf8'), 'asset')
  await assert.rejects(readFile(join(directory, 'pi-coder.json'), 'utf8'), { code: 'ENOENT' })
})
