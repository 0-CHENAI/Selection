/** Current authoring version; historical documents retain their own version. */
export const DEFAULT_TASK_SCHEMA_VERSION = 3 as const;
/** UTF-8 byte limit shared by file selection, pasted YAML and the import RPC. */
export const MAX_TASK_IMPORT_BYTES = 1024 * 1024;
