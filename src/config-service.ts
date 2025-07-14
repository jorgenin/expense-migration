import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { YamlMigrationConfig, MigrationConfig } from './types';

export class ConfigService {
  private configPath: string;

  constructor(configPath: string = 'migration-config.yaml') {
    this.configPath = path.resolve(configPath);
  }

  loadConfig(): YamlMigrationConfig {
    console.log(`📁 Loading configuration from: ${this.configPath}`);
    
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Configuration file not found: ${this.configPath}`);
    }

    try {
      const fileContents = fs.readFileSync(this.configPath, 'utf8');
      const config = yaml.load(fileContents) as YamlMigrationConfig;
      
      this.validateConfig(config);
      console.log('✅ Configuration loaded successfully');
      
      return config;
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  createMigrationConfig(yamlConfig: YamlMigrationConfig): MigrationConfig {
    // Validate required environment variables
    const doBucket = process.env.DO_SPACES_BUCKET;
    const doEndpoint = process.env.DO_SPACES_ENDPOINT;
    const doKey = process.env.DO_SPACES_KEY;
    const doSecret = process.env.DO_SPACES_SECRET;

    if (!doBucket || !doEndpoint || !doKey || !doSecret) {
      throw new Error('DigitalOcean Spaces environment variables are not set. Required: DO_SPACES_BUCKET, DO_SPACES_ENDPOINT, DO_SPACES_KEY, DO_SPACES_SECRET');
    }

    return {
      sourceDocId: yamlConfig.migration.source.docId,
      sourceTableId: yamlConfig.migration.source.tableId,
      destinationDocId: yamlConfig.migration.destination.docId,
      destinationTableId: yamlConfig.migration.destination.tableId,
      digitalOceanSpaces: {
        bucket: doBucket,
        endpoint: doEndpoint,
        accessKey: doKey,
        secretKey: doSecret,
        region: process.env.DO_SPACES_REGION || 'nyc3'
      },
      migrationFolder: yamlConfig.migration.settings.migrationFolder,
      batchSize: yamlConfig.migration.settings.batchSize,
      insertBatchSize: yamlConfig.migration.settings.insertBatchSize,
      columnMappings: yamlConfig.migration.columnMappings,
      skipColumns: yamlConfig.migration.skipColumns,
      transformations: yamlConfig.migration.transformations,
      fileProcessing: yamlConfig.migration.fileProcessing
    };
  }

  private validateConfig(config: YamlMigrationConfig): void {
    if (!config.migration) {
      throw new Error('Configuration must have a "migration" section');
    }

    const { migration } = config;

    // Validate required sections
    if (!migration.source || !migration.destination) {
      throw new Error('Configuration must have both "source" and "destination" sections');
    }

    if (!migration.settings) {
      throw new Error('Configuration must have a "settings" section');
    }

    if (!migration.columnMappings) {
      throw new Error('Configuration must have a "columnMappings" section');
    }

    // Validate required fields
    if (!migration.source.docId || !migration.source.tableId) {
      throw new Error('Source configuration must have docId and tableId');
    }

    if (!migration.destination.docId || !migration.destination.tableId) {
      throw new Error('Destination configuration must have docId and tableId');
    }

    if (!migration.settings.batchSize || !migration.settings.insertBatchSize || !migration.settings.migrationFolder) {
      throw new Error('Settings must have batchSize, insertBatchSize, and migrationFolder');
    }

    // Validate batch sizes
    if (migration.settings.batchSize <= 0 || migration.settings.batchSize > 100) {
      throw new Error('Batch size must be between 1 and 100');
    }

    if (migration.settings.insertBatchSize <= 0 || migration.settings.insertBatchSize > 50) {
      throw new Error('Insert batch size must be between 1 and 50');
    }

    console.log('✅ Configuration validation passed');
  }

  displayConfig(config: MigrationConfig): void {
    console.log('\n📋 Migration Configuration:');
    console.log(`   Source: ${config.sourceDocId}/${config.sourceTableId}`);
    console.log(`   Destination: ${config.destinationDocId}/${config.destinationTableId}`);
    console.log(`   Fetch Batch Size: ${config.batchSize} rows`);
    console.log(`   Insert Batch Size: ${config.insertBatchSize} rows`);
    console.log(`   Storage: ${config.digitalOceanSpaces.bucket}/${config.migrationFolder}`);
    console.log(`   Column Mappings: ${Object.keys(config.columnMappings).length} defined`);
    console.log(`   Skip Columns: ${config.skipColumns.length} defined`);
    
    if (config.transformations && Object.keys(config.transformations).length > 0) {
      console.log(`   Transformations: ${Object.keys(config.transformations).length} defined`);
    }
  }

  // Helper method to get mapping for a source column
  getColumnMapping(sourceColumnName: string, config: MigrationConfig): string | null {
    return config.columnMappings[sourceColumnName] || null;
  }

  // Helper method to check if a column should be skipped
  shouldSkipColumn(columnName: string, config: MigrationConfig): boolean {
    return config.skipColumns.includes(columnName);
  }

  // Helper method to get transformation for a column
  getTransformation(columnName: string, config: MigrationConfig): { from: string; to: string } | null {
    return config.transformations?.[columnName] || null;
  }
} 