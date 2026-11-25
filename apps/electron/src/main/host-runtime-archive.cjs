const { createHash } = require('node:crypto')
const { closeSync, openSync, readSync } = require('node:fs')
const { join, win32 } = require('node:path')

const ARCHIVE_MANIFEST_FORMAT = 1
const RUNTIME_STAMP_FILE = '.selection-runtime.json'

function hostRuntimeArchiveDirectory(resourcesBase) {
  return join(resourcesBase, 'vendor', 'host-runtime-archives')
}

function systemTar() {
  if (process.platform !== 'win32') return '/usr/bin/tar'
  return win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
}

function sha256File(file) {
  const fd = openSync(file, 'r')
  try {
    const block = Buffer.allocUnsafe(256 * 1024)
    const hash = createHash('sha256')
    let bytesRead
    while ((bytesRead = readSync(fd, block)) > 0) {
      hash.update(block.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

module.exports = { ARCHIVE_MANIFEST_FORMAT, RUNTIME_STAMP_FILE, hostRuntimeArchiveDirectory, systemTar, sha256File }
