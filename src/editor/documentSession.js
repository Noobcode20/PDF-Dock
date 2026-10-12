import { newRevision } from "./history.js";
export function createDocumentSession(files = []) {
  const revision = newRevision();
  return {
    id: newRevision(),
    originalFile: files[0] || null,
    sourcePath: files[0]?.sourcePath || null,
    revision,
    savedRevision: revision,
    version: 0,
    operations: [],
  };
}
export function isSessionDirty(session) {
  return session.revision !== session.savedRevision;
}
export function markSessionSaved(session, path) {
  return {
    ...session,
    sourcePath: path || session.sourcePath,
    savedRevision: session.revision,
  };
}
export function revisedSession(session, operation) {
  return {
    ...session,
    revision: newRevision(),
    version: session.version + 1,
    operations: [...session.operations.slice(-199), operation],
  };
}
