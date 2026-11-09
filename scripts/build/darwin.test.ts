import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { darwinBuilderArgs } from './darwin'

const require = createRequire(import.meta.url)
const builder = require('electron-builder/out/builder')
const { Platform } = require('app-builder-lib')
const { Arch } = require('builder-util')
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory')
const config = load(readFileSync(join(import.meta.dir, '../../apps/electron/electron-builder.yml'), 'utf8')) as { mac: unknown }

for (const arch of ['arm64', 'x64'] as const) {
  test(`macOS packaging builds only ${arch} DMG and ZIP`, () => {
    const args = builder.configureBuildCommand(builder.createYargs()).parse(darwinBuilderArgs(arch))
    const raw = builder.normalizeOptions(args).targets.get(Platform.MAC)
    const targets = computeArchToTargetNamesMap(raw, { platformSpecificBuildOptions: config.mac }, Platform.MAC)
    expect([...targets].map(([targetArch, names]) => [Arch[targetArch], names])).toEqual([
      [arch, ['dmg', 'zip']],
    ])
  })
}
