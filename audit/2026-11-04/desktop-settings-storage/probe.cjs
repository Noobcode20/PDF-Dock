const { EventEmitter } = require('node:events')
const { createUpdateController } = require('../../../electron/updateController.cjs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
;(async()=>{
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'pdfdock-audit-'))
 const app={getVersion:()=> '1.0.0',getPath:()=>d,isPackaged:true}
 const updater=new EventEmitter(); updater.checkForUpdates=async()=>{}; updater.downloadUpdate=async()=>{}; updater.quitAndInstall=()=>{}
 const states=[]; const c=createUpdateController({updater,app,send:s=>states.push(s),platform:'win32'})
 await c.skip('2.0.0-beta.1')
 console.log('skip persisted:',await fs.readFile(path.join(d,'update-preferences.json'),'utf8'))
 console.log('skip status:',c.getState().status)
 await fs.rm(d,{recursive:true,force:true})
})().catch(e=>{console.error(e);process.exitCode=1})
