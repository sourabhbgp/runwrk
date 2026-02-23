#!/usr/bin/env bun

import { buildProgram } from "./cli";

const program = buildProgram();
program.parseAsync(process.argv).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
