import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { Logger } from './logger';
import { config } from './config';

export interface ProcessedFile {
  path: string;
  name: string;
  mimetype: string;
  isImage: boolean;
  isText: boolean;
  size: number;
  tempPath?: string;
}

export interface ImageContent {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = ImageContent | TextContent;

export class FileHandler {
  private logger = new Logger('FileHandler');
  private botToken?: string;

  constructor(botToken?: string) {
    this.botToken = botToken;
  }

  async downloadAndProcessFiles(files: any[]): Promise<ProcessedFile[]> {
    const processedFiles: ProcessedFile[] = [];

    for (const file of files) {
      try {
        const processed = await this.downloadFile(file);
        if (processed) {
          processedFiles.push(processed);
        }
      } catch (error) {
        this.logger.error(`Failed to process file ${file.name}`, error);
      }
    }

    return processedFiles;
  }

  private async downloadFile(file: any): Promise<ProcessedFile | null> {
    if (file.size > 50 * 1024 * 1024) {
      this.logger.warn('File too large, skipping', { name: file.name, size: file.size });
      return null;
    }

    try {
      this.logger.debug('Downloading file', { name: file.name, mimetype: file.mimetype });

      const response = await fetch(file.url_private_download, {
        headers: {
          'Authorization': `Bearer ${config.slack.botToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.buffer();
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `slack-file-${Date.now()}-${file.name}`);

      fs.writeFileSync(tempPath, buffer);

      const processed: ProcessedFile = {
        path: tempPath,
        name: file.name,
        mimetype: file.mimetype,
        isImage: this.isImageFile(file.mimetype),
        isText: this.isTextFile(file.mimetype),
        size: file.size,
        tempPath,
      };

      this.logger.info('File downloaded successfully', {
        name: file.name,
        tempPath,
        isImage: processed.isImage,
        isText: processed.isText,
      });

      return processed;
    } catch (error) {
      this.logger.error('Failed to download file', error);
      return null;
    }
  }

  private isImageFile(mimetype: string): boolean {
    return mimetype.startsWith('image/');
  }

  private isTextFile(mimetype: string): boolean {
    const textTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/typescript',
      'application/xml',
      'application/yaml',
      'application/x-yaml',
    ];
    return textTypes.some(type => mimetype.startsWith(type));
  }

  /** Convert image to JPEG base64, resized to max 1024px */
  private imageToBase64(filePath: string): { data: string; media_type: string } | null {
    try {
      // Use sips (macOS built-in) to convert and resize
      const jpgPath = filePath + '.converted.jpg';
      execSync(`sips -s format jpeg -Z 1024 "${filePath}" --out "${jpgPath}" 2>/dev/null`, { timeout: 10000 });
      const data = fs.readFileSync(jpgPath).toString('base64');
      fs.unlinkSync(jpgPath);
      this.logger.info('Image converted to base64', { size: data.length });
      return { data, media_type: 'image/jpeg' };
    } catch (error) {
      this.logger.error('Failed to convert image', error);
      return null;
    }
  }

  /** Build multimodal content array with images and text */
  buildMultimodalContent(files: ProcessedFile[], userText: string): MessageContent[] {
    const content: MessageContent[] = [];

    // Add images as base64
    for (const file of files) {
      if (file.isImage) {
        const img = this.imageToBase64(file.path);
        if (img) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: img.media_type, data: img.data },
          });
        }
      }
    }

    // Add text files inline
    let textPart = userText || '';
    for (const file of files) {
      if (file.isText) {
        try {
          const fileContent = fs.readFileSync(file.path, 'utf-8');
          const truncated = fileContent.length > 10000
            ? fileContent.substring(0, 10000) + '...'
            : fileContent;
          textPart += `\n\nファイル: ${file.name}\n\`\`\`\n${truncated}\n\`\`\``;
        } catch {
          textPart += `\n\nファイル: ${file.name}（読み取りエラー）`;
        }
      } else if (!file.isImage) {
        textPart += `\n\nファイル: ${file.name}（${file.mimetype}, ${file.size} bytes）`;
      }
    }

    if (textPart.trim()) {
      content.push({ type: 'text', text: textPart.trim() });
    }

    return content;
  }

  /** Check if files contain images */
  hasImages(files: ProcessedFile[]): boolean {
    return files.some(f => f.isImage);
  }

  /** Build prompt with files. Images are resized to small JPEG for Read tool. */
  async formatFilePrompt(files: ProcessedFile[], userText: string): Promise<string> {
    let prompt = userText || 'アップロードされたファイルを確認してください。';

    for (const file of files) {
      if (file.isImage) {
        // Resize to small JPEG so Read tool can handle it
        const resizedPath = this.resizeImage(file.path);
        if (resizedPath) {
          prompt += `\n\n画像: ${file.name}\nパス: ${resizedPath}\nRead ツールでこの画像を読み取って内容を確認してください。`;
        } else {
          prompt += `\n\n（画像 ${file.name} は処理できませんでした）`;
        }
      } else if (file.isText) {
        prompt += `\n\nファイル: ${file.name}\n`;
        try {
          const content = fs.readFileSync(file.path, 'utf-8');
          const truncated = content.length > 10000
            ? content.substring(0, 10000) + '...'
            : content;
          prompt += `\`\`\`\n${truncated}\n\`\`\``;
        } catch {
          prompt += '（読み取りエラー）';
        }
      } else {
        prompt += `\n\nファイル: ${file.name}（${file.mimetype}, ${file.size} bytes）`;
      }
    }

    return prompt;
  }

  /** Resize image and strip EXIF/color profile for API compatibility */
  private resizeImage(filePath: string): string | null {
    const resizedPath = filePath + '.resized.jpg';
    try {
      // Use Python/Pillow to properly convert: strip EXIF, convert to sRGB, resize
      execSync(`python3 -c "
from PIL import Image, ImageOps
img = Image.open('${filePath}')
img = ImageOps.exif_transpose(img)  # Apply EXIF rotation
img = img.convert('RGB')  # Strip alpha, convert to sRGB
img.thumbnail((768, 768))  # Resize preserving aspect ratio
img.save('${resizedPath}', 'JPEG', quality=85)
"`, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
      if (fs.existsSync(resizedPath)) {
        const stats = fs.statSync(resizedPath);
        this.logger.info('Image resized with Pillow', { original: filePath, resized: resizedPath, size: stats.size });
        return resizedPath;
      }
    } catch (error) {
      this.logger.error('Image resize failed', error);
    }
    return null;
  }

  async cleanupTempFiles(files: ProcessedFile[]): Promise<void> {
    for (const file of files) {
      if (file.tempPath) {
        try {
          fs.unlinkSync(file.tempPath);
          // Also clean up resized version
          const resized = file.tempPath + '.resized.jpg';
          if (fs.existsSync(resized)) fs.unlinkSync(resized);
          this.logger.debug('Cleaned up temp file', { path: file.tempPath });
        } catch (error) {
          this.logger.warn('Failed to cleanup temp file', { path: file.tempPath, error });
        }
      }
    }
  }

  /**
   * Upload a local file to Slack using the new external upload API.
   * Returns the file ID on success, or null on failure.
   */
  async uploadFileToSlack(
    filePath: string,
    channel: string,
    threadTs?: string,
    initialComment?: string,
  ): Promise<string | null> {
    const token = this.botToken || config.slack.botToken;
    if (!token) {
      this.logger.error('No bot token available for file upload');
      return null;
    }

    try {
      if (!fs.existsSync(filePath)) {
        this.logger.error('File not found for upload', { filePath });
        return null;
      }

      const fileName = path.basename(filePath);
      const fileSize = fs.statSync(filePath).size;

      if (fileSize > 50 * 1024 * 1024) {
        this.logger.warn('File too large for upload (>50MB)', { filePath, fileSize });
        return null;
      }

      this.logger.info('Uploading file to Slack', { filePath, fileName, fileSize });

      // Step 1: Get an upload URL
      const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          filename: fileName,
          length: String(fileSize),
        }),
      });

