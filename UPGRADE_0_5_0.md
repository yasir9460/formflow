# CCPL FormFlow v0.5.0 — accounts, document approvals and recovery

This is an Ubuntu/Docker test update from v0.4.2. It does not deploy or change a hosted Site.
The form layout, controlled-document layout and Word importer are retained. Access to their data is now checked against individual accounts.

## Before installing

- Keep the v0.4.2 ZIP. Take a VM snapshot as an additional recovery layer if your hypervisor supports it.
- Schedule downtime. The installer stops access while saving source, configuration, data and both current container images.
- Keep several GB free for the saved images, the new build and a rescued database. Copy restore points off the VM if you need protection against disk/VM failure.
- Do not first extract this ZIP over the running installation. Extract only the installer to a temporary directory using the commands below. This preserves the exact old source before the update.
- The current HTTP address is appropriate only for an isolated test LAN. Configure trusted HTTPS before using real passwords on a shared/untrusted network; never expose this test VM directly to the internet.

## Install from v0.4.2

Download `CCPL_FormFlow_Ubuntu_Test_Update_v0.5.0.zip` into Ubuntu Downloads. Run:

```bash
UPDATE_ZIP="$HOME/Downloads/CCPL_FormFlow_Ubuntu_Test_Update_v0.5.0.zip"
UPDATE_TOOLS="$(mktemp -d)"
unzip -j "$UPDATE_ZIP" deploy/local/release-manager.py -d "$UPDATE_TOOLS"
python3 "$UPDATE_TOOLS/release-manager.py" apply "$UPDATE_ZIP" --root "$HOME/Documents/ccpl-formflow"
```

The installer validates the ZIP, saves a private restore point, builds without cache, applies tracked schema migrations while the app is stopped, checks the application and proxy configuration, and then reopens access. If the build, migration or health check fails, it attempts to restore the old images, source/configuration and pre-update data automatically. Keep the printed restore-point path.

Verify the version:

```bash
cd ~/Documents/ccpl-formflow
cat RELEASE_VERSION
docker exec ccpl-formflow-app node -p "require('/app/package.json').version"
docker compose -f docker-compose.local.yml ps
```

Expected: `0.5.0-access-approvals-and-recovery` and `0.5.0`.

## Initialize your one Super Admin

On the first v0.5 installation only:

```bash
cd ~/Documents/ccpl-formflow
bash deploy/local/admin-account.sh init "Yasir Khan"
```

The command stops the application briefly, creates `superadmin` with a random temporary password, and prints that password once. There is no built-in default password. Open the usual application address, refresh, and sign in; you must replace the temporary password before doing anything else. The old shared Basic Auth login is replaced by the individual sign-in screen. Its old login file remains in the pre-update restore point.

Go to **Tasks, users & audit history → User accounts**. Create separate Author, Reviewer and Approver/Director accounts. Share each temporary password privately with its intended account holder, who must change it at first sign-in. The Super Admin can create Admins; Admins can manage ordinary users but cannot appoint Admins or change the Super Admin. Auditor is strictly read-only and cannot be combined with another role. Other ordinary roles may be combined.

Existing form records remain accessible to administrators/auditors. New authors see their own form records; the form template library remains shared. Existing controlled documents are listed for administrators under **Existing documents awaiting assignment**. Assign each to its author before using the new review process. Assignment preserves a snapshot of the original metadata/content; historical manually typed approval labels are not treated as verified decisions by the new system.

## Daily document process

1. Author creates/imports and saves a draft. Further draft edits update that draft with retained before/after snapshots.
2. In Tasks, select the document, assign a separate reviewer and approver, write a note, and submit for review.
3. Reviewer reads the PDF/Word and snapshots, adds comments, and either requests changes or recommends approval.
4. Author forwards a recommended document to the Director with a submission note. The Director receives an in-app notification.
5. Director requests changes or approves with a decision note. Approval stores the actual PDF/Word bytes and SHA-256 hashes in the same database transaction as the decision.
6. Approved versions are locked. The author creates a new draft version for later changes. Approving the new version marks the earlier approved version Superseded; administrators can archive approved/superseded versions with a reason.

