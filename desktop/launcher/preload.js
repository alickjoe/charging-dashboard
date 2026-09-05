'use strict';

// Preload for the npm desktop deployment.
// __ELECTRON__      — same flag the exe deployment exposes (client.ts checks it)
// __AIDB_API_BASE__ — dynamic backend origin, only present in this deployment
//                     (the exe build keeps its hardcoded localhost:8000 base).

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__ELECTRON__', true);
if (process.env.AIDB_API_BASE) {
  contextBridge.exposeInMainWorld('__AIDB_API_BASE__', process.env.AIDB_API_BASE);
}
