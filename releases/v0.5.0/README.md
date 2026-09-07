# CCPL FormFlow v0.5.0 Ubuntu test update

[Download the update ZIP](CCPL_FormFlow_Ubuntu_Test_Update_v0.5.0.zip) using GitHub's Download raw file control, or obtain it from your repository clone.

Original source commit: `7bf7cf60a6315d155ccd27844b89cdca2a7e7712`

Corresponding GitHub snapshot: `83e2b40a32a01fec0db60574ce8efe6b7b898e1d`

SHA-256: `e0b596b877c5534ffce70fe9302c7b6c2958f5c9ffbbd4c4490c654ca3f4af0a`

## Changes

- Individual user accounts with one protected Super Admin and assigned roles.
- Controlled Documents review, change requests and final approval with independent participants.
- In-app notifications, decision notes, snapshots and append-only audit records.
- Frozen approved PDF and Word files with stored hashes.
- Tracked database migrations and recoverable local release installation.

Reviewer recommendation notifies the author. The author then submits the document to the Director. Email notifications are not included.

## Install

Follow [UPGRADE_0_5_0.md](../../UPGRADE_0_5_0.md). Do not extract an update directly over a running installation before saving its recovery point. The installer creates the restore point before replacement. Keep the existing database and login files on the VM.

## Validation and limits

The preparation checks included the build, TypeScript checks, SQLite-backed access/workflow integration tests, DOCX import and frozen-output checks, and mocked-Docker recovery tests. These have not been rerun as GitHub Actions. Full Docker installation and rollback still need verification on the Ubuntu test VM. This repository import does not certify production readiness.

This folder stores the initial versioned package. A formal GitHub Release and tag have not been created through this connection.
