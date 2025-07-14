import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { ProcessedFile } from './types';

export class FileService {
  private tempDir: string;
  private uploadDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp');
    this.uploadDir = path.join(process.cwd(), 'upload');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async downloadFile(url: string, filename: string): Promise<string> {
    console.log(`⬇️  Downloading file: ${filename}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filepath = path.join(this.tempDir, filename);
    
    fs.writeFileSync(filepath, buffer);
    console.log(`✅ Downloaded: ${filepath}`);
    
    return filepath;
  }

  async convertToPdf(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    const outputPath = path.join(this.tempDir, `${basename}.pdf`);

    console.log(`🔄 Converting ${filePath} to PDF...`);

    if (ext === '.pdf') {
      // Already a PDF - if the output path is the same as input, just return it
      if (filePath === outputPath) {
        console.log(`✅ File was already PDF: ${outputPath}`);
        return outputPath;
      } else {
        // Copy to new location
        fs.copyFileSync(filePath, outputPath);
        console.log(`✅ File was already PDF, copied to: ${outputPath}`);
        return outputPath;
      }
    }

    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
      // Convert image to PDF
      await this.imageToPdf(filePath, outputPath);
      console.log(`✅ Converted image to PDF: ${outputPath}`);
      return outputPath;
    }

    // For other file types, we'll create a simple PDF with the filename
    // In a real implementation, you might want to use other conversion tools
    await this.createPlaceholderPdf(filePath, outputPath);
    console.log(`✅ Created placeholder PDF for: ${outputPath}`);
    return outputPath;
  }

  private async imageToPdf(imagePath: string, outputPath: string): Promise<void> {
    try {
      // Convert image to high-quality JPEG first
      const jpegBuffer = await sharp(imagePath)
        .jpeg({ quality: 90 })
        .toBuffer();

      // Create PDF and embed the image
      const pdfDoc = await PDFDocument.create();
      const jpegImage = await pdfDoc.embedJpg(jpegBuffer);
      
      // Get image dimensions and create appropriate page size
      const { width, height } = jpegImage;
      const page = pdfDoc.addPage([width, height]);
      
      page.drawImage(jpegImage, {
        x: 0,
        y: 0,
        width,
        height,
      });

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, pdfBytes);
    } catch (error) {
      console.error(`❌ Error converting image to PDF: ${error}`);
      throw error;
    }
  }

  private async createPlaceholderPdf(originalPath: string, outputPath: string): Promise<void> {
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();

      // Add text indicating the original file
      const fileName = path.basename(originalPath);
      const fontSize = 12;
      
      page.drawText(`Original file: ${fileName}`, {
        x: 50,
        y: height - 100,
        size: fontSize,
      });

      page.drawText(`File type: ${path.extname(originalPath).toUpperCase()}`, {
        x: 50,
        y: height - 130,
        size: fontSize,
      });

      page.drawText('This file type could not be converted to PDF automatically.', {
        x: 50,
        y: height - 160,
        size: fontSize,
      });

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, pdfBytes);
    } catch (error) {
      console.error(`❌ Error creating placeholder PDF: ${error}`);
      throw error;
    }
  }

  async mergePdfs(pdfPaths: string[], outputPath: string): Promise<string> {
    if (pdfPaths.length === 0) {
      throw new Error('No PDF files to merge');
    }

    if (pdfPaths.length === 1) {
      // Only one PDF, just copy it
      fs.copyFileSync(pdfPaths[0], outputPath);
      console.log(`✅ Single PDF copied: ${outputPath}`);
      return outputPath;
    }

    console.log(`🔄 Merging ${pdfPaths.length} PDFs into: ${outputPath}`);

    try {
      const mergedPdf = await PDFDocument.create();

      for (const pdfPath of pdfPaths) {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const pdfBytes = await mergedPdf.save();
      fs.writeFileSync(outputPath, pdfBytes);
      
      console.log(`✅ Merged PDF created: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error(`❌ Error merging PDFs: ${error}`);
      throw error;
    }
  }

