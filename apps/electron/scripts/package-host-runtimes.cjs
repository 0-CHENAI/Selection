const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { create } = require('tar')
const { copyRuntimeTree, shouldPreserveRuntimeSymlinks } = require('../../../scripts/build/copy-runtime-tree.cjs')
const {
  ARCHIVE_MANIFEST_FORMAT,
  RUNTIME_STAMP_FILE,
  hostRuntimeArchiveDirectory,
  sha256File,
} = require('../src/main/host-runtime-archive.cjs')

// Each group describes a required file with platform-specific path alternatives.
const requiredFiles = {
  darwin: {
    git: [['bin/git'], ['libexec/git-core/git']],
    python: [['bin/python3', 'bin/python'], ['lib/python3.12/encodings/__init__.py']],
  },
  win32: {
    git: [['cmd/git.exe'], ['mingw64/bin/git.exe', 'ucrt64/bin/git.exe'],
      ['bin/bash.exe'], ['usr/bin/bash.exe']],
    python: [['python.exe'], ['python3.exe'], ['python312.dll'], ['Lib/encodings/__init__.py']],
  },
}

function packageHostRuntimeArchives(projectDir, resourcesBase, platform, arch) {
  const output = hostRuntimeArchiveDirectory(resourcesBase)
  mkdirSync(output, { recursive: true })
  for (const kind of ['git', 'python']) {
    const source = join(projectDir, 'vendor', kind)
    const staging = mkdtempSync(join(tmpdir(), 'selection-runtime-package-'))
    try {
      copyRuntimeTree(source, staging, { preserveSymlinks: shouldPreserveRuntimeSymlinks(platform) })

      const stampPath = join(staging, RUNTIME_STAMP_FILE)
      if (!existsSync(stampPath)) throw new Error(`Required host runtime is missing: vendor/${kind}`)
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
      if (stamp.kind !== kind || stamp.platform !== platform || stamp.arch !== arch) {
        throw new Error(`Host runtime vendor/${kind} is not built for ${platform}-${arch}`)
      }

      const checks = requiredFiles[platform][kind].map(alternatives => {
        const marker = alternatives.find(candidate => existsSync(join(staging, candidate)))
        if (!marker) throw new Error(`Required vendor/${kind} file missing: ${alternatives.join(' or ')}`)
        return { path: marker, sha256: sha256File(join(staging, marker)) }
      })

      const archive = join(output, `${kind}.tar.gz`)
      // Keep unchanged component payloads stable across application builds.
      create({ cwd: staging, file: archive, gzip: true, portable: true, mtime: new Date(0), sync: true }, ['.'])
      const manifest = { format: ARCHIVE_MANIFEST_FORMAT, stamp, archiveSha256: sha256File(archive), checks }
      writeFileSync(join(output, `${kind}.json`), JSON.stringify(manifest, null, 2))
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}

module.exports = { packageHostRuntimeArchives }
