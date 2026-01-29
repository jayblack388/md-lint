# Markdown Lint

Lint Markdown files using markdownlint. Get real-time diagnostics and auto-fix capabilities.

## Features

- Real-time linting as you type
- Inline diagnostics (warning squiggles)
- Quick fixes via lightbulb/Cmd+.
- "Fix All" command to fix all issues at once
- Optional fix-on-save
- Respects `.markdownlint.json` configuration

## Installation

Search "Markdown Lint" in the Cursor/VS Code Extensions panel.

Or install from [Open VSX](https://open-vsx.org/extension/jayblack388/md-lint).

## Usage

1. Open a Markdown file
2. See lint warnings as yellow squiggles
3. Hover for details, or click the lightbulb for quick fixes
4. Use **Cmd+Shift+P** → "Fix All Markdown Lint Issues" to fix everything

## Configuration

### Extension Settings

- `md-lint.enable`: Enable/disable linting (default: `true`)
- `md-lint.fixOnSave`: Automatically fix issues on save (default: `false`)
- `md-lint.config`: Inline markdownlint configuration (overrides config files)

### Configuration File

Create `.markdownlint.json` in your workspace root:

```json
{
  "MD013": false,
  "MD033": false,
  "MD041": false
}
```

See [markdownlint rules](https://github.com/DavidAnson/markdownlint#rules--aliases) for all available rules.

## Common Rules

| Rule | Description |
|------|-------------|
| MD001 | Heading levels should only increment by one |
| MD009 | Trailing spaces |
| MD010 | Hard tabs |
| MD012 | Multiple consecutive blank lines |
| MD013 | Line length |
| MD022 | Headings should be surrounded by blank lines |
| MD031 | Fenced code blocks should be surrounded by blank lines |

## License

MIT
