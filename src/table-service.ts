import { CodaTable, CodaColumn, ColumnMapping, MigrationConfig } from './types';

export class TableService {
  private bearerToken: string;
  private baseUrl = 'https://coda.io/apis/v1';

  constructor(token: string) {
    this.bearerToken = token;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText}\nResponse: ${errorText}`);
    }

    return response.json();
  }

  async getTable(docId: string, tableId: string): Promise<CodaTable> {
    console.log(`🔍 Fetching table info for ${tableId}...`);
    const table = await this.request<CodaTable>(`/docs/${docId}/tables/${tableId}`);
    console.log(`✅ Retrieved table: ${table.name} (${table.rowCount} rows)`);
    return table;
  }

  async getTableColumns(docId: string, tableId: string): Promise<CodaColumn[]> {
    console.log(`🔍 Fetching columns for table ${tableId}...`);
    const response = await this.request<{ items: CodaColumn[] }>(`/docs/${docId}/tables/${tableId}/columns`);
    console.log(`✅ Retrieved ${response.items.length} columns`);
    
    // Sort columns by display column first, then by name
    return response.items.sort((a, b) => {
      if (a.display && !b.display) return -1;
      if (!a.display && b.display) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async createColumnMapping(
    sourceDocId: string, 
    sourceTableId: string, 
    destDocId: string, 
    destTableId: string,
    config: MigrationConfig
  ): Promise<ColumnMapping[]> {
    console.log('\n🔄 Creating column mapping using configuration...');
    
    const [sourceColumns, destColumns] = await Promise.all([
      this.getTableColumns(sourceDocId, sourceTableId),
      this.getTableColumns(destDocId, destTableId)
    ]);

    console.log('\n📊 Source table columns:');
    sourceColumns.forEach(col => {
      console.log(`   - ${col.name} (${col.id}) [${col.format.type}]${col.display ? ' *DISPLAY*' : ''}`);
    });

    console.log('\n📊 Destination table columns:');
    destColumns.forEach(col => {
      console.log(`   - ${col.name} (${col.id}) [${col.format.type}]${col.display ? ' *DISPLAY*' : ''}`);
    });

    console.log('\n🗺️  Applying column mappings from configuration...');

    // Create mapping based on configuration
    const mappings: ColumnMapping[] = [];
    
    for (const sourceCol of sourceColumns) {
      // Skip calculated columns as they can't be set directly
      if (sourceCol.calculated) {
        console.log(`   ⚠️  Skipping calculated column: ${sourceCol.name}`);
        continue;
      }

      // Check if this column should be skipped
      if (config.skipColumns.includes(sourceCol.name)) {
        console.log(`   ⏭️  Skipping configured skip column: ${sourceCol.name}`);
        continue;
      }

      // Get the mapped destination column name from config
      const destColumnName = config.columnMappings[sourceCol.name];
      
      if (!destColumnName) {
        console.log(`   ❌ No mapping configured for: ${sourceCol.name}`);
        continue;
      }

      // Find the destination column by name
      const destCol = destColumns.find(dc => 
        dc.name === destColumnName && !dc.calculated
      );

      if (destCol) {
        const transform = this.createTransform(sourceCol, destCol, config);
        mappings.push({
          sourceColumn: sourceCol,
          destinationColumn: destCol,
          transform
        });
        console.log(`   ✅ Mapped: "${sourceCol.name}" → "${destCol.name}"`);
        
        // Show transformation info if applicable
        const transformation = config.transformations?.[sourceCol.name];
        if (transformation) {
          console.log(`      🔄 Transformation: ${transformation.from} → ${transformation.to}`);
        }
      } else {
        console.log(`   ❌ Destination column not found: "${destColumnName}" (mapped from "${sourceCol.name}")`);
      }
    }

    console.log(`\n📋 Created ${mappings.length} column mappings from configuration`);
    return mappings;
  }

  private createTransform(sourceCol: CodaColumn, destCol: CodaColumn, config: MigrationConfig): ((value: any) => any) | undefined {
    // Check if there's a specific transformation configured for this column
    const transformation = config.transformations?.[sourceCol.name];
    
    if (transformation) {
      console.log(`   🔄 Applying configured transformation for ${sourceCol.name}: ${transformation.from} → ${transformation.to}`);
      
      return (value: any) => {
        // Apply specific transformations based on the configuration
        if (transformation.from === 'select' && transformation.to === 'lookup') {
          // Convert select value to lookup format if needed
          if (value && typeof value === 'string') {
            return value; // For now, just pass the string value
          }
        }
        return value;
      };
    }

    // Handle automatic type conversions if column types differ
    if (sourceCol.format.type !== destCol.format.type) {
      console.log(`   🔄 Auto type conversion: ${sourceCol.format.type} → ${destCol.format.type}`);
      
      return (value: any) => {
        // Add specific type conversions as needed
        if (destCol.format.type === 'text' && value !== null && value !== undefined) {
          return String(value);
        }
        if (destCol.format.type === 'link' && typeof value === 'string') {
          return value; // Links expect URL strings
        }
        return value;
      };
    }
    
    return undefined; // No transformation needed
  }

  async getTableRows(docId: string, tableId: string, limit: number = 10, pageToken?: string): Promise<{ items: any[], nextPageToken?: string }> {
    let url = `/docs/${docId}/tables/${tableId}/rows?limit=${limit}&valueFormat=rich`;
    
    if (pageToken) {
      // When using pageToken, we don't need other parameters as they're implied
      url = `/docs/${docId}/tables/${tableId}/rows?pageToken=${pageToken}`;
      console.log(`🔍 Fetching next page of rows from table ${tableId}...`);
    } else {
      console.log(`🔍 Fetching ${limit} rows from table ${tableId}...`);
    }
    
    const response = await this.request<{ items: any[], nextPageToken?: string }>(url);
    console.log(`✅ Retrieved ${response.items.length} rows`);
    
    return {
      items: response.items,
      nextPageToken: response.nextPageToken
    };
  }

  async getAllTableRows(docId: string, tableId: string, batchSize: number = 100): Promise<any[]> {
    console.log(`🔍 Fetching all rows from table ${tableId} in batches of ${batchSize}...`);
    
    const allRows: any[] = [];
    let pageToken: string | undefined;
    let batchNumber = 1;
    
    do {
      console.log(`📦 Fetching batch ${batchNumber}...`);
      const response = await this.getTableRows(docId, tableId, batchSize, pageToken);
      
      allRows.push(...response.items);
      pageToken = response.nextPageToken;
      
      console.log(`   📋 Batch ${batchNumber}: ${response.items.length} rows (total: ${allRows.length})`);
      
      if (pageToken) {
        console.log(`   ⏸️  Waiting 1 second before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      batchNumber++;
    } while (pageToken);
    
    console.log(`✅ Retrieved all ${allRows.length} rows from table ${tableId}`);
    return allRows;
  }

  async getSpecificRows(docId: string, tableId: string, rowIds: string[]): Promise<any[]> {
    console.log(`🔍 Fetching ${rowIds.length} specific rows from table ${tableId}...`);
    
    const rows: any[] = [];
    const batchSize = 20; // Fetch rows in batches to avoid URL length limits

    for (let i = 0; i < rowIds.length; i += batchSize) {
      const batchIds = rowIds.slice(i, i + batchSize);
      console.log(`   Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rowIds.length / batchSize)} (${batchIds.length} rows)`);

      try {
        // Construct URL with specific row IDs - use comma-separated format
        const baseUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/rows`;
        const params = new URLSearchParams();
        params.append('valueFormat', 'rich');
        
        // Use comma-separated row IDs in a single parameter
        params.append('rowIds', batchIds.join(','));
        
        const url = `${baseUrl}?${params.toString()}`;
        console.log(`   Request URL: ${url}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          console.warn(`⚠️  Failed to fetch batch starting at index ${i}: HTTP ${response.status}`);
          const errorText = await response.text();
          console.warn(`     Error: ${errorText}`);
          continue;
        }

        const result = await response.json();
        if (result.items && Array.isArray(result.items)) {
          // Filter the results to only include rows we actually requested
          const filteredItems = result.items.filter((item: any) => batchIds.includes(item.id));
          rows.push(...filteredItems);
          console.log(`   ✅ Fetched ${result.items.length} rows in this batch`);
          if (filteredItems.length !== result.items.length) {
            console.log(`   🔍 Filtered to ${filteredItems.length} matching rows (API returned ${result.items.length})`);
          }
        } else {
          console.warn(`   ⚠️  No items returned in batch`);
        }

        // Rate limiting - wait between batches
        if (i + batchSize < rowIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.warn(`⚠️  Error fetching batch starting at index ${i}:`, error);
        continue;
      }
    }

    console.log(`✅ Total rows fetched and filtered: ${rows.length}/${rowIds.length}`);
    return rows;
  }
} 