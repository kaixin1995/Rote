import type { ConfigTestResult } from '../../types/config';

const redactStorageConfig = (config?: any) => ({
  endpoint: config?.endpoint,
  bucket: config?.bucket,
  region: config?.region,
  urlPrefix: config?.urlPrefix,
  hasAccessKeyId: Boolean(config?.accessKeyId),
  hasSecretAccessKey: Boolean(config?.secretAccessKey),
});

export const getStorageFriendlyError = (details: any, fallbackMessage?: string) => {
  const code = details?.name || details?.Code || details?.code;
  const httpStatus = details?.$metadata?.httpStatusCode;
  const rawMessage = typeof details?.message === 'string' ? details.message : '';

  if (code === 'NoSuchBucket' || httpStatus === 404) {
    return 'Bucket not found. Please confirm the bucket name and region.';
  }

  if (code === 'AccessDenied' || httpStatus === 403) {
    return 'Access denied. Please check access keys and bucket permissions.';
  }

  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
    return 'Invalid credentials. Please verify access key and secret.';
  }

  if (code === 'PermanentRedirect' || code === 'MovedPermanently') {
    return 'Endpoint or region mismatch. Please verify the endpoint and region.';
  }

  if (
    code === 'UnknownEndpoint' ||
    rawMessage.includes('Inaccessible host') ||
    rawMessage.includes('ENOTFOUND')
  ) {
    return 'Unable to reach the endpoint. Please verify the endpoint address and network.';
  }

  if (
    code === 'NetworkingError' ||
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('ETIMEDOUT') ||
    rawMessage.includes('EHOSTUNREACH')
  ) {
    return 'Network error while connecting to the endpoint. Please check connectivity.';
  }

  if (rawMessage) {
    return rawMessage;
  }

  if (fallbackMessage) {
    return fallbackMessage;
  }

  return 'Please verify the endpoint, bucket, and credentials.';
};

export const logStorageTestStart = (source: string, config: any) => {
  console.info('[storage-test] start', source, redactStorageConfig(config));
};

export const logStorageTestResult = (source: string, result: ConfigTestResult) => {
  if (result.success) {
    console.info('[storage-test] success', source, result.details || {});
    return;
  }

  const metadata = (result.details as any)?.$metadata;
  console.warn('[storage-test] failed', source, {
    message: result.message,
    httpStatusCode: metadata?.httpStatusCode,
    requestId: metadata?.requestId,
    extendedRequestId: metadata?.extendedRequestId,
    details: result.details,
  });
};
