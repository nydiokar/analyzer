import 'reflect-metadata';
import 'tsconfig-paths/register';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DatabaseService, prisma } from '../src/core/services/database-service'; // Adjusted path
import { getErrorMessage, getErrorDetails } from '../src/core/utils/error-utils';
import logger from '../src/core/utils/logger';

// Mirrors ApiKeyService logic without requiring NestJS DI / EventEmitter2
async function generateProperApiKey(userId: string, description: string): Promise<{ apiKey: string; prefix: string }> {
  const keyId = crypto.randomBytes(6).toString('hex');
  const prefix = `ak_${keyId}`;
  const secret = crypto.randomBytes(32).toString('base64url');
  const apiKey = `${prefix}_${secret}`;
  const keyHash = await bcrypt.hash(apiKey, 10);

  await prisma.apiKey.create({
    data: {
      prefix,
      keyHash,
      userId,
      description,
      scopes: JSON.stringify(['read', 'analysis']),
      isActive: true,
    },
  });

  return { apiKey, prefix };
}

async function confirmOrExit(prompt: string, force?: boolean): Promise<void> {
  if (force) return;
  const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    readline.question(prompt, (answer: string) => {
      readline.close();
      if (answer.toLowerCase() !== 'yes') {
        console.log('Cancelled.');
        process.exit(0);
      }
      resolve();
    });
  });
}

async function setEmailVerifiedForUser(params: { userId: string; status: boolean; force?: boolean }): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, emailVerified: true, isActive: true, isDemo: true, isAdmin: true },
  });

  if (!user) {
    console.log(`⚠️ User with ID ${params.userId} not found.`);
    return;
  }

  await confirmOrExit(
    `🚨 Set emailVerified=${params.status} for user ${user.id} (${user.email || 'no-email'})? Type "yes" to confirm: `,
    params.force
  );

  if (params.status) {
    // Mark verified and invalidate any outstanding tokens (prevents later token reuse).
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
        select: { id: true, email: true, emailVerified: true },
      });
      const invalidated = await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true },
      });
      return { updated, invalidatedCount: invalidated.count };
    });

    console.log(`✅ Updated: ${result.updated.id} (${result.updated.email || 'no-email'}) emailVerified=${result.updated.emailVerified}`);
    console.log(`   Invalidated ${result.invalidatedCount} pending EmailVerificationToken rows.`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: false },
    select: { id: true, email: true, emailVerified: true },
  });
  console.log(`✅ Updated: ${updated.id} (${updated.email || 'no-email'}) emailVerified=${updated.emailVerified}`);
}

async function setEmailVerifiedForEmail(params: { email: string; status: boolean; force?: boolean }): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: params.email },
    select: { id: true },
  });
  if (!user) {
    console.log(`⚠️ No user found with email ${params.email}`);
    return;
  }
  await setEmailVerifiedForUser({ userId: user.id, status: params.status, force: params.force });
}



