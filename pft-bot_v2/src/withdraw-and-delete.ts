import { config } from './config.js';
import { PFTClient } from './pft-client.js';

async function withdrawAndDelete(): Promise<void> {
  console.log('[WITHDRAW] Starting withdrawal and deletion process...');

  const pft = new PFTClient(config);
  await pft.connect();

  try {
    // Step 1: Check current balance
    console.log('\n[BALANCE] Fetching current bot balance...');
    const balance = await pft.checkBalance();

    if (!balance.wallet_address) {
      console.error('\n[ERROR] Failed to fetch balance. Response:', JSON.stringify(balance, null, 2));
      throw new Error('Could not fetch wallet balance. The bot may not be properly initialized.');
    }

    console.log('\n[BALANCE] Current bot balance:');
    console.log(`  PFT: ${balance.native_balance.pft}`);
    console.log(`  Drops: ${balance.native_balance.drops}`);
    console.log(`  Address: ${balance.wallet_address}`);

    // Step 2: Get wallet info
    console.log('\n[WALLET] Fetching bot wallet info...');
    const walletInfo = await pft.getWalletInfo();

    if (!walletInfo.wallet_address) {
      console.error('\n[ERROR] Failed to fetch wallet info. Response:', JSON.stringify(walletInfo, null, 2));
      throw new Error('Could not fetch wallet info. The bot may not be properly initialized.');
    }

    console.log('\n[WALLET] Bot wallet info:');
    console.log(`  Address: ${walletInfo.wallet_address}`);
    console.log(`  Public Key: ${walletInfo.public_key}`);

    // Step 3: Ask for recipient address
    console.log('\n[INPUT] Please enter the recipient address to send PFT to:');
    console.log('(Press Ctrl+C to cancel)');

    // Read from stdin
    const recipientAddress = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });

    if (!recipientAddress || recipientAddress.length < 25) {
      throw new Error('Invalid recipient address');
    }

    // Step 4: Ask for amount
    console.log(`\n[INPUT] How much PFT to send? (Available: ${balance.native_balance.pft})`);
    const amountInput = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });

    const amount = amountInput || balance.native_balance.pft;

    console.log(`\n[CONFIRM] About to send ${amount} PFT to ${recipientAddress}`);
    console.log('Press Enter to confirm, or Ctrl+C to cancel...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });

    // Step 5: Send PFT
    console.log('\n[SEND] Sending PFT...');
    const sendResult = await pft.sendPft({
      recipient: recipientAddress,
      amount_pft: amount,
    });
    console.log(`[SEND] ✓ PFT sent successfully!`);
    console.log(`  Transaction hash: ${sendResult.tx_hash}`);

    // Step 6: Check new balance
    const newBalance = await pft.checkBalance();
    console.log('\n[BALANCE] New bot balance:');
    console.log(`  PFT: ${newBalance.native_balance.pft}`);
    console.log(`  Drops: ${newBalance.native_balance.drops}`);

    // Step 7: Delete bot
    console.log('\n[DELETE] To confirm bot deletion, type "Agree" and press Enter, or Ctrl+C to cancel:');
    const deleteConfirmation = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });

    if (deleteConfirmation !== 'Agree') {
      console.log('[DELETE] Confirmation not received. Bot registration was NOT deleted.');
      return;
    }

    console.log('[DELETE] Deleting bot registration...');
    await pft.deleteBot(walletInfo.wallet_address);
    console.log('[DELETE] ✓ Bot registration deleted successfully!');

    console.log('\n[DONE] Withdrawal and deletion complete.');
    console.log('\nNOTE: Your bot seed is still in .env file. Store it safely if you want to recreate the wallet later.');

  } catch (err) {
    console.error('\n[ERROR]', err);
    throw err;
  } finally {
    await pft.close();
    process.exit(0);
  }
}

withdrawAndDelete().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
