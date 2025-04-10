import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { AlertManager } from '../src/core/alerts/alert-manager';

describe('AlertManager', () => {
  const testAlertsDir = './test/alerts';
  const testAlertsFile = path.join(testAlertsDir, 'alerts.txt');
  let alertManager: AlertManager;

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testAlertsDir)) {
      fs.rmSync(testAlertsDir, { recursive: true });
    }
    alertManager = new AlertManager(testAlertsDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testAlertsDir)) {
      fs.rmSync(testAlertsDir, { recursive: true });
    }
  });

  it('should create alerts directory if it does not exist', () => {
    expect(fs.existsSync(testAlertsDir)).to.be.true;
  });

  it('should write price alerts to file', async () => {
    await alertManager.sendPriceAlert('bitcoin', 50000, 5, 'volatility');
    
    expect(fs.existsSync(testAlertsFile)).to.be.true;
    const content = fs.readFileSync(testAlertsFile, 'utf8');
    expect(content).to.include('PRICE ALERT');
    expect(content).to.include('BITCOIN');
    expect(content).to.include('50000');
  });

  it('should write volume alerts to file', async () => {
    await alertManager.sendVolumeAlert('ethereum', 1000000, 50);
    
    expect(fs.existsSync(testAlertsFile)).to.be.true;
    const content = fs.readFileSync(testAlertsFile, 'utf8');
    expect(content).to.include('VOLUME ALERT');
    expect(content).to.include('ETHEREUM');
    expect(content).to.include('1000000');
  });
}); 