use anyhow::Context;
use async_trait::async_trait;
use bytes::Bytes;
use std::path::PathBuf;
use tokio::fs;

use crate::config::StorageConfig;

#[async_trait]
pub trait StorageBackend: Send + Sync {
    async fn put(&self, path: &str, data: Bytes) -> anyhow::Result<()>;
    async fn get(&self, path: &str) -> anyhow::Result<Bytes>;
    async fn remove(&self, path: &str) -> anyhow::Result<()>;
}

// ── S3 / MinIO backend ────────────────────────────────────────────────────────

pub struct S3Storage {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3Storage {
    pub fn new(config: &StorageConfig) -> Self {
        let StorageConfig::S3 {
            endpoint,
            access_key,
            secret_key,
            bucket_name,
            region,
            use_ssl,
            use_path_style,
        } = config
        else {
            panic!("S3Storage::new called with non-S3 config");
        };

        let scheme = if *use_ssl { "https" } else { "http" };
        let endpoint_url = format!("{}://{}", scheme, endpoint);

        let creds = aws_credential_types::Credentials::new(
            access_key,
            secret_key,
            None,
            None,
            "static",
        );

        let s3_config = aws_sdk_s3::Config::builder()
            .endpoint_url(endpoint_url)
            .credentials_provider(creds)
            .region(aws_sdk_s3::config::Region::new(region.clone()))
            .force_path_style(*use_path_style)
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .build();

        S3Storage {
            client: aws_sdk_s3::Client::from_conf(s3_config),
            bucket: bucket_name.clone(),
        }
    }
}

#[async_trait]
impl StorageBackend for S3Storage {
    async fn put(&self, path: &str, data: Bytes) -> anyhow::Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(path)
            .body(data.into())
            .send()
            .await
            .with_context(|| format!("S3 put failed for key: {}", path))?;
        Ok(())
    }

    async fn get(&self, path: &str) -> anyhow::Result<Bytes> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(path)
            .send()
            .await
            .with_context(|| format!("S3 get failed for key: {}", path))?;

        let data = output
            .body
            .collect()
            .await
            .context("Failed to collect S3 response body")?
            .into_bytes();
        Ok(data)
    }

    async fn remove(&self, path: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(path)
            .send()
            .await
            .with_context(|| format!("S3 delete failed for key: {}", path))?;
        Ok(())
    }
}

// ── Local filesystem backend ──────────────────────────────────────────────────

pub struct LocalStorage {
    base_dir: PathBuf,
}

impl LocalStorage {
    pub fn new(base_dir: PathBuf) -> Self {
        LocalStorage { base_dir }
    }
}

#[async_trait]
impl StorageBackend for LocalStorage {
    async fn put(&self, path: &str, data: Bytes) -> anyhow::Result<()> {
        let full_path = self.base_dir.join(path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Failed to create dirs for {:?}", parent))?;
        }
        fs::write(&full_path, data)
            .await
            .with_context(|| format!("Failed to write file {:?}", full_path))?;
        Ok(())
    }

    async fn get(&self, path: &str) -> anyhow::Result<Bytes> {
        let full_path = self.base_dir.join(path);
        let data = fs::read(&full_path)
            .await
            .with_context(|| format!("Failed to read file {:?}", full_path))?;
        Ok(Bytes::from(data))
    }

    async fn remove(&self, path: &str) -> anyhow::Result<()> {
        let full_path = self.base_dir.join(path);
        fs::remove_file(&full_path)
            .await
            .with_context(|| format!("Failed to delete file {:?}", full_path))?;
        Ok(())
    }
}
