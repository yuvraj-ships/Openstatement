# Security & privacy

OpenStatement handles financial documents, so privacy bugs are treated as security bugs.

**Design guarantees**

- The web app is a static site. There is no backend and no analytics.
- The production build sets a Content-Security-Policy with `connect-src 'self'`, so the page cannot send data to other servers.
- PDF passwords are only passed to pdf.js in your browser and are never stored.

**Reporting a vulnerability**

Please don't open a public issue. Use GitHub's [private vulnerability reporting](../../security/advisories/new) instead. You'll get a reply within a few days.

Examples of what to report: any way the app could send statement data off the device, script injection through crafted PDF text, or a crash that leaks data.
