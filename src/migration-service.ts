import * as fs from 'fs';
import * as path from 'path';
import { TableService } from './table-service';
import { FileService } from './file-service';
import { StorageService } from './storage-service';
import { MigrationConfig, ColumnMapping, MigrationResult, ProcessedFile } from './types';

interface PreparedRow {
  sourceRowId: string;
  destinationData: Record<string, any>;
  processedFiles: ProcessedFile[];
}

export class MigrationService {
  private tableService: TableService;
  private fileService: FileService;
  private storageService: StorageService;
  private config: MigrationConfig;
  private bearerToken: string;

  constructor(config: MigrationConfig, bearerToken: string) {
    this.config = config;
    this.bearerToken = bearerToken;
    this.tableService = new TableService(bearerToken);
    this.fileService = new FileService();
    this.storageService = new StorageService(config.digitalOceanSpaces, config.migrationFolder);
  }

  async migrate(): Promise<MigrationResult[]> {
    console.log('🚀 Starting migration process...');
    console.log(`📋 Config: ${this.config.batchSize} rows from ${this.config.sourceTableId} to ${this.config.destinationTableId}`);

    try {
      // Test connections first
      await this.testConnections();

      // Get column mappings using configuration
      const columnMappings = await this.tableService.createColumnMapping(
        this.config.sourceDocId,
        this.config.sourceTableId,
        this.config.destinationDocId,
        this.config.destinationTableId,
        this.config
      );

      if (columnMappings.length === 0) {
        throw new Error('No column mappings found. Check your configuration.');
      }

      // Get all rows from source table using proper Coda pagination
      console.log(`\n🚀 Starting migration of entire table...`);
      const sourceRows = await this.tableService.getAllTableRows(
        this.config.sourceDocId,
        this.config.sourceTableId,
        this.config.batchSize
      );

      if (sourceRows.length === 0) {
        console.log('⚠️  No rows to migrate');
        return [];
      }

      console.log(`\n📋 Processing ${sourceRows.length} rows with migration logic...`);

      // Phase 1: Process files and prepare row data
      console.log(`\n🔄 Phase 1: Processing files and preparing data for ${sourceRows.length} rows...`);
      const preparedRows: PreparedRow[] = [];
      const allResults: MigrationResult[] = [];

      for (let i = 0; i < sourceRows.length; i++) {
        const sourceRow = sourceRows[i];
        console.log(`\n📝 Preparing row ${i + 1}/${sourceRows.length} (ID: ${sourceRow.id})`);
        
        try {
          const result = await this.prepareRow(sourceRow, columnMappings);
          preparedRows.push(result);
          console.log(`✅ Row ${i + 1} prepared successfully (ID: ${sourceRow.id})`);
        } catch (error) {
          console.error(`❌ Error preparing row ${i + 1} (ID: ${sourceRow.id}): ${error}`);
          allResults.push({
            success: false,
            sourceRowId: sourceRow.id,
            processedFiles: [],
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // Add delay between file processing to avoid overwhelming the system
        if (i < sourceRows.length - 1) {
          console.log('⏸️  Waiting 1 second between file processing...');
          // await this.sleep(1000);
        }

        // Progress indicator every 50 rows
        if ((i + 1) % 50 === 0) {
          console.log(`\n📊 Preparation Progress: ${i + 1}/${sourceRows.length} rows prepared`);
          console.log(`   ✅ Prepared: ${preparedRows.length} | ❌ Failed: ${allResults.length}`);
        }
      }

      console.log(`\n✅ Phase 1 complete: ${preparedRows.length} rows prepared for insertion`);

      // Phase 2: Insert prepared rows in batches
      if (preparedRows.length > 0) {
        console.log(`\n🔄 Phase 2: Inserting ${preparedRows.length} rows in batches...`);
        const batchSize = this.config.insertBatchSize;
        const batches: PreparedRow[][] = [];
        
        for (let i = 0; i < preparedRows.length; i += batchSize) {
          batches.push(preparedRows.slice(i, i + batchSize));
        }

        console.log(`📦 Will process ${batches.length} batches of up to ${batchSize} rows each`);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          console.log(`\n📝 Inserting batch ${batchIndex + 1}/${batches.length} (${batch.length} rows)...`);

          try {
            const rowDataArray = batch.map(row => row.destinationData);
            const batchResults = await this.insertRowsBatch(rowDataArray);

            // Map batch results back to individual row results
            for (let i = 0; i < batch.length; i++) {
              const preparedRow = batch[i];
              const batchResult = batchResults[i];

              if (batchResult.success) {
                allResults.push({
                  success: true,
                  sourceRowId: preparedRow.sourceRowId,
                  destinationRowId: batchResult.destinationRowId,
                  processedFiles: preparedRow.processedFiles
                });
              } else {
                allResults.push({
                  success: false,
                  sourceRowId: preparedRow.sourceRowId,
                  processedFiles: preparedRow.processedFiles,
                  error: batchResult.error
                });
              }

              // Clean up processed files after insertion attempt
              for (const processedFile of preparedRow.processedFiles) {
                this.fileService.cleanupProcessedFile(processedFile);
              }
            }

            console.log(`✅ Batch ${batchIndex + 1} complete: ${batchResults.filter(r => r.success).length}/${batch.length} successful`);

          } catch (error) {
            console.error(`❌ Error inserting batch ${batchIndex + 1}: ${error}`);
            
            // Mark all rows in this batch as failed
            for (const preparedRow of batch) {
              allResults.push({
                success: false,
                sourceRowId: preparedRow.sourceRowId,
                processedFiles: preparedRow.processedFiles,
                error: error instanceof Error ? error.message : String(error)
              });

              // Clean up processed files
              for (const processedFile of preparedRow.processedFiles) {
                this.fileService.cleanupProcessedFile(processedFile);
              }
            }
          }

          // Add delay between batches to respect rate limits
          if (batchIndex < batches.length - 1) {
            console.log('⏸️  Waiting 2 seconds between batches...');
            await this.sleep(2000);
          }
        }
      }

      // Summary
      const successful = allResults.filter(r => r.success).length;
      const failed = allResults.filter(r => !r.success).length;
      const failedResults = allResults.filter(r => !r.success);
      
      console.log('\n📊 Migration Summary:');
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📁 Total files processed: ${allResults.reduce((sum, r) => sum + r.processedFiles.length, 0)}`);

      // Log failed row IDs for easy retry
      if (failedResults.length > 0) {
        console.log('\n❌ Failed Row IDs (for retry):');
        failedResults.forEach((result, index) => {
          console.log(`   ${index + 1}. ${result.sourceRowId} - ${result.error}`);
        });
        
        // Save failed row IDs to a file for easy access
        const failedRowIds = failedResults.map(r => r.sourceRowId);
        const failedRowsData = {
          timestamp: new Date().toISOString(),
          totalFailed: failedResults.length,
          failedRowIds: failedRowIds,
          failedRows: failedResults.map(r => ({
            rowId: r.sourceRowId,
            error: r.error
          }))
        };
        
        const failedRowsPath = path.join(process.cwd(), 'failed-rows.json');
        fs.writeFileSync(failedRowsPath, JSON.stringify(failedRowsData, null, 2));
        console.log(`\n💾 Failed row IDs saved to: ${failedRowsPath}`);
        console.log(`   Use these IDs to retry specific rows if needed.`);
      }

      return allResults;

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    } finally {
      // Clean up temporary and upload files
      this.fileService.cleanupAllDirectories();
    }
  }

  async recover(failedRowsPath?: string): Promise<MigrationResult[]> {
    console.log('\n🔄 Starting recovery process for failed rows...');
    
    // Default to the standard failed rows file
    const failedRowsFile = failedRowsPath || path.join(process.cwd(), 'failed-rows.json');
    
    if (!fs.existsSync(failedRowsFile)) {
      throw new Error(`Failed rows file not found: ${failedRowsFile}`);
    }

    // Read failed rows data
    const failedRowsData = JSON.parse(fs.readFileSync(failedRowsFile, 'utf8'));
    const failedRowIds: string[] = failedRowsData.failedRowIds || [];

    if (failedRowIds.length === 0) {
      console.log('⚠️  No failed rows to recover');
      return [];
    }

    console.log(`📋 Found ${failedRowIds.length} failed rows to retry`);
    console.log(`   Original failure timestamp: ${failedRowsData.timestamp}`);

    try {
      // Test connections first
      await this.testConnections();

      // Get column mappings using configuration
      const columnMappings = await this.tableService.createColumnMapping(
        this.config.sourceDocId,
        this.config.sourceTableId,
        this.config.destinationDocId,
        this.config.destinationTableId,
        this.config
      );

      if (columnMappings.length === 0) {
        throw new Error('No column mappings found. Check your configuration.');
      }

      // Fetch specific failed rows from source table
      console.log(`\n🔍 Fetching ${failedRowIds.length} failed rows from source table...`);
      const sourceRows = await this.tableService.getSpecificRows(
        this.config.sourceDocId,
        this.config.sourceTableId,
        failedRowIds
      );

      if (sourceRows.length === 0) {
        console.log('⚠️  No source rows found for the failed row IDs');
        return [];
      }

      console.log(`✅ Retrieved ${sourceRows.length}/${failedRowIds.length} rows from source table`);

      // Process recovered rows with improved validation
      console.log(`\n🔄 Processing recovered rows with improved data validation...`);
      const preparedRows: PreparedRow[] = [];
      const allResults: MigrationResult[] = [];

      for (let i = 0; i < sourceRows.length; i++) {
        const sourceRow = sourceRows[i];
        console.log(`\n📝 Processing recovered row ${i + 1}/${sourceRows.length} (ID: ${sourceRow.id})`);
        
        try {
          const result = await this.prepareRow(sourceRow, columnMappings);
          preparedRows.push(result);
          console.log(`✅ Row ${i + 1} prepared successfully (ID: ${sourceRow.id})`);
        } catch (error) {
          console.error(`❌ Error preparing row ${i + 1} (ID: ${sourceRow.id}): ${error}`);
          allResults.push({
            success: false,
            sourceRowId: sourceRow.id,
            processedFiles: [],
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // Add delay between processing to avoid rate limits
        if (i < sourceRows.length - 1) {
          console.log('⏸️  Waiting 1 second...');
          await this.sleep(1000);
        }
      }

      // Insert recovered rows in batches
      if (preparedRows.length > 0) {
        console.log(`\n🔄 Inserting ${preparedRows.length} recovered rows in batches...`);
        const batchSize = this.config.insertBatchSize;
        const batches: PreparedRow[][] = [];
        
        for (let i = 0; i < preparedRows.length; i += batchSize) {
          batches.push(preparedRows.slice(i, i + batchSize));
        }

        console.log(`📦 Will process ${batches.length} batches of up to ${batchSize} rows each`);

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          console.log(`\n📝 Inserting batch ${batchIndex + 1}/${batches.length} (${batch.length} rows)...`);

          try {
            const rowDataArray = batch.map(row => row.destinationData);
            
            // Log the data being sent for debugging
            console.log(`🔍 Sample data being sent (first row):`, JSON.stringify(rowDataArray[0], null, 2));
            
            const batchResults = await this.insertRowsBatch(rowDataArray);

            // Map batch results back to individual row results
            for (let i = 0; i < batch.length; i++) {
              const preparedRow = batch[i];
              const batchResult = batchResults[i];

              if (batchResult.success) {
                allResults.push({
                  success: true,
                  sourceRowId: preparedRow.sourceRowId,
                  destinationRowId: batchResult.destinationRowId,
                  processedFiles: preparedRow.processedFiles
                });
              } else {
                allResults.push({
                  success: false,
                  sourceRowId: preparedRow.sourceRowId,
                  processedFiles: preparedRow.processedFiles,
                  error: batchResult.error
                });
              }

              // Clean up processed files after insertion attempt
              for (const processedFile of preparedRow.processedFiles) {
                this.fileService.cleanupProcessedFile(processedFile);
              }
            }

            console.log(`✅ Batch ${batchIndex + 1} processed`);

            // Add delay between batches to respect rate limits
            if (batchIndex < batches.length - 1) {
              console.log('⏸️  Waiting 2 seconds between batches...');
              await this.sleep(2000);
            }
          } catch (error) {
            console.error(`❌ Error inserting batch ${batchIndex + 1}:`, error);
            
            // Mark all rows in this batch as failed
            for (const preparedRow of batch) {
              allResults.push({
                success: false,
                sourceRowId: preparedRow.sourceRowId,
                processedFiles: preparedRow.processedFiles,
                error: error instanceof Error ? error.message : String(error)
              });

              // Clean up processed files on error
              for (const processedFile of preparedRow.processedFiles) {
                this.fileService.cleanupProcessedFile(processedFile);
              }
            }
          }
        }
      }

      // Display recovery results
      const successCount = allResults.filter(r => r.success).length;
      const failureCount = allResults.filter(r => !r.success).length;

      console.log(`\n🎉 Recovery complete!`);
      console.log(`   ✅ Successfully recovered: ${successCount}/${failedRowIds.length} rows`);
      console.log(`   ❌ Still failed: ${failureCount}/${failedRowIds.length} rows`);

      // Save results and any remaining failures
      const recoveryResultsPath = path.join(process.cwd(), 'recovery-results.json');
      fs.writeFileSync(recoveryResultsPath, JSON.stringify(allResults, null, 2));
      console.log(`💾 Recovery results saved to: ${recoveryResultsPath}`);

      // Save still-failed rows for potential future recovery
      const stillFailedResults = allResults.filter(r => !r.success);
      if (stillFailedResults.length > 0) {
        const stillFailedData = {
          timestamp: new Date().toISOString(),
          originalFailureCount: failedRowIds.length,
          recoveredCount: successCount,
          totalStillFailed: stillFailedResults.length,
          failedRowIds: stillFailedResults.map(r => r.sourceRowId),
          failedRows: stillFailedResults.map(r => ({
            rowId: r.sourceRowId,
            error: r.error
          }))
        };
        
        const stillFailedPath = path.join(process.cwd(), 'still-failed-rows.json');
        fs.writeFileSync(stillFailedPath, JSON.stringify(stillFailedData, null, 2));
        console.log(`💾 Still-failed row IDs saved to: ${stillFailedPath}`);
      }

      return allResults;

    } catch (error) {
      console.error('❌ Recovery failed:', error);
      throw error;
    } finally {
      // Clean up temporary and upload files
      this.fileService.cleanupAllDirectories();
    }
  }

  private async testConnections(): Promise<void> {
    console.log('\n🔍 Testing connections...');
    
    // Test Coda API access
    try {
      await this.tableService.getTable(this.config.sourceDocId, this.config.sourceTableId);
      await this.tableService.getTable(this.config.destinationDocId, this.config.destinationTableId);
      console.log('✅ Coda API access verified');
    } catch (error) {
      throw new Error(`Coda API access failed: ${error}`);
    }

    // Test DigitalOcean Spaces access
    const spacesConnected = await this.storageService.testConnection();
    if (!spacesConnected) {
      throw new Error('DigitalOcean Spaces connection failed');
    }
  }

  private async prepareRow(sourceRow: any, columnMappings: ColumnMapping[]): Promise<PreparedRow> {
    const processedFiles: ProcessedFile[] = [];

    // Check if this row has "Record file" attachments that need special handling
    const attachmentColumnMapping = columnMappings.find(m => 
      m.sourceColumn.name === 'Record file' && 
      m.destinationColumn.name === 'Receipt'
    );

    if (attachmentColumnMapping) {
      const attachments = this.extractAttachmentsFromColumn(sourceRow, attachmentColumnMapping.sourceColumn.id);
      if (attachments.length > 0) {
        const processedFile = await this.processRowAttachments(sourceRow, attachments);
        if (processedFile) {
          processedFiles.push(processedFile);
        }
      }
    }

    // Prepare row data for destination table
    const destinationData = await this.mapRowData(sourceRow, columnMappings, processedFiles);

    return {
      sourceRowId: sourceRow.id,
      destinationData,
      processedFiles
    };
  }

  private async processRow(sourceRow: any, columnMappings: ColumnMapping[]): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      sourceRowId: sourceRow.id,
      processedFiles: [],
      error: undefined
    };

    try {
      // Check if this row has "Record file" attachments that need special handling
      const attachmentColumnMapping = columnMappings.find(m => 
        m.sourceColumn.name === 'Record file' && 
        m.destinationColumn.name === 'Receipt'
      );

      if (attachmentColumnMapping) {
        const attachments = this.extractAttachmentsFromColumn(sourceRow, attachmentColumnMapping.sourceColumn.id);
        if (attachments.length > 0) {
          const processedFile = await this.processRowAttachments(sourceRow, attachments);
          if (processedFile) {
            result.processedFiles.push(processedFile);
          }
        }
      }

      // Prepare row data for destination table
      const destinationRowData = await this.mapRowData(sourceRow, columnMappings, result.processedFiles);

      // Insert row into destination table
      const destinationRowId = await this.insertRow(destinationRowData);
      result.destinationRowId = destinationRowId;
      result.success = true;

      // Clean up processed files after successful upload
      for (const processedFile of result.processedFiles) {
        this.fileService.cleanupProcessedFile(processedFile);
      }

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      
      // Clean up processed files on error
      for (const processedFile of result.processedFiles) {
        this.fileService.cleanupProcessedFile(processedFile);
      }
      
      return result;
    }
  }

  private extractAttachmentsFromColumn(row: any, columnId: string): any[] {
    const value = row.values[columnId];
    
    if (Array.isArray(value)) {
      // Check if this looks like an attachments array
      return value.filter((item: any) => 
        item && typeof item === 'object' && item.url && item.name
      );
    }
    
    return [];
  }

  private async processRowAttachments(row: any, attachments: any[]): Promise<ProcessedFile | null> {
    // Use the first attachment's name as the base filename, or fall back to row name/ID
    const baseFileName = this.getBaseFileName(row, attachments);
    
    // Process attachments (download, convert to PDF, merge)
    const processedFile = await this.fileService.processAttachments(attachments, baseFileName);
    
    if (processedFile) {
      // Upload to DigitalOcean Spaces
      const uploadedUrl = await this.storageService.uploadFile(
        processedFile.pdfPath,
        `${processedFile.originalName}.pdf`
      );
      
      processedFile.uploadedUrl = uploadedUrl;
    }

    return processedFile;
  }

  private getBaseFileName(row: any, attachments: any[]): string {
    // Try to get a meaningful filename from the first attachment
    if (attachments.length > 0 && attachments[0].name) {
      const fileName = attachments[0].name;
      const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      return baseName.replace(/[^a-zA-Z0-9_-]/g, '_'); // Sanitize filename
    }

    // Fall back to row name or ID
    if (row.name) {
      return String(row.name).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    return `row_${row.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  private async mapRowData(
    sourceRow: any, 
    columnMappings: ColumnMapping[], 
    processedFiles: ProcessedFile[]
  ): Promise<Record<string, any>> {
    const destinationData: Record<string, any> = {};

    for (const mapping of columnMappings) {
      const sourceValue = sourceRow.values[mapping.sourceColumn.id];
      
      // Handle special case for "Record file" → "Receipt" mapping
      if (mapping.sourceColumn.name === 'Record file' && mapping.destinationColumn.name === 'Receipt') {
        // Replace with the uploaded file URL if we have one
        if (processedFiles.length > 0) {
          destinationData[mapping.destinationColumn.id] = processedFiles[0].uploadedUrl;
        }
        continue;
      }

      let destinationValue = sourceValue;

      // Apply transformation if needed
      if (mapping.transform && sourceValue !== null && sourceValue !== undefined) {
        destinationValue = mapping.transform(sourceValue);
      }

      // Sanitize the value to ensure it's a valid Coda API value
      destinationValue = this.sanitizeValue(destinationValue);

      if (destinationValue !== undefined && destinationValue !== null) {
        destinationData[mapping.destinationColumn.id] = destinationValue;
      }
    }

    return destinationData;
  }

  /**
   * Sanitizes a value to ensure it's compatible with Coda API requirements.
   * The Coda API only accepts: boolean, number, string, or array thereof.
   */
  private sanitizeValue(value: any): any {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return null;
    }

    // Handle primitives that are already valid
    if (typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }

    // Handle strings (including cleaning backticks)
    if (typeof value === 'string') {
      return this.cleanBackticks(value);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeValue(item)).filter(item => item !== null && item !== undefined);
    }

    // Handle objects - extract meaningful values based on Coda types
    if (typeof value === 'object') {
      // Handle specific Coda object types
      if (value['@type'] === 'MonetaryAmount') {
        return typeof value.amount === 'number' ? value.amount : 0;
      } 
      
      if (value['@type'] === 'StructuredValue') {
        return value.name || value.url || value.displayText || String(value);
      } 
      
      if (value['@type'] === 'Person') {
        return value.email || value.name || String(value);
      }

      // Handle ImageObject arrays (like attachments)
      if (value['@type'] === 'ImageObject') {
        return value.url || value.name || String(value);
      }

      // Handle Date objects
      if (value instanceof Date) {
        return value.toISOString();
      }

      // Handle other objects - try to extract a meaningful string representation
      if (value.name) {
        return String(value.name);
      }
      
      if (value.url) {
        return String(value.url);
      }
      
      if (value.displayText) {
        return String(value.displayText);
      }

      if (value.text) {
        return String(value.text);
      }

      // For any other object, convert to string but log a warning
      console.warn(`⚠️  Converting unknown object type to string: ${JSON.stringify(value).substring(0, 100)}...`);
      return String(value);
    }

    // For any other type, convert to string
    return String(value);
  }

  private async insertRow(rowData: Record<string, any>): Promise<string> {
    const results = await this.insertRowsBatch([rowData]);
    if (results.length > 0 && results[0].success && results[0].destinationRowId) {
      return results[0].destinationRowId;
    }
    throw new Error(results[0]?.error || 'No row ID returned from insert operation');
  }

  private async insertRowsBatch(rowDataArray: Record<string, any>[]): Promise<Array<{ success: boolean; destinationRowId?: string; error?: string }>> {
    if (rowDataArray.length === 0) {
      return [];
    }

    console.log(`📝 Inserting batch of ${rowDataArray.length} rows...`);

    const url = `https://coda.io/apis/v1/docs/${this.config.destinationDocId}/tables/${this.config.destinationTableId}/rows`;
    
    const payload = {
      rows: rowDataArray.map(rowData => ({
        cells: Object.entries(rowData).map(([columnId, value]) => ({
          column: columnId,
          value: value
        }))
      }))
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = `Failed to insert batch: HTTP ${response.status}: ${response.statusText}\nResponse: ${errorText}`;
        
        // If batch fails, return failure for all rows
        return rowDataArray.map(() => ({ success: false, error }));
      }

      const result = await response.json();
      
      // The API returns the created row IDs
      if (result.addedRowIds && result.addedRowIds.length > 0) {
        console.log(`✅ Batch inserted successfully: ${result.addedRowIds.length} rows`);
        
        // Map each row ID to a success result
        return result.addedRowIds.map((rowId: string) => ({
          success: true,
          destinationRowId: rowId
        }));
      }

      // If no row IDs returned, mark all as failed
      return rowDataArray.map(() => ({ 
        success: false, 
        error: 'No row IDs returned from batch insert operation' 
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return rowDataArray.map(() => ({ success: false, error: errorMessage }));
    }
  }

  private cleanBackticks(value: string): string {
    // Remove triple backticks from the beginning and end of strings
    // This handles cases like "```Needs Review```" -> "Needs Review"
    return value.replace(/^```|```$/g, '').trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 