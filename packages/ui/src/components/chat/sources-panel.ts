/** The sources column can be hidden without clearing the open set or its width. */
export function isSourcesPanelShown(hasSources: boolean, suspended: boolean): boolean {
  return hasSources && !suspended
}
