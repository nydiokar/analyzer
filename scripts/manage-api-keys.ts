import 'reflect-metadata';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DatabaseService, prisma } from '../src/core/services/database-service';
import { ApiKeyService, ApiKeyScope } from '../src/api/shared/services/api-key.service';
import { ApiKeyDatabaseService } from '../src/api/shared/services/api-key-database.service';
import { JwtDatabaseService } from '../src/api/shared/services/jwt-database.service';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage, getErrorDetails } from '../src/core/utils/error-utils';
import logger from '../src/core/utils/logger';



const VALID_SCOPES: ApiKeyScope[] = ['read', 'report', 'analysis', 'admin', 'full'];

async function main() {
  // Initialize services
  const configService = new ConfigService();
  const databaseService = new DatabaseService();
  const apiKeyDatabaseService = new ApiKeyDatabaseService(databaseService);
  const jwtDatabaseService = new JwtDatabaseService(databaseService);
  const apiKeyService = new ApiKeyService(apiKeyDatabaseService, jwtDatabaseService, configService);

  await yargs(hideBin(process.argv))
    .command(
      'create <userId>',
      'Create a new API key for a user',
      (yargs) => {
        return yargs
          .positional('userId', {
            describe: 'The user ID to create the API key for',
            type: 'string',
            demandOption: true,
          })
          .option('description', {
            alias: 'd',
            type: 'string',
            description: 'Description of the API key (e.g., "Prometheus Scraper")',
            demandOption: true,
          })
          .option('scopes', {
            alias: 's',
            type: 'string',
            description: 'Comma-separated scopes: read, report, analysis, admin, full',
            default: 'read',
          })
          .option('expires', {
            alias: 'e',
            type: 'number',
            description: 'Expiration in days (omit for no expiration)',
          });
      },
      async (argv) => {
        console.log(`\nCreating API key for user: ${argv.userId}...`);
        try {
          // Verify user exists
          const user = await prisma.user.findUnique({ where: { id: argv.userId as string } });
          if (!user) {
            console.error(`❌ User with ID ${argv.userId} not found.`);
            process.exit(1);
          }

          // Parse scopes
          const scopes = (argv.scopes as string)
            .split(',')
            .map(s => s.trim() as ApiKeyScope)
            .filter(s => VALID_SCOPES.includes(s));

          if (scopes.length === 0) {
            console.error(`❌ No valid scopes provided. Valid scopes: ${VALID_SCOPES.join(', ')}`);
            process.exit(1);
          }

          // Create API key
          const result = await apiKeyService.createApiKey({
            userId: argv.userId as string,
            description: argv.description as string,
            scopes,
            expiresInDays: argv.expires as number | undefined,
          });

          console.log('---------------------------------------------------');
          console.log('✅ API Key Created Successfully!');
          console.log('---------------------------------------------------');
          console.log(`API Key:         ${result.apiKey}`);
          console.log(`                 ⚠️  COPY THIS NOW! It will not be shown again.`);
          console.log('---------------------------------------------------');
          console.log(`Key ID:          ${result.keyInfo.id}`);
          console.log(`Prefix:          ${result.keyInfo.prefix}`);
          console.log(`User ID:         ${result.keyInfo.userId}`);
          console.log(`Description:     ${result.keyInfo.description}`);
          console.log(`Scopes:          ${result.keyInfo.scopes.join(', ')}`);
          console.log(`Active:          ${result.keyInfo.isActive ? '✅ Yes' : '❌ No'}`);
          console.log(`Expires At:      ${result.keyInfo.expiresAt ? new Date(result.keyInfo.expiresAt).toISOString() : 'Never'}`);
          console.log(`Created At:      ${new Date(result.keyInfo.createdAt).toISOString()}`);
          console.log('---------------------------------------------------');
          console.log('IMPORTANT: Store this API key securely. This is the only time it will be displayed.');
          console.log('---------------------------------------------------');
        } catch (error) {
          logger.error('❌ Error creating API key:', getErrorMessage(error));
          process.exit(1);
        }
      }
    )
    .command(
      'list [userId]',
      'List all API keys (or for a specific user)',
      (yargs) => {
        return yargs.positional('userId', {
          describe: 'Optional: filter by user ID',
          type: 'string',
        });
      },
      async (argv) => {
        console.log('\nFetching API keys...');
        try {
          let keys;
          if (argv.userId) {
            keys = await apiKeyService.listUserApiKeys(argv.userId as string);
          } else {
            // Fetch all API keys
            keys = await prisma.apiKey.findMany({
              include: { user: { select: { email: true, description: true } } },
              orderBy: { createdAt: 'desc' },
            });
          }

          if (keys && keys.length > 0) {
            console.log('--------------------------------------------------------------------------------------------------------------------------------');
            console.log('🔑 API Keys:');
            console.log('--------------------------------------------------------------------------------------------------------------------------------');
            console.log('Prefix      | Description                | Scopes              | Active | Expires At          | User Email / Description');
            console.log('------------|----------------------------|---------------------|--------|---------------------|--------------------------------');

            keys.forEach((key: any) => {
              const prefix = key.prefix.padEnd(11);
              const description = (key.description || 'N/A').substring(0, 26).padEnd(26);
              const scopes = (Array.isArray(key.scopes) ? key.scopes : JSON.parse(key.scopes || '[]')).join(',').substring(0, 19).padEnd(19);
              const active = key.isActive ? '✅ Yes' : '❌ No ';
              const expiresAt = key.expiresAt ? new Date(key.expiresAt).toISOString().substring(0, 19) : 'Never              ';
              const userInfo = key.user ? (key.user.email || key.user.description || 'N/A') : 'N/A';

              console.log(`${prefix} | ${description} | ${scopes} | ${active} | ${expiresAt} | ${userInfo}`);
            });
            console.log('--------------------------------------------------------------------------------------------------------------------------------');
          } else {
            console.log('ℹ️  No API keys found.');
          }
        } catch (error) {
          logger.error('❌ Error fetching API keys:', getErrorMessage(error));
          process.exit(1);
        }
      }
    )
    .command(
      'revoke <keyId>',
      'Revoke (deactivate) an API key',
      (yargs) => {
        return yargs.positional('keyId', {
          describe: 'The API key ID to revoke',
          type: 'string',
          demandOption: true,
        });
      },
      async (argv) => {
        console.log(`\nAttempting to revoke API key: ${argv.keyId}...`);
        try {
          // Find the key first to get userId
          const key = await prisma.apiKey.findUnique({ where: { id: argv.keyId as string } });
          if (!key) {
            console.error(`❌ API key with ID ${argv.keyId} not found.`);
            process.exit(1);
          }

          await apiKeyService.revokeApiKey(key.userId, argv.keyId as string);
          console.log(`✅ API key ${argv.keyId} (${key.prefix}***) revoked successfully.`);
        } catch (error) {
          logger.error('❌ Error revoking API key:', getErrorMessage(error));
          process.exit(1);
        }
      }
    )
    .command(
      'update <keyId>',
      'Update an API key\'s description or scopes',
      (yargs) => {
        return yargs
          .positional('keyId', {
            describe: 'The API key ID to update',
            type: 'string',
            demandOption: true,
          })
          .option('description', {
            alias: 'd',
            type: 'string',
            description: 'New description',
          })
          .option('scopes', {
            alias: 's',
            type: 'string',
            description: 'New comma-separated scopes',
          });
      },
      async (argv) => {
        console.log(`\nUpdating API key: ${argv.keyId}...`);
        try {
          // Find the key first to get userId
          const key = await prisma.apiKey.findUnique({ where: { id: argv.keyId as string } });
          if (!key) {
            console.error(`❌ API key with ID ${argv.keyId} not found.`);
            process.exit(1);
          }

          const updates: any = {};
          if (argv.description) {
            updates.description = argv.description;
          }
          if (argv.scopes) {
            const scopes = (argv.scopes as string)
              .split(',')
              .map(s => s.trim() as ApiKeyScope)
              .filter(s => VALID_SCOPES.includes(s));

            if (scopes.length === 0) {
              console.error(`❌ No valid scopes provided. Valid scopes: ${VALID_SCOPES.join(', ')}`);
              process.exit(1);
            }
            updates.scopes = scopes;
          }

          if (Object.keys(updates).length === 0) {
            console.error('❌ No updates provided. Use --description or --scopes.');
            process.exit(1);
          }

          await apiKeyService.updateApiKey(key.userId, argv.keyId as string, updates);
          console.log(`✅ API key ${argv.keyId} updated successfully.`);
        } catch (error) {
          logger.error('❌ Error updating API key:', getErrorMessage(error));
          process.exit(1);
        }
      }
    )
    .command(
      'delete <keyId>',
      'Permanently delete an API key (use with caution!)',
      (yargs) => {
        return yargs
          .positional('keyId', {
            describe: 'The API key ID to delete',
            type: 'string',
            demandOption: true,
          })
          .option('force', {
            alias: 'f',
            type: 'boolean',
            description: 'Force deletion without confirmation',
            default: false,
          });
      },
      async (argv) => {
        if (!argv.force) {
          const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
          });
          await new Promise(resolve => {
            readline.question(`🚨 Are you sure you want to PERMANENTLY DELETE API key ${argv.keyId}? (yes/NO): `, (answer: string) => {
              readline.close();
              if (answer.toLowerCase() !== 'yes') {
                console.log('Deletion cancelled.');
                process.exit(0);
              }
              resolve(null);
            });
          });
        }

        console.log(`\nDeleting API key: ${argv.keyId}...`);
        try {
          const key = await prisma.apiKey.delete({ where: { id: argv.keyId as string } });
          console.log(`🗑️  API key ${argv.keyId} (${key.prefix}***) deleted permanently.`);
        } catch (error) {
          logger.error('❌ Error deleting API key:', getErrorMessage(error));
          process.exit(1);
        }
      }
    )
    .example('$0 create user_123 -d "Prometheus" -s "admin"', 'Create admin API key for Prometheus')
    .example('$0 create user_123 -d "CI/CD Pipeline" -s "read" -e 365', 'Create read-only key expiring in 1 year')
    .example('$0 list', 'List all API keys')
    .example('$0 list user_123', 'List API keys for specific user')
    .example('$0 revoke key_abc123', 'Revoke an API key')
    .example('$0 update key_abc123 -s "admin,full"', 'Update key scopes')
    .demandCommand(1, 'You need to specify a command.')
    .strict()
    .help()
    .alias('h', 'help')
    .version(false)
    .wrap(null)
    .parseAsync();
}

main()
  .catch(async (error) => {
    console.error('\n❌ Unhandled error:');
    logger.error('Error occurred:', getErrorMessage(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('\nDatabase connection closed.');
  });
