# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2025-05-01

### Added

- **Auto-detection engine** for HTML, CSS, JavaScript, PHP and JSON
- **HTML formatter** with nested `<style>` and `<script>` block support
- **CSS formatter** with safe `content:"..."` string handling
- **JavaScript formatter** with optional deep string/template formatting
- **PHP formatter** preserving PHP blocks inside mixed HTML/PHP files
- **JSON formatter** with structure pretty-print and quoted-key preservation
- **Deep mode** for aggressive nested string payload formatting (opt-in)
- **Safe mode** (default) that never alters runtime string values
- **Preserve Newlines** option to prevent Deep mode from adding line breaks inside strings
- **Configurable indent size** (2 or 4 spaces)
- **Adjustable line wrap length** (40–300 characters)
- **CodeMirror 5.65.16** input editor with Material Darker theme, line numbers, bracket matching and auto-close brackets
- **Prism.js 1.29.0** syntax highlighting in the output panel (Tomorrow Night theme)
- **js-beautify 1.15.1** as the core HTML/CSS/JS formatting engine
- **Language badge** showing the detected language after formatting
- **Copy to clipboard** button with visual feedback
- **Clear** button to reset input and output
- **Post-format validation** with error/success banners
- **Deep mode warning banner** when enabled
- **Info tooltips** for option descriptions
- **Responsive layout** — panels stack vertically on screens ≤ 768 px
- **Dark theme** throughout (GitHub-style Material Darker palette)
- **Custom scrollbar styling** for WebKit and Firefox
- Project documentation: `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
