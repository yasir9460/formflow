# Original Git history backup

This bundle retains the three original commits, author/committer metadata and source trees. The imported GitHub snapshots use new commit IDs; see [GITHUB_IMPORT.md](../GITHUB_IMPORT.md) for the mapping.

SHA-256: `681ee5a82c520178bb470abf6a556d8c5b44a3af4ece4fd8eca97c4e96f5cb85`

To inspect the original history from a clone of this repository:

```bash
git bundle verify history/FormFlow_Source_History.bundle
git clone --branch main history/FormFlow_Source_History.bundle ../formflow-original-history
```

Choose a new empty destination. Do not overwrite the running Ubuntu project. The bundle contains source history only and is not a database backup.