async function main() {
  const dbService = new DatabaseService();

  await yargs(hideBin(process.argv))
    .command(
      'create',
      'Create a new user and generate an API key',
      (yargs) => {
        return yargs.option('description', {
          alias: 'd',
          type: 'string',
          description: 'Optional description for the user',
        });
      },
      async (argv) => {
        console.log('Attempting to create a new user...');
        try {
          // Create user — apiKey field is a legacy column, we'll overwrite it immediately
          const tempPlaceholder = crypto.randomBytes(16).toString('hex');
          const user = await prisma.user.create({
            data: { description: argv.description, isActive: true, apiKey: tempPlaceholder, emailVerified: true },
          });

          // Generate a proper ak_test_/ak_live_ prefixed API key via ApiKeyService logic
          const { apiKey, prefix } = await generateProperApiKey(user.id, argv.description ?? 'PFT Bot');

          console.log('---------------------------------------------------');
          console.log('✅ User Created Successfully!');
          console.log('---------------------------------------------------');
          console.log(`User ID:         ${user.id}`);
          console.log(`API Key:         ${apiKey} <--- COPY THIS KEY NOW! It will not be shown again.`);
          console.log(`Prefix stored:   ${prefix}***`);
          console.log(`Description:     ${user.description || 'N/A'}`);
          console.log(`Scopes:          read, analysis`);
          console.log(`Is Active:       ${user.isActive}`);
          console.log('---------------------------------------------------');
          console.log('IMPORTANT: Store the API Key securely. This is the only time it will be displayed.');
          console.log('---------------------------------------------------');
        } catch (error) {
          logger.error('❌ Error during user creation:', getErrorMessage(error));
        }
      }
    )
    .command(
      'list',
      'List all users',
      {}, // No options for list
      async () => {
        console.log('\nFetching all users...');
        try {
          const users = await dbService.getAllUsers();
          if (users && users.length > 0) {
            console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
            console.log('🔑 All Users:');
            console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
            console.log('ID                                    | Display Name       | Email                              | Active | Admin  | Analyst | Demo   | Email Ver. | Last Login  | Last Seen   | Description            | Created');
            console.log('──────────────────────────────────────|────────────────────|────────────────────────────────────|────────|────────|─────────|────────|────────────|─────────────|─────────────|────────────────────────|─────────────');
            users.forEach(user => {
              const id = user.id.padEnd(36);
              const displayName = ((user as any).displayName || 'N/A').padEnd(18);
              const email = (user.email || 'N/A').padEnd(35);
              const active = user.isActive ? '✅ Yes' : '❌ No ';
              const isAdmin = (user as any).isAdmin ? '👑 Yes' : 'No    ';
              const isAnalyst = (user as any).isAnalyst ? '🔬 Yes  ' : 'No      ';
              const isDemo = user.isDemo ? '✅ Yes' : 'No    ';
              const emailVerified = (user as any).emailVerified ? '✅ Yes    ' : '❌ No     ';
              const lastLogin = (user as any).lastLoginAt ? new Date((user as any).lastLoginAt).toISOString().substring(0, 10) : 'Never      ';
              const lastSeen = (user as any).lastSeenAt ? new Date((user as any).lastSeenAt).toISOString().substring(0, 10) : 'Never      ';
              const description = (user.description || 'N/A').padEnd(22);
              const createdAt = new Date(user.createdAt).toISOString().substring(0, 10);
              console.log(`${id} | ${displayName} | ${email} | ${active} | ${isAdmin} | ${isAnalyst} | ${isDemo} | ${emailVerified} | ${lastLogin} | ${lastSeen} | ${description} | ${createdAt}`);
            });
            console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
          } else {
            console.log('ℹ️ No users found in the database.');
          }
        } catch (error) {
          logger.error('❌ Error fetching users:', getErrorMessage(error));
        }
      }
    )
    .command(
      'show <id>',
      'Show detailed user info including activity stats',
      (yargs) => {
        return yargs.positional('id', {
          describe: 'The ID of the user to show',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        try {
          const user = await prisma.user.findUnique({
            where: { id: argv.id as string },
            include: {
              apiKeys: {
                select: { id: true, prefix: true, lastUsedAt: true, createdAt: true, description: true, isActive: true }
              },
              favoriteWallets: {
                select: { walletAddress: true, createdAt: true, nickname: true },
                orderBy: { createdAt: 'desc' },
                take: 10
              },
              walletNotes: {
                select: { walletAddress: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
                take: 5
              },
              activityLogs: {
                orderBy: { timestamp: 'desc' },
                take: 10,
                select: { actionType: true, timestamp: true, status: true, walletAddress: true }
              },
              _count: {
                select: { activityLogs: true, favoriteWallets: true, walletNotes: true, apiKeys: true }
              }
            }
          });

          if (!user) {
            console.log(`⚠️ User with ID ${argv.id} not found.`);
            return;
          }

          // Calculate days since last activity
          const lastActivity = user.lastSeenAt || user.lastLoginAt || user.createdAt;
          const daysSinceActive = Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));

          console.log('\n════════════════════════════════════════════════════════════════');
          console.log('                         USER DETAILS');
          console.log('════════════════════════════════════════════════════════════════');
          console.log(`  ID:              ${user.id}`);
          console.log(`  Email:           ${user.email || 'N/A'}`);
          console.log(`  Display Name:    ${user.displayName || 'N/A'}`);
          console.log(`  Description:     ${user.description || 'N/A'}`);
          console.log('────────────────────────────────────────────────────────────────');
          console.log('  STATUS');
          console.log(`  Active:          ${user.isActive ? '✅ Yes' : '❌ No'}`);
          console.log(`  Email Verified:  ${user.emailVerified ? '✅ Yes' : '❌ No'}`);
          console.log(`  Is Admin:        ${(user as any).isAdmin ? '👑 YES - Has admin privileges' : 'No'}`);
          console.log(`  Is Demo:         ${user.isDemo ? '✅ Yes' : 'No'}`);
          console.log('────────────────────────────────────────────────────────────────');
          console.log('  TIMESTAMPS');
          console.log(`  Created:         ${user.createdAt.toISOString().replace('T', ' ').substring(0, 19)}`);
          console.log(`  Last Login:      ${user.lastLoginAt ? user.lastLoginAt.toISOString().replace('T', ' ').substring(0, 19) : 'Never'}`);
          console.log(`  Last Seen:       ${user.lastSeenAt ? user.lastSeenAt.toISOString().replace('T', ' ').substring(0, 19) : 'Never'}`);
          console.log(`  Days Inactive:   ${daysSinceActive} days`);
          console.log('────────────────────────────────────────────────────────────────');
          console.log('  USAGE STATS');
          console.log(`  Activity Logs:   ${user._count.activityLogs}`);
          console.log(`  Favorite Wallets:${user._count.favoriteWallets}`);
          console.log(`  Wallet Notes:    ${user._count.walletNotes}`);
          console.log(`  API Keys:        ${user._count.apiKeys}`);

          if (user.apiKeys.length > 0) {
            console.log('────────────────────────────────────────────────────────────────');
            console.log('  API KEYS');
            user.apiKeys.forEach(k => {
              const status = k.isActive ? '✅' : '❌';
              const lastUsed = k.lastUsedAt ? k.lastUsedAt.toISOString().substring(0, 10) : 'Never';
              console.log(`  ${status} ${k.prefix}... | Last used: ${lastUsed} | ${k.description || 'No description'}`);
            });
          }

          // Fetch aggregated activity stats
          const activityStats = await prisma.activityLog.groupBy({
            by: ['actionType', 'status'],
            where: { userId: user.id },
            _count: { actionType: true }
          });

          const uniqueWallets = await prisma.activityLog.findMany({
            where: { userId: user.id, walletAddress: { not: null } },
            select: { walletAddress: true },
            distinct: ['walletAddress']
          });

          const firstActivity = await prisma.activityLog.findFirst({
            where: { userId: user.id },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true }
          });

          const lastActivityLog = await prisma.activityLog.findFirst({
            where: { userId: user.id },
            orderBy: { timestamp: 'desc' },
            select: { timestamp: true }
          });

          if (user._count.activityLogs > 0) {
            console.log('────────────────────────────────────────────────────────────────');
            console.log('  ACTIVITY SUMMARY');
            console.log(`  Total Actions:       ${user._count.activityLogs}`);
            console.log(`  Unique Wallets:      ${uniqueWallets.length}`);
            if (firstActivity) {
              console.log(`  First Activity:      ${firstActivity.timestamp.toISOString().replace('T', ' ').substring(0, 19)}`);
            }
            if (lastActivityLog) {
              console.log(`  Last Activity:       ${lastActivityLog.timestamp.toISOString().replace('T', ' ').substring(0, 19)}`);
            }

            // Group by action type (only successful)
            const actionCounts: Record<string, number> = {};
            activityStats.forEach(stat => {
              if (stat.status === 'SUCCESS') {
                actionCounts[stat.actionType] = (actionCounts[stat.actionType] || 0) + stat._count.actionType;
              }
            });

            if (Object.keys(actionCounts).length > 0) {
              console.log('────────────────────────────────────────────────────────────────');
              console.log('  ACTIONS BREAKDOWN (successful)');
              // Sort by count descending
              const sorted = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]);
              sorted.forEach(([action, count]) => {
                const label = action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                console.log(`  ${String(count).padStart(5)}x  ${label}`);
              });
            }
          } else {
            console.log('────────────────────────────────────────────────────────────────');
            console.log('  ACTIVITY: None - user has never used the app');
          }

          if (user.favoriteWallets.length > 0) {
            console.log('────────────────────────────────────────────────────────────────');
            console.log('  FAVORITE WALLETS (last 10)');
            user.favoriteWallets.forEach(f => {
              const name = f.nickname ? ` (${f.nickname})` : '';
              console.log(`  ${f.walletAddress}${name}`);
            });
          }

          console.log('════════════════════════════════════════════════════════════════\n');
        } catch (error) {
          console.error('❌ Error fetching user details:', error);
        }
      }
    )
    .command(
      'activate <id>',
      'Activate a user by their ID',
      (yargs) => {
        return yargs.positional('id', {
          describe: 'The ID of the user to activate',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        console.log(`\nAttempting to activate user with ID: ${argv.id}...`);
        try {
          const user = await dbService.activateUser(argv.id as string);
          if (user) {
            console.log(`✅ User ${user.id} (${user.description || 'N/A'}) activated successfully.`);
          } else {
            console.warn(`⚠️ User with ID ${argv.id} not found or already active.`);
          }
        } catch (error) {
          logger.error('❌ Error activating user:', getErrorMessage(error));
        }
      }
    )
    .command(
      'deactivate <id>',
      'Deactivate a user by their ID',
      (yargs) => {
        return yargs.positional('id', {
          describe: 'The ID of the user to deactivate',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        console.log(`\nAttempting to deactivate user with ID: ${argv.id}...`);
        try {
          const user = await dbService.deactivateUser(argv.id as string);
          if (user) {
            console.log(`✅ User ${user.id} (${user.description || 'N/A'}) deactivated successfully.`);
          } else {
            console.warn(`⚠️ User with ID ${argv.id} not found or already inactive.`);
          }
        } catch (error) {
          logger.error('❌ Error deactivating user:', getErrorMessage(error));
        }
      }
    )
    .command(
      'delete <id>',
      'Delete a user by their ID (use with caution!)',
      (yargs) => {
        return yargs.positional('id', {
          describe: 'The ID of the user to delete',
          type: 'string',
          demandOption: true,
        }).option('force', {
          alias: 'f',
          type: 'boolean',
          description: 'Force deletion without confirmation (NOT RECOMMENDED)',
          default: false,
        });
      },
      async (argv) => {
        // Basic confirmation if not forced
        if (!argv.force) {
            // Simple prompt, for more robust CLI interaction, consider `inquirer`
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            await new Promise(resolve => {
                readline.question(`🚨 Are you sure you want to PERMANENTLY DELETE user with ID ${argv.id}? This action cannot be undone. (yes/NO): `, (answer: string) => {
                    readline.close();
                    if (answer.toLowerCase() !== 'yes') {
                        console.log('Deletion cancelled by user.');
                        process.exit(0); // Exit gracefully
                    }
                    resolve(null);
                });
            });
        }
        console.log(`\nAttempting to delete user with ID: ${argv.id}...`);
        try {
          const user = await dbService.deleteUser(argv.id as string);
          if (user) {
            console.log(`🗑️ User ${user.id} (${user.description || 'N/A'}) deleted successfully.`);
          } else {
            console.warn(`⚠️ User with ID ${argv.id} not found.`);
          }
        } catch (error) {
          logger.error('❌ Error deleting user:', getErrorMessage(error));
        }
      }
    )
    .command(
      'set-demo <id> <status>',
      'Set the demo status for a user (e.g., set-demo <user-id> true)',
      (yargs) => {
        return yargs
          .positional('id', {
            describe: 'The ID of the user to modify',
            type: 'string',
            demandOption: true,
          })
          .positional('status', {
            describe: 'The demo status to set (true or false)',
            type: 'boolean',
            demandOption: true,
          });
      },
      async (argv) => {
        console.log(`\nAttempting to set demo status for user ${argv.id} to ${argv.status}...`);
        try {
          const user = await dbService.setUserDemoStatus(argv.id as string, argv.status as boolean);
          if (user) {
            console.log(`✅ User ${user.id} (${user.description}) demo status successfully set to: ${user.isDemo}`);
          } else {
            console.warn(`⚠️ User with ID ${argv.id} not found.`);
          }
        } catch (error) {
          logger.error('❌ Error setting demo status:', getErrorMessage(error));
        }
      }
    )
    .command(
      'set-admin <id> <status>',
      '🔐 Set admin privileges for a user (e.g., set-admin <user-id> true)',
      (yargs) => {
        return yargs
          .positional('id', {
            describe: 'The ID of the user to modify',
            type: 'string',
            demandOption: true,
          })
          .positional('status', {
            describe: 'Admin status to set (true or false)',
            type: 'boolean',
            demandOption: true,
          });
      },
      async (argv) => {
        console.log(`\n🔐 Attempting to set admin status for user ${argv.id} to ${argv.status}...`);
        try {
          const user: any = await prisma.user.update({
            where: { id: argv.id as string },
            data: { isAdmin: argv.status as boolean } as any,
          });

          if (user) {
            const emoji = user.isAdmin ? '👑' : '👤';
            console.log(`${emoji} User ${user.id} (${user.email || user.description || 'N/A'}) admin status set to: ${user.isAdmin}`);
            if (user.isAdmin) {
              console.log('   ⚠️  This user now has FULL admin access to:');
              console.log('       - Create/revoke registration codes');
              console.log('       - Enable/disable registration kill-switch');
              console.log('       - Disable/enable user accounts');
              console.log('       - Manage API keys');
            }
          }
        } catch (error) {
          logger.error('❌ Error setting admin status:', getErrorMessage(error));
        }
      }
    )
    .command(
      'set-analyst <id> <status>',
      'Set analyst privileges for a user (e.g., set-analyst <user-id> true)',
      (yargs) => {
        return yargs
          .positional('id', {
            describe: 'The ID of the user to modify',
            type: 'string',
            demandOption: true,
          })
          .positional('status', {
            describe: 'Analyst status to set (true or false)',
            type: 'boolean',
            demandOption: true,
          });
      },
      async (argv) => {
        console.log(`\nAttempting to set analyst status for user ${argv.id} to ${argv.status}...`);
        try {
          const user: any = await prisma.user.update({
            where: { id: argv.id as string },
            data: { isAnalyst: argv.status as boolean } as any,
          });

          if (user) {
            const emoji = user.isAnalyst ? '🔬' : '👤';
            console.log(`${emoji} User ${user.id} (${user.email || user.description || 'N/A'}) analyst status set to: ${user.isAnalyst}`);
          }
        } catch (error) {
          logger.error('❌ Error setting analyst status:', getErrorMessage(error));
        }
      }
    )
    .command(
      'set-email-verified <id> <status>',
      'Set a user email verification status (temporary workaround when email sending is down)',
      (yargs) => {
        return yargs
          .positional('id', {
            describe: 'User ID',
            type: 'string',
            demandOption: true,
          })
          .positional('status', {
            describe: 'Email verified status to set (true or false)',
            type: 'boolean',
            demandOption: true,
          })
          .option('force', {
            alias: 'f',
            type: 'boolean',
            description: 'Skip confirmation prompt',
            default: false,
          });
      },
      async (argv) => {
        try {
          await setEmailVerifiedForUser({ userId: argv.id as string, status: argv.status as boolean, force: argv.force as boolean });
        } catch (error) {
          logger.error('❌ Error setting emailVerified:', getErrorMessage(error));
        }
      }
    )
    .command(
      'set-email-verified-by-email <email> <status>',
      'Set a user email verification status by email address',
      (yargs) => {
        return yargs
          .positional('email', {
            describe: 'User email address',
            type: 'string',
            demandOption: true,
          })
          .positional('status', {
            describe: 'Email verified status to set (true or false)',
            type: 'boolean',
            demandOption: true,
          })
          .option('force', {
            alias: 'f',
            type: 'boolean',
            description: 'Skip confirmation prompt',
            default: false,
          });
      },
      async (argv) => {
        try {
          await setEmailVerifiedForEmail({ email: argv.email as string, status: argv.status as boolean, force: argv.force as boolean });
        } catch (error) {
          logger.error('❌ Error setting emailVerified by email:', getErrorMessage(error));
        }
      }
    )
    .demandCommand(1, 'You need to specify a command (e.g., create, list, activate, deactivate, delete).')
    .strict() // Catches unrecognized options
    .help()
    .alias('h', 'help')
    .version(false) // Disable default version flag
    .wrap(null) // Disable yargs default wrapping
    .epilogue('For more information, find our manual at https://docs.example.com (placeholder)') // Placeholder
    .parseAsync(); // Use parseAsync for async handlers
}

main()
  .catch(async (error) => {
    console.error('\n❌ Unhandled error in script execution:');
    logger.error('Error occurred:', getErrorMessage(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('\nDatabase connection closed.');
  }); 
