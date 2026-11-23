'use strict'

/**
 * Copy a relocatable Git/Python tree without `cpSync({ dereference: true })`.
 *
 * Git for Windows' portable tarball ships MSYS2 Unix symlinks
 * (`dev/fd -> /proc/self/fd`, `etc/mtab -> /proc/mounts`). After extract those
 * links dangle on Windows; Bun then `stat`s them and throws ENOENT.
 *
 * Always skip `/dev` `/proc` `/sys`, out-of-tree, and dangling links.
 * POSIX desktop staging (`preserveSymlinks: true`) keeps safe in-tree *file*
 * symlinks (dugite `git-* -> git`, CPython `python3 -> python3.12`) so the
 * installer is not inflated by full copies. Windows keeps flattening in-tree
 * links into regular files so NSIS/afterPack never has to create symlinks.
 */

const {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} = require('fs')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('path')

/** Bump when the on-disk vendor layout changes so stale flattened trees re-extract. */
const HOST_RUNTIME_TREE_FORMAT = 2

function shouldPreserveRuntimeSymlinks(platform) {
  return platform !== 'win32'
}

function isVirtualUnixTarget(target) {
  const posix = String(target).replace(/\\/g, '/')
  return posix === '/dev' || posix.startsWith('/dev/')
    || posix === '/proc' || posix.startsWith('/proc/')
    || posix === '/sys' || posix.startsWith('/sys/')
}

function isInsideTree(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function copyRuntimeTree(source, destination, options) {
  const preserveSymlinks = Boolean(options && options.preserveSymlinks)
  copyRuntimeNode(source, destination, resolve(source), new Set(), preserveSymlinks)
}

function replaceTree(source, destination, options) {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  copyRuntimeTree(source, destination, options)
}

function preservedLinkTarget(source, target, resolvedTarget) {
  if (!isAbsolute(target)) return target
  const relativeTarget = relative(dirname(source), resolvedTarget)
  if (!relativeTarget || isAbsolute(relativeTarget)) return null
  return relativeTarget.split(sep).join('/')
}

function copyRuntimeNode(source, destination, treeRoot, walkStack, preserveSymlinks) {
  let sourceStat
  try {
    sourceStat = lstatSync(source)
  } catch {
    return
  }

  if (sourceStat.isSymbolicLink()) {
    let target
    try {
      target = readlinkSync(source)
    } catch {
      return
    }
    if (isVirtualUnixTarget(target)) return
    const resolvedTarget = isAbsolute(target)
      ? resolve(target)
      : resolve(dirname(source), target)
    if (!isInsideTree(treeRoot, resolvedTarget)) return
    let followed
    try {
      followed = statSync(source)
    } catch {
      return
    }
    if (preserveSymlinks && followed.isFile()) {
      const linkTarget = preservedLinkTarget(source, target, resolvedTarget)
      if (!linkTarget) return
      mkdirSync(dirname(destination), { recursive: true })
      try { rmSync(destination, { force: true }) } catch { /* dest may not exist */ }
      symlinkSync(linkTarget, destination)
      return
    }
    sourceStat = followed
  }

  if (sourceStat.isDirectory()) {
    let real = source
    try {
      real = realpathSync(source)
    } catch {
      /* keep source */
    }
    if (walkStack.has(real)) return
    walkStack.add(real)
    mkdirSync(destination, { recursive: true })
    for (const name of readdirSync(source)) {
      copyRuntimeNode(join(source, name), join(destination, name), treeRoot, walkStack, preserveSymlinks)
    }
    walkStack.delete(real)
    return
  }

  if (sourceStat.isFile()) {
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    try {
      chmodSync(destination, sourceStat.mode & 0o777)
    } catch {
      /* Windows */
    }
  }
}

module.exports = {
  HOST_RUNTIME_TREE_FORMAT,
  copyRuntimeTree,
  replaceTree,
  shouldPreserveRuntimeSymlinks,
}