      const urlData = await urlRes.json() as any;
      if (!urlData.ok) {
        this.logger.error('Failed to get upload URL', { error: urlData.error });
        return null;
      }

      const { upload_url, file_id } = urlData;

      // Step 2: Upload the file content
      const fileBuffer = fs.readFileSync(filePath);
      const uploadRes = await fetch(upload_url, {
        method: 'POST',
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        this.logger.error('Failed to upload file content', { status: uploadRes.status });
        return null;
      }

      // Step 3: Complete the upload and share to channel
      const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: [{ id: file_id, title: fileName }],
          channel_id: channel,
          thread_ts: threadTs,
          initial_comment: initialComment,
        }),
      });

      const completeData = await completeRes.json() as any;
      if (!completeData.ok) {
        this.logger.error('Failed to complete file upload', { error: completeData.error });
        return null;
      }

      this.logger.info('File uploaded successfully', { fileId: file_id, fileName, channel });
      return file_id;
    } catch (error) {
      this.logger.error('File upload failed', error);
      return null;
    }
  }

  /**
   * Extract [UPLOAD:/path/to/file] markers from text.
   * Returns the cleaned text and list of file paths to upload.
   */
  /**
   * Take a screenshot and upload it to a Slack channel.
   * Returns the file ID on success, or null on failure.
   */
  async captureAndSendScreenshot(
    channel: string,
    threadTs?: string,
    comment?: string,
  ): Promise<string | null> {
    const tmpPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
    try {
      execSync(`screencapture -x ${tmpPath}`, { timeout: 10000 });
      const fileId = await this.uploadFileToSlack(tmpPath, channel, threadTs, comment);
      return fileId;
    } catch (error) {
      this.logger.error('Screenshot capture failed', error);
      return null;
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  static extractUploadMarkers(text: string): { cleanText: string; filePaths: string[] } {
    const filePaths: string[] = [];
    const cleanText = text.replace(/\[UPLOAD:\s*(.+?)\]/g, (_match, filePath) => {
      filePaths.push(filePath.trim());
      return '';
    }).trim();
    return { cleanText, filePaths };
  }
}
