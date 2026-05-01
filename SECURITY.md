# Security Policy

## 🛡️ Supported Versions

The following versions of Polyglot Formatter are currently supported with security updates:

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅ Yes     |
| < 1.0   | ❌ No      |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public issue**.

Instead, report it responsibly:

* 📧 Email: **[dev@neiki.eu](mailto:dev@neiki.eu)**
* 💬 Or open a **private GitHub security advisory**

---

## 📋 What to include

Please provide as much detail as possible:

* Description of the vulnerability
* Steps to reproduce
* Browser and version used
* Potential impact

---

## ⏱️ Response Time

* Initial response: **within 48 hours**
* Fix timeline: depends on severity

---

## ⚠️ Scope

Polyglot Formatter is a **client-side web application** that runs entirely in the browser. It does not have a backend server or database.

The following areas are considered **in-scope**:

* **XSS / code injection** — malicious code executed via the formatter input or output panels
* **CDN integrity** — issues with third-party libraries loaded from CDN (CodeMirror, Prism.js, js-beautify)
* **Clipboard abuse** — unexpected content written to the clipboard via the Copy function
* **Deep mode safety** — cases where Deep mode incorrectly alters runtime string values in a way that could cause security issues

The following are **out of scope**:

* Issues in upstream CDN libraries (report those to the respective projects)
* Self-hosted deployment configuration (web server, HTTPS, etc.)

---

## 🙏 Responsible Disclosure

We appreciate responsible disclosure and will credit reporters where appropriate.
