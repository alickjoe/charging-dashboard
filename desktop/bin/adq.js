#!/usr/bin/env node
'use strict';

// npm bin entry: `adq` -> launcher CLI (start / --check / doctor / stop).
require('../launcher/cli.js').run(process.argv.slice(2));
