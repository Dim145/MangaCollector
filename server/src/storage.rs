use anyhow::{Context, anyhow};
use async_trait::async_trait;
use bytes::Bytes;
use std::path::{Component, Path, PathBuf};
use tokio::fs;

use crate::config::StorageConfig;

#[async_trait]
pub trait StorageBackend: Send + Sync {
    async fn put(&self, path: &str, data: Bytes) -> anyhow::Result<()>;
    async fn get(&self, path: &str) -> anyhow::Result<Bytes>;
    async fn remove(&self, path: &str) -> anyhow::Result<()>;
    /// Lightweight reachability probe used by `/api/health`. Should
    /// confirm the backend is contactable without writing or reading
    /// any user data.
    async fn ping(&self) -> anyhow::Result<()>;
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

    async fn ping(&self) -> anyhow::Result<()> {
        self.client
            .head_bucket()
            .bucket(&self.bucket)
            .send()
            .await
            .with_context(|| format!("S3 head_bucket failed for: {}", self.bucket))?;
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

    /// Defence-in-depth: refuse keys that resolve outside `base_dir`.
    ///
    /// All current call sites build keys server-side from numeric ids
    /// (`format!("uploads/images/{user}/{mal_id}.jpg")` etc.), so a
    /// traversal isn't reachable today. This guard keeps that
    /// invariant explicit so the moment a future route lets a path
    /// segment become user-controlled — even partially — we don't
    /// silently open a Zip-Slip.
    fn resolve(&self, path: &str) -> anyhow::Result<PathBuf> {
        let candidate = Path::new(path);
        if candidate.is_absolute() {
            return Err(anyhow!("storage key must be relative: {path}"));
        }
        for component in candidate.components() {
            match component {
                Component::Normal(_) => {}
                // Reject `..`, drive prefixes, root prefixes, `~/foo`-
                // style paths. `Component::CurDir` (`./`) is harmless
                // but we forbid it too so the rule is "only normal
                // segments allowed".
                _ => return Err(anyhow!("storage key has unsafe component: {path}")),
            }
        }
        Ok(self.base_dir.join(candidate))
    }
}

#[async_trait]
impl StorageBackend for LocalStorage {
    async fn put(&self, path: &str, data: Bytes) -> anyhow::Result<()> {
        let full_path = self.resolve(path)?;
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
        let full_path = self.resolve(path)?;
        let data = fs::read(&full_path)
            .await
            .with_context(|| format!("Failed to read file {:?}", full_path))?;
        Ok(Bytes::from(data))
    }

    async fn remove(&self, path: &str) -> anyhow::Result<()> {
        let full_path = self.resolve(path)?;
        fs::remove_file(&full_path)
            .await
            .with_context(|| format!("Failed to delete file {:?}", full_path))?;
        Ok(())
    }

    async fn ping(&self) -> anyhow::Result<()> {
        // Confirms the base directory exists and is reachable. We
        // don't `create_dir_all` here — that could mask a misconfig
        // where the volume failed to mount.
        match fs::metadata(&self.base_dir).await {
            Ok(meta) if meta.is_dir() => Ok(()),
            Ok(_) => Err(anyhow!(
                "LocalStorage base_dir is not a directory: {:?}",
                self.base_dir
            )),
            Err(e) => Err(anyhow!(
                "LocalStorage base_dir unreachable {:?}: {e}",
                self.base_dir
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local() -> LocalStorage {
        LocalStorage::new(PathBuf::from("/tmp/manga-collector-storage"))
    }

    #[test]
    fn accepts_normal_path() {
        let s = local();
        let p = s.resolve("uploads/images/42/100.jpg").unwrap();
        assert!(p.starts_with("/tmp/manga-collector-storage"));
    }

    #[test]
    fn rejects_parent_traversal() {
        let s = local();
        assert!(s.resolve("../etc/passwd").is_err());
        assert!(s.resolve("uploads/../../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_absolute() {
        let s = local();
        assert!(s.resolve("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_curdir() {
        let s = local();
        assert!(s.resolve("./uploads/x.jpg").is_err());
    }
}
