/** Editable project settings compared with the last loaded config. */

export interface ProjectSettingsDraft {
  name: string
  description: string
  workingDirectory: string
  details: string
  historySearch: boolean
  color: string
}

export function projectSettingsDraftFromConfig(config: {
  name: string
  description?: string
  workingDirectory?: string
  details?: string
  historySearchEnabled?: boolean
  color?: string
}): ProjectSettingsDraft {
  return {
    name: config.name,
    description: config.description ?? '',
    workingDirectory: config.workingDirectory ?? '',
    details: config.details ?? '',
    historySearch: config.historySearchEnabled === true,
    color: config.color ?? '',
  }
}

export function projectSettingsDraftDirty(stored: ProjectSettingsDraft, draft: ProjectSettingsDraft): boolean {
  return stored.name !== draft.name
    || stored.description !== draft.description
    || stored.workingDirectory !== draft.workingDirectory
    || stored.details !== draft.details
    || stored.historySearch !== draft.historySearch
    || stored.color !== draft.color
}

/**
 * Keep fields the user changed. Fields still equal to the previous config
 * take the newly loaded value, so a broadcast cannot clobber another edit
 * or be overwritten by a stale copy of it.
 */
export function mergeProjectSettingsRefresh(
  previous: ProjectSettingsDraft,
  incoming: ProjectSettingsDraft,
  draft: ProjectSettingsDraft,
): ProjectSettingsDraft {
  const keep = <K extends keyof ProjectSettingsDraft>(key: K): ProjectSettingsDraft[K] => (
    draft[key] !== previous[key] ? draft[key] : incoming[key]
  )
  return {
    name: keep('name'),
    description: keep('description'),
    workingDirectory: keep('workingDirectory'),
    details: keep('details'),
    historySearch: keep('historySearch'),
    color: keep('color'),
  }
}
