const multer = require('multer');
const path = require('path');
const multerS3 = require('multer-s3');
const aws = require('aws-sdk');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Choose provider via env: 's3' or 'cloudinary'
const provider = process.env.UPLOAD_PROVIDER || 'cloudinary';

let upload;

if (provider === 's3') {
  aws.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
  });

  const s3 = new aws.S3();

  upload = multer({
    storage: multerS3({
      s3: s3,
      bucket: process.env.AWS_S3_BUCKET,
      acl: 'public-read',
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext).replace(/\s+/g, '-');
        const folder = file.mimetype.startsWith('image') ? 'images' : 'audio';
        cb(null, `${folder}/${Date.now()}-${base}${ext}`);
      }
    }),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
      const isImage = file.mimetype.startsWith('image/');
      const isAudio = file.mimetype.startsWith('audio/');
      if (isImage || isAudio) cb(null, true);
      else cb(new Error('Only image and audio files are allowed'));
    }
  });
} else {
  // Cloudinary configuration
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      const folder = file.mimetype.startsWith('image') ? 'images' : 'audio';
      const resource_type = file.mimetype.startsWith('image') ? 'image' : 'video';
      return {
        folder: `civic-issue-tracker/${folder}`,
        resource_type,
        public_id: `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'mp3', 'wav', 'm4a']
      };
    }
  });

  upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const isImage = file.mimetype.startsWith('image/');
      const isAudio = file.mimetype.startsWith('audio/');
      if (isImage || isAudio) cb(null, true);
      else cb(new Error('Only image and audio files are allowed'));
    }
  });
}

module.exports = upload;
