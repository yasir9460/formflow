# Contributing to CCPL FormFlow

## Start with a separate development checkout

Keep development separate from the running Ubuntu installation and its data.

```bash
git clone https://github.com/yasir9460/formflow.git
cd formflow
git switch -c improve-document-formatting
```

Use Node 24 and Python 3. Follow README.md for local checks and UPGRADE_0_5_0.md for application installation. Keep package-lock.json committed alongside any dependency change. Use synthetic data in development. Preserve the accepted Forms behavior when changing Controlled Documents.

## Submit a change

1. Explain the bug or requested behavior in a GitHub issue or pull request.
2. Make changes in your feature branch.
3. Run the relevant checks listed in README.md. Changes to authentication, document permissions or approval must pass the access/workflow tests. Changes to recovery must pass recovery tests and be exercised on a test VM.
4. Review `git diff` and stage only the intended source files.
5. Commit with a meaningful message, push the feature branch and open a pull request against main.
6. Ask the maintainer to review the behavior and test evidence before merging.

Example after reviewing and staging the intended files:

```bash
git commit -m "Improve document heading spacing"
git push -u origin improve-document-formatting
```

The pull request should explain the problem, resulting behavior, checks performed, migration effects and recovery implications. Do not rewrite shared history or force push main. Required review/test enforcement is not configured by this import; follow this process as a team and configure repository rules separately if your plan supports them.

## Data and credentials

Do not commit live databases, backups, uploaded documents, login files, passwords, tokens, environment secrets or generated client records. Existing ignore rules exclude common runtime paths. Ignore rules do not remove files already tracked by Git. Review the staged diff before each commit. The supplied history bundle and initial release ZIP contain checked source assets, not VM records.

## Database changes

Add tracked migrations rather than editing an already-applied migration. Preserve existing records. Document any incompatibility with older application versions. Test both fresh setup and upgrading a populated test database.

## Releases and rollback

Merging code does not update the Ubuntu VM. Prepare and test a named release, record its source commit and checksum, then install through the documented backup/update process. Keep a known working release and its restore point.

Application rollback and database restore are separate operations. Restoring an older database returns it to the backup date. Rolling back below v0.5.0 removes the newer individual access and document approval controls. Real Docker recovery needs testing on the target VM.

## Ownership and access

Repository collaborators edit software. FormFlow users create and approve documents. These permissions are separate. Grant repository access to the developers who need it; changing a FormFlow role does not change GitHub access.
