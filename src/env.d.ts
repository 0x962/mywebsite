/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { RuntimeEnv } from './lib/auth';

declare namespace App {
  interface Locals {
    runtime: {
      env: RuntimeEnv;
      cf?: IncomingRequestCfProperties;
      ctx: ExecutionContext;
    };
  }
}
