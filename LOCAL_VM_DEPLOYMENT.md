# CCPL FormFlow v0.5.0

See [UPGRADE_0_5_0.md](UPGRADE_0_5_0.md) for the current installation, first Super Admin setup, user roles, document approval process, validation results and rollback instructions.

Do not extract an update directly over the running installation before creating its recovery point. The guide includes the installer command that saves the old source, configuration, data and images first.

For a fresh, empty installation only, run `bash deploy/local/setup-local.sh "Your name"`. Existing installations must use the release installer.

Local development checks:

```bash
npm ci
npm run build
node_modules/.bin/tsc --noEmit
npm run test:access
npm run test:recovery
node_modules/.bin/workerd test -I node_modules tests/crypto-runtime.capnp
```

The Ubuntu container rollback still needs verification on the target VM. The workspace does not have Docker. No live application or user database was changed while preparing this package.
