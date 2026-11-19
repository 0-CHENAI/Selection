// Public identifiers of the GitHub App published by SeLection.
export const SELECTION_GITHUB_APP_SLUG = 'selection-agent'
export const SELECTION_GITHUB_CLIENT_ID = 'Iv23lis5c0ZG0dIHW3ma'
export const SELECTION_GITHUB_INSTALL_URL = 'https://github.com/apps/' + SELECTION_GITHUB_APP_SLUG + '/installations/new'

export type GitHubConnectionAction = 'status' | 'connect' | 'disconnect' | 'poll'
export type GitHubConnectionStatus =
  | { state: 'disconnected' }
  | { state: 'pending'; userCode: string }
  | { state: 'connected' | 'install'; login: string; serviceAvailable: boolean }
