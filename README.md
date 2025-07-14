# Coda Expense Migration Tool

A comprehensive migration tool for copying expense data between Coda tables with automated file processing and cloud storage integration.

## Features

- 🔄 **Table Migration**: Copy rows between Coda tables with intelligent column mapping
- 📎 **File Processing**: Download attachments, convert to PDF, and merge multiple files
- ☁️ **Cloud Storage**: Upload processed files to DigitalOcean Spaces (S3-compatible)
- 🔍 **Data Analysis**: Analyze expense data with summaries and statistics
- 🛡️ **Type Safety**: Full TypeScript support with comprehensive error handling

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the project root:

```env
# Coda API Configuration
CODA_API_TOKEN=your_coda_api_token_here

# DigitalOcean Spaces Configuration
DO_SPACES_BUCKET=your_bucket_name
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_KEY=your_spaces_access_key
DO_SPACES_SECRET=your_spaces_secret_key
```

### 3. Run Migration

```bash
# Analyze existing expense data
pnpm run analyze

# Run migration (first 10 rows)
pnpm run migrate
```

## How It Works

### Migration Process

1. **Connection Testing**: Verifies access to Coda API and DigitalOcean Spaces
2. **Schema Analysis**: Fetches column information from source and destination tables
3. **Column Mapping**: Creates intelligent mappings between tables based on column names
4. **Row Processing**: For each row:
   - Downloads attachment files
   - Converts images/documents to PDF
   - Merges multiple PDFs if needed
   - Uploads to DigitalOcean Spaces
   - Creates new row in destination table with mapped data

### File Processing Pipeline

```
Attachments → Download → Convert to PDF → Merge PDFs → Upload to S3 → Update Row Data
```

Supported file types:
- **Images**: JPG, PNG, GIF, BMP, WebP (converted to PDF)
- **PDFs**: Merged if multiple files
- **Other**: Placeholder PDF created with file information

## Configuration

The migration is configured in `src/index.ts`:

```typescript
const migrationConfig: MigrationConfig = {
  sourceDocId: 'c3f76sgO8s',
  sourceTableId: 'grid-a3EoctjUSV',
  destinationDocId: 'c3f76sgO8s',
  destinationTableId: 'grid-LmSjYH3tPB',
  digitalOceanSpaces: {
    bucket: process.env.DO_SPACES_BUCKET!,
    endpoint: process.env.DO_SPACES_ENDPOINT!,
    accessKey: process.env.DO_SPACES_KEY!,
    secretKey: process.env.DO_SPACES_SECRET!,
    region: 'nyc3'
  },
  migrationFolder: 'Migration',
  batchSize: 10
};
```

## Project Structure

```
src/
├── index.ts              # Main entry point with CLI interface
├── types.ts              # TypeScript type definitions
├── table-service.ts      # Coda API table operations
├── file-service.ts       # File download and PDF processing
├── storage-service.ts    # DigitalOcean Spaces upload
└── migration-service.ts  # Main migration orchestration
```

## CLI Commands

```bash
# Show help and usage information
pnpm run dev

# Analyze existing expense data
pnpm run analyze
pnpm run dev -- --analyze

# Run migration process
pnpm run migrate
pnpm run dev -- --migrate
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CODA_API_TOKEN` | Your Coda API token | ✅ |
| `DO_SPACES_BUCKET` | DigitalOcean Spaces bucket name | ✅ |
| `DO_SPACES_ENDPOINT` | Spaces endpoint URL | ✅ |
| `DO_SPACES_KEY` | Spaces access key | ✅ |
| `DO_SPACES_SECRET` | Spaces secret key | ✅ |
| `DO_SPACES_REGION` | Region (defaults to nyc3) | ❌ |

## Output Files

- `coda-response-raw.json` - Raw API response from source table
- `coda-expenses-parsed.json` - Parsed expense data with type safety
- `migration-results.json` - Detailed migration results and status

## Error Handling

The tool includes comprehensive error handling:
- ✅ Connection validation before migration
- ✅ Individual row error isolation
- ✅ Detailed error reporting
- ✅ Automatic cleanup of temporary files
- ✅ Graceful degradation for unsupported file types

## Development

```bash
# Build TypeScript
pnpm run build

# Run compiled version
pnpm run start

# Development with hot reload
pnpm run dev
```

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues related to:
- **Coda API**: Check the [Coda API documentation](https://coda.io/developers/apis/v1)
- **DigitalOcean Spaces**: See [Spaces documentation](https://docs.digitalocean.com/products/spaces/)
- **This tool**: Open an issue in this repository 