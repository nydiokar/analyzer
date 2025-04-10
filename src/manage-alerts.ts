import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CryptoAnalyzer } from './core/analysis/analyzer';

const analyzer = new CryptoAnalyzer();
analyzer.loadAlerts(); // Ensure alerts are loaded

// CLI command handling
yargs(hideBin(process.argv))
  .command('setalert <coin> <threshold>', 'Set a price alert', (yargs) => {
    yargs
      .positional('coin', {
        describe: 'The coin to set an alert for',
        type: 'string'
      })
      .positional('threshold', {
        describe: 'The price change threshold (%)',
        type: 'number'
      });
  }, async (argv) => {
    const { coin, threshold } = argv;
    const isValid = await analyzer.isValidCoin(coin as string);
    if (!isValid) {
      console.error(`Coin ${coin} is not supported.`);
      return;
    }
    analyzer.setAlertThreshold(coin as string, threshold as number);
    console.log(`Alert set for ${coin} at ${threshold}%`);
  })
  .command('listalerts', 'List all alerts', () => {}, () => {
    const alerts = analyzer.getAlertThresholds();
    if (Object.keys(alerts).length === 0) {
      console.log('No alerts set.');
      return;
    }
    
    console.log('Current Alerts:');
    Object.entries(alerts).forEach(([coin, info]) => {
      console.log(`• ${coin}: ${info.percentage}% threshold (set at ${new Date(info.addedAt).toLocaleString()})`);
    });
  })
  .command('removealert <coin>', 'Remove an alert', (yargs) => {
    yargs.positional('coin', {
      describe: 'The coin to remove the alert for',
      type: 'string'
    });
  }, (argv) => {
    const { coin } = argv;
    analyzer.removeAlertThreshold(coin as string);
    console.log(`Alert removed for ${coin}`);
  })
  .command('listsupported', 'List coins with alerts', () => {}, () => {
    const alerts = analyzer.getAlertThresholds();
    if (Object.keys(alerts).length === 0) {
      console.log('No coins with alerts.');
      return;
    }
    
    console.log('Coins with alerts:');
    Object.entries(alerts).forEach(([coin, info]) => {
      console.log(`• ${coin}: ${info.percentage}% threshold (set at ${new Date(info.addedAt).toLocaleString()})`);
    });
  })
  .help()
  .argv; 