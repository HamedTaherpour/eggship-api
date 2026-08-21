import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InMemoryStorageProvider } from './in-memory-storage.provider';
import { S3CompatibleStorageProvider } from './s3-compatible-storage.provider';
import type { StorageProvider } from './storage-provider';
import { STORAGE_PROVIDER } from './storage.tokens';

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageProvider => {
        const nodeEnv = config.getOrThrow<string>('NODE_ENV');
        const provider = config.getOrThrow<'memory' | 's3'>('STORAGE_PROVIDER');

        if (provider === 'memory') {
          if (nodeEnv === 'production') {
            throw new Error(
              'STORAGE_PROVIDER=memory is forbidden when NODE_ENV=production.',
            );
          }
          return new InMemoryStorageProvider(
            config.getOrThrow<string>('STORAGE_PUBLIC_BASE_URL'),
          );
        }

        return new S3CompatibleStorageProvider({
          endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
          region: config.getOrThrow<string>('STORAGE_REGION'),
          bucket: config.getOrThrow<string>('STORAGE_BUCKET'),
          accessKey: config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
          secretKey: config.getOrThrow<string>('STORAGE_SECRET_KEY'),
          publicBaseUrl: config.getOrThrow<string>('STORAGE_PUBLIC_BASE_URL'),
          forcePathStyle: config.getOrThrow<boolean>(
            'STORAGE_FORCE_PATH_STYLE',
          ),
        });
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
