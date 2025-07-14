import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CodaResponse, ParsedExpense, parseExpense } from './types';
import { MigrationService } from './migration-service';
import { ConfigService } from './config-service';

// Load environment variables from .env file
dotenv.config();

async function fetchCodaData(): Promise<void> {
  try {
    // Get the bearer token from environment variable
    const bearerToken = process.env.CODA_API_TOKEN;
    
    if (!bearerToken) {
      throw new Error('CODA_API_TOKEN environment variable is not set');
    }

    const url = 'https://coda.io/apis/v1/docs/c3f76sgO8s/tables/grid-a3EoctjUSV/rows?valueFormat=rich';
    
    console.log('🚀 Making request to Coda API...');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText}\nResponse: ${errorText}`);
    }

    const data: CodaResponse = await response.json();

    console.log('✅ Request successful!');
    console.log('📊 Response Summary:');
    console.log(`   - Status: ${response.status}`);
    console.log(`   - Total expenses: ${data.items.length}`);
    console.log(`   - API href: ${data.href}`);

    // Save raw response to file
    const rawOutputPath = path.join(process.cwd(), 'coda-response-raw.json');
    fs.writeFileSync(rawOutputPath, JSON.stringify(data, null, 2));
    console.log(`💾 Raw response saved to: ${rawOutputPath}`);

    // Parse expenses using our type-safe parser
    console.log('\n🔄 Parsing expenses...');
    const parsedExpenses: ParsedExpense[] = data.items.map(parseExpense);

    // Save parsed expenses to file
    const parsedOutputPath = path.join(process.cwd(), 'coda-expenses-parsed.json');
    fs.writeFileSync(parsedOutputPath, JSON.stringify(parsedExpenses, null, 2));
    console.log(`💾 Parsed expenses saved to: ${parsedOutputPath}`);

    // Display summary statistics
    console.log('\n📈 Expense Summary:');
    
    const totalAmount = parsedExpenses.reduce((sum, expense) => {
      return sum + (expense.amount?.amount || 0);
    }, 0);
    
    const expensesByStatus = parsedExpenses.reduce((acc, expense) => {
      const status = expense.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const expensesByVendor = parsedExpenses.reduce((acc, expense) => {
      const vendor = expense.vendor || 'Unknown';
      acc[vendor] = (acc[vendor] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`   💰 Total Amount: $${totalAmount.toFixed(2)}`);
    console.log(`   📋 Status Breakdown:`);
    Object.entries(expensesByStatus).forEach(([status, count]) => {
      console.log(`      - ${status}: ${count} expenses`);
    });

    console.log(`   🏪 Top Vendors:`);
    const topVendors = Object.entries(expensesByVendor)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    topVendors.forEach(([vendor, count]) => {
      console.log(`      - ${vendor}: ${count} expenses`);
    });

    // Display recent expenses
    console.log('\n🕒 Recent Expenses (last 5):');
    const recentExpenses = parsedExpenses
      .filter(e => e.date)
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      .slice(0, 5);

    recentExpenses.forEach((expense, index) => {
      const amount = expense.amount ? `$${expense.amount.amount}` : 'N/A';
      const date = expense.date ? expense.date.toLocaleDateString() : 'N/A';
      console.log(`   ${index + 1}. ${expense.vendor} - ${amount} (${date})`);
      console.log(`      ${expense.description || 'No description'}`);
    });

    console.log('\n🎉 Data processing complete!');
    console.log('\n📝 Available files:');
    console.log(`   - ${rawOutputPath} (raw Coda API response)`);
    console.log(`   - ${parsedOutputPath} (parsed with proper types)`);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runMigration(): Promise<void> {
  try {
    console.log('\n🔄 Starting migration process...');
    
    // Validate required environment variables
    const bearerToken = process.env.CODA_API_TOKEN;

    if (!bearerToken) {
      throw new Error('CODA_API_TOKEN environment variable is not set');
    }

    // Load configuration from YAML file
    const configService = new ConfigService('migration-config.yaml');
    const yamlConfig = configService.loadConfig();
    const migrationConfig = configService.createMigrationConfig(yamlConfig);

    // Display configuration
    configService.displayConfig(migrationConfig);

    // Create migration service and run migration
    const migrationService = new MigrationService(migrationConfig, bearerToken);
    const results = await migrationService.migrate();

    // Save migration results
    const resultsPath = path.join(process.cwd(), 'migration-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`💾 Migration results saved to: ${resultsPath}`);

    console.log('\n🎉 Migration process complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runRecovery(): Promise<void> {
  try {
    console.log('\n🔄 Starting recovery process...');
    
    // Validate required environment variables
    const bearerToken = process.env.CODA_API_TOKEN;

    if (!bearerToken) {
      throw new Error('CODA_API_TOKEN environment variable is not set');
    }

    // Load configuration from YAML file
    const configService = new ConfigService('migration-config.yaml');
    const yamlConfig = configService.loadConfig();
    const migrationConfig = configService.createMigrationConfig(yamlConfig);

    // Display configuration
    configService.displayConfig(migrationConfig);

    // Create migration service and run recovery
    const migrationService = new MigrationService(migrationConfig, bearerToken);
    const results = await migrationService.recover();

    // Save recovery results
    const resultsPath = path.join(process.cwd(), 'recovery-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`💾 Recovery results saved to: ${resultsPath}`);

    console.log('\n🎉 Recovery process complete!');

  } catch (error) {
    console.error('❌ Recovery failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.includes('--migrate')) {
    await runMigration();
  } else if (args.includes('--analyze')) {
    await fetchCodaData();
  } else if (args.includes('--recover')) {
    await runRecovery();
  } else {
    console.log('📚 Coda Expense Migration Tool');
    console.log('');
    console.log('Usage:');
    console.log('  npm run analyze             # Analyze existing expense data');
    console.log('  npm run migrate             # Run migration (uses migration-config.yaml)');
    console.log('  npm run recover             # Retry failed rows from previous migrations');
    console.log('');
    console.log('Configuration:');
    console.log('  - Edit migration-config.yaml to configure source/destination tables and column mappings');
    console.log('  - Set up your .env file with the required credentials (see README.md)');
    console.log('');
    console.log('Files:');
    console.log('  - migration-config.yaml     # Column mappings and migration settings');
    console.log('  - .env                      # API tokens and storage credentials');
  }
}

// Run the appropriate function based on command line arguments
main(); 