Authors, reviewers and approvers must be different people for the same document. Earlier contributors to a draft cannot review or approve it after reassignment. Admins may return a pending document for changes to recover a blocked assignment, but cannot silently approve in place of its assigned Director. Only the assigned author edits the body.

The bell refreshes unread counts every 30 seconds while the page is visible. Opening Tasks shows the personal inbox and all permitted documents; use Refresh to retrieve decisions made while that page was open. Email notifications are not included. Sign-in sessions expire after 30 minutes without user activity or after 8 hours absolutely. Background bell polling does not extend the inactivity timeout.

Audit history includes account changes, password resets, sign-in successes/failures/rate limits, imports, saves, submissions, comments, decisions and downloads. Audit readers can load older pages and export CSV/PDF batches of 500 events. The snapshot viewer displays the latest 20 saved snapshots; all snapshots remain in the database. Snapshot comparison is a side-by-side content view, not a Word-style redline.

## Roll back the application, keeping current records

```bash
cd ~/Documents/ccpl-formflow
bash deploy/local/rollback-local.sh --acknowledge-legacy-access
```

This selects the latest saved restore point, first saves a rescue copy of the current state, then restores the saved source/configuration and container images. No internet download/rebuild is needed for these saved images. **Current data stays in place by default.** You can supply a specific absolute restore-point directory before the flags.

**Important:** v0.4.2 does not enforce the new individual permissions or approval workflow. The acknowledgement flag explicitly accepts that downgrade. Keep the rolled-back VM isolated; it resumes the old shared login saved with that release. Users, approvals, snapshots and audit tables remain in the database but v0.4.2 does not use them. New operations performed in the old app will not receive the v0.5 audit/approval guarantees.

## Restore both the old application and its matching database

Only when you also need the pre-update data:

```bash
cd ~/Documents/ccpl-formflow
bash deploy/local/rollback-local.sh --restore-data --acknowledge-legacy-access
```

This rolls active records back to the saved date. Newer records are not merged automatically; the displaced data directory and source are retained in the printed `backups/recovery-rescue-*` folder. Do not delete rescue folders until recovery is confirmed. A manual data restore cannot preserve later changes in the active database at the same time as reverting it.

If the application screen is broken, these commands still work from the Ubuntu terminal. If the deployment scripts were damaged too, extract `deploy/local/release-manager.py` from this ZIP into a temporary directory and run it with `rollback --root "$HOME/Documents/ccpl-formflow"` plus the appropriate flags. Never use `docker compose down -v` or delete the data directory.

## Offline Super Admin recovery

```bash
cd ~/Documents/ccpl-formflow
bash deploy/local/admin-account.sh recover
```

This generates a new temporary password for the same Super Admin, revokes their sessions, and appends a recovery audit event. It does not create a second Super Admin or delete users/documents. Run it only from the trusted VM console.

## Validation and boundaries

- Production build and TypeScript checks pass.
- Real SQLite tests exercise migrations, role restrictions, direct file access, stale draft protection, independent review/approval, immutable files and audit records, CSRF rejection, session revocation and notification ownership.
- Authenticated 2.6 MB DOCX import, chunk storage and byte-for-byte original download pass.
- The bundled Workers runtime accepts the password KDF at 600,000 PBKDF2-SHA256 iterations (checked with its native test command).
- Five recovery tests cover invalid archives, backup checksums, code-only rollback, full data rescue, legacy-access acknowledgement, and a simulated failed update. Docker commands are mocked in these tests: a real Docker upgrade/rollback could not be run in the development workspace. Test this release on your Ubuntu VM snapshot before production use.
- App/SQL controls prevent editing and deleting audit records. A person with host/root/database-file access can bypass those controls; these are not externally signed or independently notarized logs. File hashes detect a difference from the retained hash, not tampering by someone who can replace both data and hashes.
- Database/source/image backups are local recovery points, not protection against losing the entire VM. Recovery can also fail if the host runs out of disk space or Docker itself is broken; keep a VM-level backup.
- Editable block content is limited to 700 KB per document to stay below the local database's single-value limits; the original DOCX upload limit remains 8 MB. Reduce embedded image sizes if necessary.

Password and runtime references: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html and https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/ .
