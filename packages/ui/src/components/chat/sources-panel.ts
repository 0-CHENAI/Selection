/** Visible seam between the conversation card and the sources column. Same width as PANEL_GAP. */
export const SOURCE_PANEL_GAP_PX = 6

/** Column width for the sources panel plus its seam. The resize handle is not in flow. */
export function sourceColumnWidth(panelWidth: number): number {
  return panelWidth + SOURCE_PANEL_GAP_PX
}

/** The sources column can be hidden without clearing the open set or its width. */
export function isSourcesPanelShown(hasSources: boolean, suspended: boolean): boolean {
  return hasSources && !suspended
}
