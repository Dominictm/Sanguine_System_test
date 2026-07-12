'use strict';
// Re-exports every parser domain as one flat object, preserving the
// exact shape web/server.js and 8 route files already destructure via
// require('../lib/parsers') -- this file replaces the old monolithic
// parsers.js (1249 lines) as of the 2026-07-12 decomposition
// (docs/audit/2026-07-12-project-status-report.md).

module.exports = {
  ...require('./shared'),
  ...require('./city'),
  ...require('./character'),
  ...require('./location'),
  ...require('./scenario'),
  ...require('./threads'),
  ...require('./chronicle'),
  ...require('./timeline'),
  ...require('./worldState'),
};
