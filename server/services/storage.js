const s3 = require('minio');
const fs = require('fs');
const path = require('path');

const s3Endpoint = process.env.S3_ENDPOINT;
const s3AccessKey = process.env.S3_ACCESS_KEY;
const s3SecretKey = process.env.S3_SECRET_KEY;
const s3BucketName = process.env.S3_BUCKET_NAME;
const s3Region = process.env.S3_REGION || s3.DEFAULT_REGION;
const s3UseSSL = process.env.S3_USE_SSL === 'true';
const s3UsePathStyle = process.env.S3_USE_PATH_STYLE === 'true';

const useS3 = s3Endpoint && s3AccessKey && s3SecretKey && s3BucketName;

/**
 * @type {{
 *    putFile: (filePath: string, fileStream: ReadableStream) => Promise<void>,
 *    getFile: (filePath: string) => Promise<ReadableStream>,
 *    removeFile: (filePath: string) => Promise<void>
 *   }}
 */
let storageClient;

if (useS3) {
  const s3Client = new s3.Client({
    endPoint: s3Endpoint,
    accessKey: s3AccessKey,
    secretKey: s3SecretKey,
    useSSL: s3UseSSL,
    region: s3Region,
    pathStyle: s3UsePathStyle
  });

  storageClient = {
    putFile: async (filePath, fileStream) => {
      return await s3Client.putObject(s3BucketName, filePath, fileStream);
    },
    getFile: async (filePath) => {
      return await s3Client.getObject(s3BucketName, filePath);
    },
    removeFile: async (filePath) => {
      return await s3Client.removeObject(s3BucketName, filePath);
    }
  }
}
else {
  const storageDir = process.env.STORAGE_DIR || path.join(__dirname, '../storage');

  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  storageClient = {
    putFile: async (filePath, fileStream) => {
      filePath = path.join(storageDir, filePath);

      const dirname = path.dirname(filePath);

      if(!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
      }

      const writeStream = fs.createWriteStream(filePath);

      return new Promise((resolve, reject) => {
        if(typeof fileStream.pipe === 'function') {
          fileStream.pipe(writeStream);
        }
        else {
          writeStream.write(fileStream);
          writeStream.end();
        }
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
      });
    },

    getFile: async (filePath) => {
      filePath = path.join(storageDir, filePath);
      return fs.createReadStream(filePath);
    },
    removeFile: async (filePath) => {
      filePath = path.join(storageDir, filePath);
      return fs.promises.unlink(filePath);
    }
  }
}

module.exports = storageClient;
