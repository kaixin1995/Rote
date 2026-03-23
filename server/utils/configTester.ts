import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { ConfigTestResult, StorageConfig } from '../types/config';
import { createStorageClient, presignPutUrlForConfig } from './r2';

/**
 * 配置测试工具类
 */
export class ConfigTester {
  private static buildStorageProbeKey(): string {
    return 'users/_storage_test/uploads/_rote_cors_probe';
  }

  /**
   * 测试存储配置（R2/S3）
   */
  public static async testStorage(config: StorageConfig): Promise<ConfigTestResult> {
    try {
      if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
        return {
          success: false,
          message: 'Storage configuration is incomplete, please fill in all required fields',
        };
      }

      const { s3: s3Client, bucketName } = createStorageClient(config);

      // 测试存储桶访问权限
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));

      // 生成 presigned PUT URL 用于前端 CORS 探测
      // 真实直传使用 PUT，因此这里也用 PUT 来验证浏览器 preflight 是否允许 PUT + Content-Type
      const probeKey = this.buildStorageProbeKey();
      let probeTarget: { putUrl: string; url: string };
      try {
        probeTarget = await presignPutUrlForConfig(
          config,
          probeKey,
          'application/octet-stream',
          120
        );
      } catch (probeError: any) {
        return {
          success: false,
          message: `Storage configuration test failed: unable to generate upload probe URL (${probeError.message})`,
          details: {
            endpoint: config.endpoint,
            bucket: config.bucket,
            urlPrefix: config.urlPrefix,
          },
        };
      }

      // 构建 URL Prefix 探测地址
      const urlPrefix = (config.urlPrefix || '').trim().replace(/\/+$/, '');
      const urlPrefixProbeUrl = urlPrefix ? probeTarget.url : undefined;

      return {
        success: true,
        message: 'Storage configuration test successful',
        details: {
          endpoint: config.endpoint,
          bucket: config.bucket,
          urlPrefix: config.urlPrefix,
          probeUrl: probeTarget.putUrl,
          urlPrefixProbeUrl,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Storage configuration test failed: ${error.message}`,
        details: error,
      };
    }
  }

  /**
   * 测试数据库连接
   */
  public static async testDatabase(): Promise<ConfigTestResult> {
    try {
      const { db, closeDatabase } = await import('./drizzle');
      const { sql } = await import('drizzle-orm');

      // 执行简单查询测试连接
      await db.execute(sql`SELECT 1`);
      await closeDatabase();

      return {
        success: true,
        message: 'Database connection test successful',
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Database connection test failed: ${error.message}`,
        details: error,
      };
    }
  }
}
