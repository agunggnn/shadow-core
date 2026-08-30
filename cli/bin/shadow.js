#!/usr/bin/env node
'use strict';

import('../core/cli.mjs')
  .then(({ main }) => main())
  .catch((error) => {
    process.stderr.write(`Shadow Core failed: ${error.message}\n`);
    process.exitCode = 1;
  });
