// Base response structure from Coda API
export interface CodaResponse {
  items: ExpenseItem[];
  href: string;
  nextPageToken?: string;
  nextPageLink?: string;
}

// Individual expense item structure
export interface ExpenseItem {
  id: string;
  type: 'row';
  href: string;
  name: string;
  index: number;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  browserLink: string;
  values: ExpenseValues;
}

// The values object contains all the actual expense data
// Column IDs map to different types of values
export interface ExpenseValues {
  [columnId: string]: ExpenseValue;
}

// Union type for all possible value types in the response
export type ExpenseValue = 
  | string 
  | number 
  | boolean 
  | MonetaryAmount 
  | StructuredValue 
  | Person 
  | ImageObject[] 
  | null 
  | undefined;

// Schema.org MonetaryAmount for expense amounts
export interface MonetaryAmount {
  '@context': 'http://schema.org/';
  '@type': 'MonetaryAmount';
  currency: string; // e.g., "USD"
  amount: number;
}

// Schema.org StructuredValue for references to other tables/rows
export interface StructuredValue {
  '@context': 'http://schema.org/';
  '@type': 'StructuredValue';
  additionalType: 'row';
  name: string;
  url: string;
  tableId: string;
  rowId: string;
  tableUrl: string;
}

// Schema.org Person for user references
export interface Person {
  '@context': 'http://schema.org/';
  '@type': 'Person';
  name: string;
  email: string;
  userId: number;
}

// Schema.org ImageObject for file attachments
export interface ImageObject {
  '@context': 'http://schema.org/';
  '@type': 'ImageObject';
  name: string;
  height: string | number;
  width: string | number;
  url: string;
  status: 'live' | string;
}

// Known column mappings based on the response data
// These are the actual column IDs used in the Coda table
export interface ExpenseColumnIds {
  // Core expense fields
  expenseNumber: 'c-QPY7dCGzDR'; // number
  date: 'c-qJJLLQm4hB'; // date string
  invoiceNumber: 'c-Q0VwUeBTp7'; // string
  vendor: 'c-HpY-IP2Bsf'; // string (markdown)
  description: 'c-KG-X0Wtd7O'; // string (markdown)
  amount: 'c-xkct2Gfm3m'; // MonetaryAmount
  paymentMethod: 'c-QmLhAwskad'; // StructuredValue
  attachments: 'c-fqeHMDI4Jz'; // ImageObject[]
  notes: 'c-diEIDBx3Q8'; // string (markdown)
  submittedBy: 'c-ABZk8QPuyJ'; // Person
  status: 'c-GdWGYgbXUQ'; // string (markdown)
  reimbursementDate: 'c-YtWi0gLL2R'; // string
  approvedDate: 'c-GVZLR75AzE'; // date string
  reviewStatus: 'c-3fsduRRcDa'; // string (markdown)
  approvalNotes: 'c-8nf2AIHEVb'; // string
  taxable: 'c-4XC8xajLxD'; // boolean
  billable: 'c-YATlzihPJl'; // boolean
  
  // Categorization fields
  accountCode: 'c-nGivd_Wwok'; // StructuredValue
  department: 'c-ar6LAmC25g'; // string (markdown)
  project: 'c-gvVr96043C'; // StructuredValue
  phase: 'c-pZWcMwAwtr'; // StructuredValue
  task: 'c-sEyxHTSfE5'; // StructuredValue
  
  // System fields
  synced: 'c-3xuWzWm7Dk'; // boolean
  lastSyncDate: 'c-8X8igz51Xs'; // date string
}

// Type-safe helper to extract specific field values
export type ExpenseFieldValue<T extends keyof ExpenseColumnIds> = 
  T extends 'expenseNumber' ? number :
  T extends 'date' | 'approvedDate' | 'lastSyncDate' ? string :
  T extends 'amount' ? MonetaryAmount :
  T extends 'paymentMethod' | 'accountCode' | 'project' | 'phase' | 'task' ? StructuredValue :
  T extends 'attachments' ? ImageObject[] :
  T extends 'submittedBy' ? Person :
  T extends 'taxable' | 'billable' | 'synced' ? boolean :
  string;

// Utility type for parsed expense with known field names
export interface ParsedExpense {
  // Metadata
  id: string;
  name: string;
  index: number;
  createdAt: Date;
  updatedAt: Date;
  browserLink: string;
  
  // Core expense data
  expenseNumber?: number;
  date?: Date;
  invoiceNumber?: string;
  vendor?: string;
  description?: string;
  amount?: MonetaryAmount;
  paymentMethod?: StructuredValue;
  attachments?: ImageObject[];
  notes?: string;
  submittedBy?: Person;
  status?: string;
  reimbursementDate?: string;
  approvedDate?: Date;
  reviewStatus?: string;
  approvalNotes?: string;
  taxable?: boolean;
  billable?: boolean;
  
  // Categorization
  accountCode?: StructuredValue;
  department?: string;
  project?: StructuredValue;
  phase?: StructuredValue;
  task?: StructuredValue;
  
