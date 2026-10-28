# Security reporting

mdview renders potentially untrusted Markdown and HTML. Its [security model](docs/security.md) describes the sandbox, explicit script trust, filesystem access and network restrictions.

For a suspected vulnerability, use the repository's **Security → Report a vulnerability** option if private reporting is enabled. Include the affected revision, platform, reproduction steps, a minimal non-sensitive document and the impact. If private reporting is unavailable, open an issue asking maintainers for a private reporting channel without publishing exploit details or private data.

The current development branch is the supported security target. There are no maintained older release branches yet. No response-time commitment is made.
