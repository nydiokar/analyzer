 npm run build && pm2 start ecosystem.backend.config.js --env production


> Sova Intel@0.15.0 build
> tsc

src/api/shared/guards/advanced-throttler.guard.ts:7:41 - error TS2307: Cannot find module '@nestjs/throttler/dist/throttler-storage.service' or its corresponding type declarations.

7 import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler-storage.service';
                                          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

src/api/shared/guards/advanced-throttler.guard.ts:53:57 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'ThrottlerLimitDetail'.

53         this.advancedThrottler.recordViolation(context, limit);
                                                           ~~~~~

src/api/shared/guards/advanced-throttler.guard.ts:54:65 - error TS2339: Property 'limit' does not exist on type 'string'.     

54         this.securityLogger.logRateLimitExceeded(request, limit.limit, limit.ttl);
                                                                   ~~~~~

src/api/shared/guards/advanced-throttler.guard.ts:54:78 - error TS2339: Property 'ttl' does not exist on type 'string'.       

54         this.securityLogger.logRateLimitExceeded(request, limit.limit, limit.ttl);
                                                                                ~~~

src/api/shared/guards/advanced-throttler.guard.ts:76:19 - error TS2416: Property 'generateKey' in type 'AdvancedThrottlerGuard' is not assignable to the same property in base type 'ThrottlerGuard'.
  Type '(context: ExecutionContext, suffix: string) => Promise<string>' is not assignable to type '(context: ExecutionContext, suffix: string, name: string) => string'.
    Type 'Promise<string>' is not assignable to type 'string'.

76   protected async generateKey(
                     ~~~~~~~~~~~

src/api/shared/guards/advanced-throttler.guard.ts:84:33 - error TS2554: Expected 3 arguments, but got 2.

84     const baseKey = await super.generateKey(context, suffix);
                                   ~~~~~~~~~~~

  node_modules/@nestjs/throttler/dist/throttler.guard.d.ts:24:70
    24     protected generateKey(context: ExecutionContext, suffix: string, name: string): string;
                                                                            ~~~~~~~~~~~~
    An argument for 'name' was not provided.

src/api/shared/guards/advanced-throttler.guard.ts:91:13 - error TS2416: Property 'getErrorMessage' in type 'AdvancedThrottlerGuard' is not assignable to the same property in base type 'ThrottlerGuard'.
  Type '(context: ExecutionContext, throttlerLimitDetail: ThrottlerLimitDetail) => string' is not assignable to type '(context: ExecutionContext, throttlerLimitDetail: ThrottlerLimitDetail) => Promise<string>'.
    Type 'string' is not assignable to type 'Promise<string>'.

91   protected getErrorMessage(context: ExecutionContext, throttlerLimitDetail: ThrottlerLimitDetail): string {
               ~~~~~~~~~~~~~~~


Found 7 errors in the same file, starting at: src/api/shared/guards/advanced-throttler.guard.ts:7