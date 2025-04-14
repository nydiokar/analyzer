import { expect } from 'chai';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ExecError extends Error {
  stderr: string;
}

describe('Staking Calculator', () => {
  it('should calculate returns for native staking correctly', async () => {
    const amount = 100;
    const days = 365;
    const type = 'native';
    const expectedApy = 6.5;

    const { stdout } = await execAsync(`ts-node src/scripts/staking-calc.ts --amount ${amount} --days ${days} --type ${type}`);
    
    // Verify output contains key information
    expect(stdout).to.include('=== Solana Staking Calculator Report ===');
    expect(stdout).to.include(`Amount: ${amount} SOL`);
    expect(stdout).to.include(`Duration: ${days} days`);
    expect(stdout).to.include('Solana Native Staking');
    expect(stdout).to.include(`APY: ${expectedApy}%`);
    
    // Verify calculations
    const expectedReturn = amount * Math.pow(1 + expectedApy/100, days/365) - amount;
    const returnMatch = stdout.match(/Earned SOL: ([\d.]+)/);
    if (returnMatch) {
      const actualReturn = parseFloat(returnMatch[1]);
      expect(actualReturn).to.be.approximately(expectedReturn, 0.0001);
    }
  });

  it('should validate minimum stake amount', async () => {
    try {
      await execAsync('ts-node src/scripts/staking-calc.ts --amount 0.5 --type native');
      throw new Error('Should have failed with minimum stake error');
    } catch (error) {
      expect((error as ExecError).stderr).to.include('Minimum stake amount is 1 SOL');
    }
  });

  it('should calculate returns for Marinade staking correctly', async () => {
    const amount = 100;
    const days = 365;
    const type = 'marinade';
    const expectedApy = 6.8;

    const { stdout } = await execAsync(`ts-node src/scripts/staking-calc.ts --amount ${amount} --days ${days} --type ${type}`);
    
    expect(stdout).to.include('Marinade Liquid Staking');
    expect(stdout).to.include(`APY: ${expectedApy}%`);
    
    const expectedReturn = amount * Math.pow(1 + expectedApy/100, days/365) - amount;
    const returnMatch = stdout.match(/Earned SOL: ([\d.]+)/);
    if (returnMatch) {
      const actualReturn = parseFloat(returnMatch[1]);
      expect(actualReturn).to.be.approximately(expectedReturn, 0.0001);
    }
  });
}); 