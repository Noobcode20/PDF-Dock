/** A worker/save result belongs to one immutable input and semantic revision. */
export function captureRevision(session,file) {return {id:session.id,revision:session.revision,file};}
export function assertRevision(expected,session,file,signal) {
 if(signal?.aborted||session.id!==expected.id||session.revision!==expected.revision||file!==expected.file)
  throw new DOMException('Document changed during processing. Try again.','AbortError');
}
export function sessionAfterWrite(current,written,path) {
 if(current.id!==written.id)return current;
 return {...current,sourcePath:path||written.sourcePath,savedRevision:written.revision};
}
