file:///F:/todo/1%20web/restaurant-leads/run.js:6
import appendBusinesses from "./sheets.js";
^^^^^^^^^^^^^^^^
SyntaxError: The requested module './sheets.js' does not provide an export named 'default'
at ModuleJob.\_instantiate (node:internal/modules/esm/module_job:228:21)
at async ModuleJob.run (node:internal/modules/esm/module_job:337:5)
at async onImport.tracePromise.**proto** (node:internal/modules/esm/loader:651:26)
at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.19.0
PS F:\todo\1 web\restaurant-leads> node run.js

> > file:///F:/todo/1%20web/restaurant-leads/sheets.js:17
> > module.exports = appendBusinesses;
> > ^

ReferenceError: module is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension and 'F:\todo\1 web\restaurant-leads\package.json' contains "type": "module". To treat it as a CommonJS script, rename it to use the '.cjs' file extension.
at file:///F:/todo/1%20web/restaurant-leads/sheets.js:17:1
at ModuleJob.run (node:internal/modules/esm/module_job:345:25)
at async onImport.tracePromise.**proto** (node:internal/modules/esm/loader:651:26)
at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.19.0
PS F:\todo\1 web\restaurant-leads> node run.js

> > [dotenv@17.2.3] injecting env (1) from .env -- tip: ⚙️ specify custom .env file path with { path: '/custom/path/.env' }
> > Authorize this app:
> > Paste code here:
> > PS F:\todo\1 web\restaurant-leads> node run.js
> >
> > [dotenv@17.2.3] injecting env (1) from .env -- tip: ⚙️ write to custom object with { processEnv: myObject }
> > Authorize this app:
> > Paste code here:
