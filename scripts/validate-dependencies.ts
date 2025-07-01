import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Logger } from '@nestjs/common';

/**
 * Dependency Validation Tool
 * Automatically validates all NestJS module dependencies
 * Prevents runtime injection errors by checking dependencies at startup
 */
async function validateDependencies() {
  // Suppress Redis connection noise during validation
  const originalHandlers = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason: any) => {
    // Only log non-Redis connection errors
    if (!reason?.message?.includes('Connection is closed')) {
      console.error('Unhandled rejection:', reason);
    }
  });
  
  console.log('🔍 Validating NestJS Dependencies...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    // Try to create the full application
    console.log('🏗️ Creating NestJS application...');
    const app = await NestFactory.create(AppModule, {
      logger: false // Disable logs for cleaner output
    });
    
    // Initialize all dependencies
    await app.init();
    
    console.log('✅ All dependencies resolved successfully!');
    console.log('🎉 Your modules are properly configured');
    
    // Get some statistics
    const modules = (app as any).container.getModules();
    console.log(`📊 Loaded ${modules.size} modules`);
    
    // List all modules
    console.log('\n📋 Module Summary:');
    modules.forEach((moduleRef: any, token: any) => {
      const moduleName = token.name || 'Anonymous';
      const providers = moduleRef.providers.size;
      const controllers = moduleRef.controllers.size;
      console.log(`   • ${moduleName}: ${providers} providers, ${controllers} controllers`);
    });
    
    // Clean shutdown
    console.log('\n🔧 Shutting down gracefully...');
    await app.close();
    
    // Wait for Redis connections to close and suppress any noise
    await new Promise(resolve => setTimeout(resolve, 300));
    
    console.log('✅ Validation completed successfully!');
    
    // Restore original handlers
    process.removeAllListeners('unhandledRejection');
    originalHandlers.forEach(handler => process.on('unhandledRejection', handler));
    
    process.exit(0);
    
  } catch (error) {
    console.log('❌ Dependency validation failed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Nest can\'t resolve dependencies')) {
      console.log('🔧 DEPENDENCY INJECTION ERROR:');
      console.log(errorMessage);
      
      // Extract helpful information
      const matches = errorMessage.match(/dependencies of the (\w+) \((.*?)\)/);
      if (matches) {
        const [, className, deps] = matches;
        console.log(`\n📝 Class: ${className}`);
        console.log(`📝 Dependencies: ${deps}`);
        
        // Find the missing dependency
        const missingMatch = errorMessage.match(/argument (\w+) at index \[(\d+)\]/);
        if (missingMatch) {
          const [, missingDep, index] = missingMatch;
          console.log(`❌ Missing: ${missingDep} (position ${index})`);
          
          console.log('\n💡 Quick fixes:');
          console.log(`   1. Add ${missingDep} to the module's providers array`);
          console.log(`   2. Import the module that provides ${missingDep}`);
          console.log(`   3. Check if ${missingDep} has @Injectable() decorator`);
        }
      }
    } else {
      console.log('🔧 UNKNOWN ERROR:');
      console.log(errorMessage);
    }
    
    console.log('\n🛠️  Suggested debugging steps:');
    console.log('   1. Check your module imports');
    console.log('   2. Verify service @Injectable() decorators');
    console.log('   3. Ensure circular dependencies are handled');
    console.log('   4. Check if services are exported from their modules');
    
    console.log('\n❌ Validation failed!');
    
    // Restore original handlers
    process.removeAllListeners('unhandledRejection');
    originalHandlers.forEach(handler => process.on('unhandledRejection', handler));
    
    process.exit(1);
  }
}

// Helper function to validate specific module
async function validateModule(moduleName: string) {
  console.log(`🔍 Validating specific module: ${moduleName}`);
  // Implementation for module-specific validation
}

// Run validation
if (require.main === module) {
  validateDependencies().catch(console.error);
}

export { validateDependencies, validateModule }; 