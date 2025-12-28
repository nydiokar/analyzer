import 'reflect-metadata';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DatabaseService, prisma } from '../src/core/services/database-service'; // Adjusted path

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
          const result = await dbService.createUser(argv.description);

          if (result && result.user && result.apiKey) {
            console.log('---------------------------------------------------');
            console.log('✅ User Created Successfully!');
            console.log('---------------------------------------------------');
            console.log(`User ID:         ${result.user.id}`);
            console.log(`API Key:         ${result.apiKey} <--- COPY THIS KEY NOW! It will not be shown again.`);
            console.log(`Description:     ${result.user.description || 'N/A'}`);
            console.log(`Is Active:       ${result.user.isActive}`);
            console.log('---------------------------------------------------');
            console.log('IMPORTANT: Store the API Key securely. This is the only time it will be displayed.');
            console.log('---------------------------------------------------');
          } else {
            console.error('❌ Failed to create user or user/API key was not returned.');
            if (result) console.error('Result received:', JSON.stringify(result, null, 2));
          }
        } catch (error) {
          console.error('❌ Error during user creation:', error);
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
            console.log('----------------------------------------------------------------------------------------------------------------------------------------');
            console.log('🔑 All Users:');
            console.log('----------------------------------------------------------------------------------------------------------------------------------------');
            console.log('ID                                    | Email                              | Active | Is Demo | Description            | Created At');
            console.log('---------------------------------------|---------------------------------------|--------|---------|------------------------|---------------------------');
            users.forEach(user => {
              const id = user.id.padEnd(36);
              const email = (user.email || 'N/A').padEnd(35);
              const active = user.isActive ? '✅ Yes' : '❌ No ';
              const isDemo = user.isDemo ? '✅ Yes' : 'No    ';
              const description = (user.description || 'N/A').padEnd(22);
              const createdAt = new Date(user.createdAt).toISOString().substring(0, 10);
              console.log(`${id} | ${email} | ${active} | ${isDemo} | ${description} | ${createdAt}`);
            });
            console.log('----------------------------------------------------------------------------------------------------------------------------------------');
          } else {
            console.log('ℹ️ No users found in the database.');
          }
        } catch (error) {
          console.error('❌ Error fetching users:', error);
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
          console.error('❌ Error activating user:', error);
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
          console.error('❌ Error deactivating user:', error);
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
          console.error('❌ Error deleting user:', error);
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
          console.error('❌ Error setting demo status:', error);
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
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('\nDatabase connection closed.');
  }); 