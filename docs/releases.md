# Releases

The `Release` GitHub Actions workflow creates a GitHub Release and matching Git tag whenever `main` is updated. Merging a pull request into `main` starts the workflow. The first release is `v0.1.0`.

For later releases, the workflow examines Conventional Commit subjects since the last `vMAJOR.MINOR.PATCH` tag:

- `feat:` increments the minor version.
- `fix:`, `chore:`, `docs:`, and other non-breaking commit types increment the patch version.
- A `!` before the colon or a `BREAKING CHANGE:` marker increments the major version.

The GitHub-generated release notes summarize the changes since the previous tag. The workflow has `contents: write` permission so its repository token can create the tag and release. Closely spaced merges may be grouped into one release from the latest `main` commit.