  // System
  synced?: boolean;
  lastSyncDate?: Date;
  
  // Raw values for any unmapped fields
  rawValues: ExpenseValues;
}

// Helper function to clean markdown strings (remove triple backticks)
export function cleanMarkdown(text: string | undefined): string | undefined {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/^```|```$/g, '').trim();
}

// Helper function to parse date strings safely
export function parseDate(dateString: string | undefined): Date | undefined {
  if (!dateString || typeof dateString !== 'string') return undefined;
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? undefined : date;
}

// Helper function to parse an expense item into a more usable format
export function parseExpense(item: ExpenseItem): ParsedExpense {
  const values = item.values;
  
  return {
    // Metadata
    id: item.id,
    name: item.name,
    index: item.index,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    browserLink: item.browserLink,
    
    // Core expense data
    expenseNumber: values['c-QPY7dCGzDR'] as number,
    date: parseDate(values['c-qJJLLQm4hB'] as string),
    invoiceNumber: cleanMarkdown(values['c-Q0VwUeBTp7'] as string),
    vendor: cleanMarkdown(values['c-HpY-IP2Bsf'] as string),
    description: cleanMarkdown(values['c-KG-X0Wtd7O'] as string),
    amount: values['c-xkct2Gfm3m'] as MonetaryAmount,
    paymentMethod: values['c-QmLhAwskad'] as StructuredValue,
    attachments: values['c-fqeHMDI4Jz'] as ImageObject[],
    notes: cleanMarkdown(values['c-diEIDBx3Q8'] as string),
    submittedBy: values['c-ABZk8QPuyJ'] as Person,
    status: cleanMarkdown(values['c-GdWGYgbXUQ'] as string),
    reimbursementDate: values['c-YtWi0gLL2R'] as string,
    approvedDate: parseDate(values['c-GVZLR75AzE'] as string),
    reviewStatus: cleanMarkdown(values['c-3fsduRRcDa'] as string),
    approvalNotes: values['c-8nf2AIHEVb'] as string,
    taxable: values['c-4XC8xajLxD'] as boolean,
    billable: values['c-YATlzihPJl'] as boolean,
    
    // Categorization
    accountCode: values['c-nGivd_Wwok'] as StructuredValue,
    department: cleanMarkdown(values['c-ar6LAmC25g'] as string),
    project: values['c-gvVr96043C'] as StructuredValue,
    phase: values['c-pZWcMwAwtr'] as StructuredValue,
    task: values['c-sEyxHTSfE5'] as StructuredValue,
    
    // System
    synced: values['c-3xuWzWm7Dk'] as boolean,
    lastSyncDate: parseDate(values['c-8X8igz51Xs'] as string),
    
    // Keep raw values for any unmapped fields
    rawValues: values
  };
} 

// Migration specific types
export interface CodaTable {
  id: string;
  name: string;
  href: string;
  browserLink: string;
  displayColumn: {
    id: string;
    type: string;
    href: string;
  };
  rowCount: number;
  layout: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodaColumn {
  id: string;
  name: string;
  href: string;
  display: boolean;
  calculated: boolean;
  formula?: string;
  defaultValue?: string;
  format: {
    type: string;
    isArray?: boolean;
    [key: string]: any;
  };
}

export interface ColumnMapping {
  sourceColumn: CodaColumn;
  destinationColumn: CodaColumn;
  transform?: (value: any) => any;
}

// YAML Configuration Types
export interface YamlMigrationConfig {
  migration: {
    source: {
      docId: string;
      tableId: string;
    };
    destination: {
      docId: string;
      tableId: string;
    };
    settings: {
      batchSize: number;
      insertBatchSize: number;
      migrationFolder: string;
    };
    columnMappings: Record<string, string>;
    skipColumns: string[];
    transformations?: Record<string, {
      from: string;
      to: string;
    }>;
    fileProcessing: {
      supportedImageTypes: string[];
      supportedDocTypes: string[];
      defaultQuality: number;
      createPlaceholderForUnsupported: boolean;
    };
  };
}

export interface MigrationConfig {
  sourceDocId: string;
  sourceTableId: string;
  destinationDocId: string;
  destinationTableId: string;
  digitalOceanSpaces: {
    bucket: string;
    endpoint: string;
    accessKey: string;
    secretKey: string;
    region?: string;
  };
  migrationFolder: string;
  batchSize: number;
  insertBatchSize: number;
  columnMappings: Record<string, string>;
  skipColumns: string[];
  transformations?: Record<string, {
    from: string;
    to: string;
  }>;
  fileProcessing: {
    supportedImageTypes: string[];
    supportedDocTypes: string[];
    defaultQuality: number;
    createPlaceholderForUnsupported: boolean;
  };
}

export interface ProcessedFile {
  originalName: string;
  pdfPath: string;
  uploadedUrl: string;
}

export interface MigrationResult {
  success: boolean;
  sourceRowId: string;
  destinationRowId?: string;
  processedFiles: ProcessedFile[];
  error?: string;
} 