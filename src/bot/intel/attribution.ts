import { PrismaClient } from '@prisma/client';

interface InvocationArgs {
  telegramUserId: string;
  username?: string;
  command: string;
  address: string;
  creditCost: number;
  success: boolean;
  errorCode?: string;
}

export function logInvocation(prisma: PrismaClient, args: InvocationArgs): void {
  prisma.telegramBotLog
    .create({
      data: {
        telegramUserId: args.telegramUserId,
        username: args.username,
        command: args.command,
        address: args.address,
        creditCost: args.creditCost,
        success: args.success,
        errorCode: args.errorCode,
      },
    })
    .catch((err: unknown) => {
      console.error('[ATTRIBUTION] Failed to write log:', err instanceof Error ? err.message : err);
    });
}