  async processAttachments(attachments: any[], baseFileName: string): Promise<ProcessedFile | null> {
    if (!attachments || attachments.length === 0) {
      console.log('⚠️  No attachments to process');
      return null;
    }

    console.log(`\n📎 Processing ${attachments.length} attachment(s)...`);

    const downloadedFiles: string[] = [];
    const convertedPdfs: string[] = [];

    try {
      // Download all files
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        const fileName = attachment.name || `attachment_${i + 1}`;
        const downloadedPath = await this.downloadFile(attachment.url, fileName);
        downloadedFiles.push(downloadedPath);
      }

      // Convert all to PDF
      for (const filePath of downloadedFiles) {
        const pdfPath = await this.convertToPdf(filePath);
        convertedPdfs.push(pdfPath);
      }

      // Merge PDFs if multiple, or use single PDF
      let tempFinalPdfPath: string;
      
      if (convertedPdfs.length === 1) {
        // Single PDF - just rename it to the final name
        tempFinalPdfPath = path.join(this.tempDir, `${baseFileName}.pdf`);
        if (convertedPdfs[0] !== tempFinalPdfPath) {
          fs.copyFileSync(convertedPdfs[0], tempFinalPdfPath);
          console.log(`✅ Single PDF copied: ${tempFinalPdfPath}`);
        } else {
          // File is already in the right location
          tempFinalPdfPath = convertedPdfs[0];
        }
      } else {
        // Multiple PDFs - merge them
        tempFinalPdfPath = path.join(this.tempDir, `${baseFileName}.pdf`);
        await this.mergePdfs(convertedPdfs, tempFinalPdfPath);
      }

      // Move the final PDF to the upload directory to keep it safe
      const uploadPdfPath = path.join(this.uploadDir, `${baseFileName}.pdf`);
      fs.copyFileSync(tempFinalPdfPath, uploadPdfPath);
      console.log(`📁 Moved final PDF to upload directory: ${uploadPdfPath}`);

      // Clean up ALL intermediate files from temp directory (including the temp final PDF)
      const filesToCleanup: string[] = [...downloadedFiles, ...convertedPdfs];
      
      // Add the temp final PDF to cleanup if it's different from the converted PDFs
      if (!convertedPdfs.includes(tempFinalPdfPath)) {
        filesToCleanup.push(tempFinalPdfPath);
      }
      
      // Remove duplicates and clean up
      const uniqueFilesToCleanup = [...new Set(filesToCleanup)];
      this.cleanup(uniqueFilesToCleanup);

      return {
        originalName: baseFileName,
        pdfPath: uploadPdfPath, // Return the path in the upload directory
        uploadedUrl: '' // Will be set after upload
      };

    } catch (error) {
      console.error(`❌ Error processing attachments: ${error}`);
      // Clean up any files created so far
      this.cleanup([...downloadedFiles, ...convertedPdfs]);
      throw error;
    }
  }

  cleanup(filePaths: string[]): void {
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Cleaned up temp file: ${path.basename(filePath)}`);
        }
      } catch (error) {
        console.warn(`⚠️  Could not delete temp file: ${filePath}`);
      }
    }
  }

  cleanupTempDir(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up temporary directory');
      }
    } catch (error) {
      console.warn('⚠️  Could not clean up temp directory:', error);
    }
  }

  cleanupUploadDir(): void {
    try {
      if (fs.existsSync(this.uploadDir)) {
        fs.rmSync(this.uploadDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up upload directory');
      }
    } catch (error) {
      console.warn('⚠️  Could not clean up upload directory:', error);
    }
  }

  cleanupAllDirectories(): void {
    this.cleanupTempDir();
    this.cleanupUploadDir();
  }

  // New method to clean up a specific processed file after upload
  cleanupProcessedFile(processedFile: ProcessedFile): void {
    this.cleanup([processedFile.pdfPath]);
  }
} 