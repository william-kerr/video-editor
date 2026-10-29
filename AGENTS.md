# Agent Guide

Read [README.md](README.md) for the project and [DEVELOPMENT.md](DEVELOPMENT.md) for architecture, setup, behavior and verification. Check the working tree before editing and preserve existing changes.

Before changing behavior, search relevant `docs/history/YYYY-MM.md` entries for earlier decisions and lessons, then inspect the current source. Code and verified behavior take precedence over older descriptions.

Keep the README concise and user-facing. Maintain current technical details in DEVELOPMENT.md. Record meaningful decisions, experiments, outcomes and reversals in the appropriate monthly history file, with relevant commit references when available. Do not create a separate root history index or duplicate current documentation in the history. Distinguish verified results from proposals and untested assumptions.

Run builds, dependency operations and checks inside the repository's development container. Follow DEVELOPMENT.md for the existing unit, build and browser checks; choose checks relevant to the change and report what actually ran. Do not alter the production Pages base path or publish a deployment unless the task authorizes it.

Preserve local-only media processing, the absence of uploads and analytics, and dependency license notices. Never include credentials, personal media, private conversations or unrelated infrastructure details in source, documentation, test fixtures or commits.

Respect the task's review and publication instructions. A request to prepare changes for review does not authorize a commit, push or deployment.
