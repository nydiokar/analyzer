/**
 * Test script to validate mapping statistics and diagnose validation issues
 * Run with: npx ts-node src/queues/test-mapping-validation.ts
 */

import { DatabaseService } from '../core/services/database-service';
import { mapHeliusTransactionsToIntermediateRecords } from '../core/services/helius-transaction-mapper';
import { createLogger } from '../core/utils/logger';

const logger = createLogger('MappingValidationTest');

async function testMappingValidation() {
    logger.info('🔍 Starting mapping validation test...');
    
    const databaseService = new DatabaseService();
    
    // Test 1: Empty transaction array (edge case)
    logger.info('📋 Test 1: Empty transaction array');
    try {
        const emptyResult = mapHeliusTransactionsToIntermediateRecords('test-wallet', []);
        logger.info('Empty result stats:', emptyResult.stats);
        
        // Try to save it
        const saveResult = await databaseService.saveMappingActivityLog('test-wallet-empty', emptyResult.stats);
        if (saveResult) {
            logger.info('✅ Empty stats saved successfully with ID:', saveResult.id);
        } else {
            logger.warn('❌ Failed to save empty stats');
        }
    } catch (error) {
        logger.error('❌ Test 1 failed:', error);
    }
    
    // Test 2: Validate schema field compatibility
    logger.info('📋 Test 2: Schema field validation');
    try {
        // Create a mock stats object with potential problematic values
        const mockStats = {
            totalTransactionsReceived: 5,
            transactionsSkippedError: undefined, // Potential issue
            transactionsSuccessfullyProcessed: 3,
            analysisInputsGenerated: null, // Potential issue
            nativeSolTransfersProcessed: 2,
            tokenTransfersProcessed: 1,
            wsolTransfersProcessed: 0,
            usdcTransfersProcessed: 0,
            otherTokenTransfersProcessed: 1,
            feePayerHeuristicApplied: 0,
            feesCalculated: 0,
            eventMatcherAttempts: 1,
            eventMatcherPrimaryMintsIdentified: 1,
            eventMatcherConsistentSolFound: 0,
            eventMatcherConsistentUsdcFound: 0,
            eventMatcherAmbiguous: 0,
            eventMatcherNoConsistentValue: 0,
            splToSplSwapDetections: 0,
            associatedValueFromSplToSpl: 0,
            associatedValueFromEventMatcher: 1,
            associatedValueFromTotalMovement: 0,
            associatedValueFromNetChange: 0,
            smallOutgoingHeuristicApplied: 0,
            skippedDuplicateRecordKey: 0,
            unknownTxSkippedNoJito: 0,
            countByInteractionType: { SWAP: 2, TRANSFER: 1 },
            extraField: 'should be ignored' // Extra field that shouldn't cause issues
        };
        
        logger.info('Mock stats with potential issues:', mockStats);
        
        const saveResult = await databaseService.saveMappingActivityLog('test-wallet-mock', mockStats as any);
        if (saveResult) {
            logger.info('✅ Mock stats saved successfully with ID:', saveResult.id);
        } else {
            logger.warn('❌ Failed to save mock stats (expected behavior for demonstration)');
        }
    } catch (error) {
        logger.error('❌ Test 2 failed:', error);
    }
    
    // Test 3: Check required fields from schema
    logger.info('📋 Test 3: Required fields verification');
    const requiredFields = [
        'totalTransactionsReceived',
        'transactionsSkippedError', 
        'transactionsSuccessfullyProcessed',
        'analysisInputsGenerated',
        'nativeSolTransfersProcessed',
        'tokenTransfersProcessed',
        'wsolTransfersProcessed',
        'usdcTransfersProcessed',
        'otherTokenTransfersProcessed',
        'feePayerHeuristicApplied',
        'feesCalculated',
        'eventMatcherAttempts',
        'eventMatcherPrimaryMintsIdentified',
        'eventMatcherConsistentSolFound',
        'eventMatcherConsistentUsdcFound',
        'eventMatcherAmbiguous',
        'eventMatcherNoConsistentValue',
        'splToSplSwapDetections',
        'associatedValueFromSplToSpl',
        'associatedValueFromEventMatcher',
        'associatedValueFromTotalMovement',
        'associatedValueFromNetChange',
        'smallOutgoingHeuristicApplied',
        'skippedDuplicateRecordKey',
        'countByInteractionType',
        'unknownTxSkippedNoJito'
    ];
    
    const emptyResult = mapHeliusTransactionsToIntermediateRecords('test-wallet', []);
    const missingFields = requiredFields.filter(field => !(field in emptyResult.stats));
    const extraFields = Object.keys(emptyResult.stats).filter(field => !requiredFields.includes(field));
    
    logger.info(`📊 Required fields check:
    - Missing fields: ${missingFields.length > 0 ? missingFields.join(', ') : 'None ✅'}
    - Extra fields: ${extraFields.length > 0 ? extraFields.join(', ') : 'None ✅'}
    - Total mapped fields: ${Object.keys(emptyResult.stats).length}
    - Total required fields: ${requiredFields.length}`);
    
    logger.info('🎯 Mapping validation test completed!');
}

// Run the test if this file is executed directly
if (require.main === module) {
    testMappingValidation()
        .then(() => {
            logger.info('✅ All tests completed');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('❌ Test suite failed:', error);
            process.exit(1);
        });
}

export { testMappingValidation }; 