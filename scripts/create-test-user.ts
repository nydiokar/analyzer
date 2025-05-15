import { DatabaseService, prisma } from '../src/wallet_analysis/services/database-service';

async function main() {
  console.log('Attempting to create a test user...');
  // Note: The DatabaseService uses a global Prisma client instance, 
  // so we don't need to pass it in if it's initialized as in the original file.
  const dbService = new DatabaseService();

  try {
    const result = await dbService.createUser('Automated Test User');

    if (result && result.user && result.apiKey) {
      console.log('---------------------------------------------------');
      console.log('✅ Test User Created Successfully!');
      console.log('---------------------------------------------------');
      console.log(`User ID:         ${result.user.id}`);
      console.log(`API Key:         ${result.apiKey}`);
      console.log(`Description:     ${result.user.description}`);
      console.log(`Is Active:       ${result.user.isActive}`);
      console.log('---------------------------------------------------');
      console.log('IMPORTANT: Copy the API Key above. You will need it to test the API.');
      console.log('This key is shown only once.');
      console.log('---------------------------------------------------');
    } else {
      console.error('Failed to create user or user/API key was not returned.');
      if (result) console.error('Result received:', JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Error during user creation script:', error);
  } finally {
    await prisma.$disconnect();
    console.log('Database connection closed.');
  }
}

main().catch(e => {
  console.error('Unhandled error in main function:', e);
  prisma.$disconnect();
  process.exit(1);
}); 