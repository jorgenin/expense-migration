import { S3Client, PutObjectCommand, PutObjectCommandInput } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { MigrationConfig } from './types';

export class StorageService {
  private s3Client: S3Client;
  private config: MigrationConfig['digitalOceanSpaces'];
  private migrationFolder: string;

  constructor(config: MigrationConfig['digitalOceanSpaces'], migrationFolder: string) {
    this.config = config;
    this.migrationFolder = migrationFolder;

    const s3endpoint = "https://" + config.endpoint.replace("https://", "")
    
    this.s3Client = new S3Client({
      endpoint: s3endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true, // Required for DigitalOcean Spaces
    });
  }

  async uploadFile(filePath: string, fileName: string): Promise<string> {
    console.log(`☁️  Uploading file to DigitalOcean Spaces: ${fileName}`);
    
    try {
      const fileContent = fs.readFileSync(filePath);
      const key = `${this.migrationFolder}/${fileName}`;
      
      const uploadParams: PutObjectCommandInput = {
        Bucket: this.config.bucket,
        Key: key,
        Body: fileContent,
        ContentType: this.getContentType(fileName),
        ACL: 'public-read', // Make files publicly accessible
      };

      const command = new PutObjectCommand(uploadParams);
      await this.s3Client.send(command);

      // Construct the public URL
      const publicUrl = this.constructPublicUrl(key);
      console.log(`✅ File uploaded successfully: ${publicUrl}`);
      
      return publicUrl;
    } catch (error) {
      console.error(`❌ Error uploading file: ${error}`);
      throw new Error(`Failed to upload file: ${error}`);
    }
  }

  private getContentType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    
    const contentTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };

    return contentTypes[ext] || 'application/octet-stream';
  }

  private constructPublicUrl(key: string): string {
    // For DigitalOcean Spaces, the URL format is:
    // https://<bucket-name>.<region>.digitaloceanspaces.com/<key>
    // or if using a custom endpoint, it might be different
    
    const baseUrl = this.config.endpoint.replace('https://', '');
    return `https://${this.config.bucket}.${baseUrl}/${key}`;
  }

  async testConnection(): Promise<boolean> {
    console.log('🔍 Testing DigitalOcean Spaces connection...');
    
    try {
      // Try to upload a small test file
      const testContent = 'Test connection file';
      const testKey = `${this.migrationFolder}/connection-test-${Date.now()}.txt`;
      
      const uploadParams: PutObjectCommandInput = {
        Bucket: this.config.bucket,
        Key: testKey,
        Body: testContent,
        ContentType: 'text/plain',
      };

      const command = new PutObjectCommand(uploadParams);
      await this.s3Client.send(command);
      
      console.log('✅ DigitalOcean Spaces connection successful');
      
      // Optionally delete the test file
      // await this.deleteFile(testKey);
      
      return true;
    } catch (error) {
      console.error(`❌ DigitalOcean Spaces connection failed: ${error}`);
      return false;
    }
  }

  // Helper method to delete files if needed
  async deleteFile(key: string): Promise<void> {
    try {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      
      await this.s3Client.send(command);
      console.log(`🗑️  Deleted file: ${key}`);
    } catch (error) {
      console.warn(`⚠️  Could not delete file ${key}: ${error}`);
    }
  }

  // Method to list files in the migration folder
  async listFiles(prefix?: string): Promise<string[]> {
    try {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const listPrefix = prefix ? `${this.migrationFolder}/${prefix}` : this.migrationFolder;
      
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: listPrefix,
      });

      const response = await this.s3Client.send(command);
      const files = response.Contents?.map(obj => obj.Key!) || [];
      
      console.log(`📁 Found ${files.length} files in ${listPrefix}`);
      return files;
    } catch (error) {
      console.error(`❌ Error listing files: ${error}`);
      throw error;
    }
  }

  // Method to get file URL for existing files
  getFileUrl(fileName: string): string {
    const key = `${this.migrationFolder}/${fileName}`;
    return this.constructPublicUrl(key);
  }
} 