// ocrServer.js
const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');

const app = express();
const upload = multer({ 
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' })); // JSON input için

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'OCR API çalışıyor' });
});

// Ana OCR endpoint - hem multipart hem de JSON kabul eder
app.post('/ocr', async (req, res) => {
  try {
    let imageBuffer, fileName, shouldDeleteFile = false;
    let tempImagePath = null;

    // Content-Type'a göre farklı input'ları handle et
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      // Multipart form data için
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }
      
      imageBuffer = fs.readFileSync(req.file.path);
      fileName = req.file.originalname || 'image.jpg';
      tempImagePath = req.file.path;
      shouldDeleteFile = true;
      
      console.log('Processing multipart image:', tempImagePath);
      
    } else if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      // JSON input için
      if (!req.body || !req.body.image) {
        return res.status(400).json({ error: 'No image data in JSON body' });
      }
      
      try {
        imageBuffer = Buffer.from(req.body.image, 'base64');
        fileName = req.body.fileName || 'image.jpg';
        
        // Geçici dosya oluştur
        tempImagePath = `/tmp/${Date.now()}_${fileName}`;
        fs.writeFileSync(tempImagePath, imageBuffer);
        shouldDeleteFile = true;
        
        console.log('Processing JSON image:', tempImagePath);
      } catch (bufferErr) {
        console.error('Buffer conversion error:', bufferErr);
        return res.status(400).json({ error: 'Invalid base64 image data' });
      }
      
    } else {
      return res.status(400).json({ 
        error: 'Unsupported content type. Use multipart/form-data or application/json' 
      });
    }

    // OCR işlemi
    const result = await Tesseract.recognize(tempImagePath, 'eng', {
      logger: m => console.log(m)
    });
    
    const ocrText = result.data.text;
    console.log('OCR Text:', ocrText);

    // Bilgi çıkarma
    const extractedInfo = extractInfoFromText(ocrText);

    // Geçici dosyayı sil
    if (shouldDeleteFile && tempImagePath) {
      try {
        fs.unlinkSync(tempImagePath);
        console.log('Temporary file deleted:', tempImagePath);
      } catch (unlinkErr) {
        console.log('Could not delete temporary file:', unlinkErr.message);
      }
    }

    res.json({
      full_text: ocrText,
      ...extractedInfo
    });
    
  } catch (err) {
    console.error('OCR Error:', err);
    
    // Hata durumunda da geçici dosyayı silmeyi dene
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.log('Could not delete file on error:', unlinkErr.message);
      }
    }
    
    res.status(500).json({ 
      error: 'OCR failed', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Eski multipart endpoint'i de koruyalım (geriye uyumluluk için)
app.post('/ocr-multipart', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }

  const imagePath = req.file.path;

  try {
    console.log('Processing multipart image:', imagePath);
    
    const result = await Tesseract.recognize(imagePath, 'eng', {
      logger: m => console.log(m)
    });
    
    const ocrText = result.data.text;
    console.log('OCR Text:', ocrText);

    // Bilgi çıkarma
    const extractedInfo = extractInfoFromText(ocrText);

    // Dosyayı sil
    try {
      fs.unlinkSync(imagePath);
    } catch (unlinkErr) {
      console.log('Could not delete file:', unlinkErr.message);
    }

    res.json({
      full_text: ocrText,
      ...extractedInfo
    });
  } catch (err) {
    console.error('OCR Error:', err);
    
    // Dosyayı silmeyi dene
    try {
      fs.unlinkSync(imagePath);
    } catch (unlinkErr) {
      console.log('Could not delete file:', unlinkErr.message);
    }
    
    res.status(500).json({ 
      error: 'OCR failed', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// JSON-only endpoint (isteğe bağlı)
app.post('/ocr-json', express.json({ limit: '10mb' }), async (req, res) => {
  if (!req.body || !req.body.image) {
    return res.status(400).json({ error: 'No image data in JSON body' });
  }

  try {
    const imageBuffer = Buffer.from(req.body.image, 'base64');
    const fileName = req.body.fileName || 'image.jpg';
    
    // Geçici dosya oluştur
    const tempPath = `/tmp/${Date.now()}_${fileName}`;
    fs.writeFileSync(tempPath, imageBuffer);
    
    console.log('Processing JSON image:', tempPath);
    
    const result = await Tesseract.recognize(tempPath, 'eng', {
      logger: m => console.log(m)
    });
    
    const ocrText = result.data.text;
    console.log('OCR Text:', ocrText);

    // Bilgi çıkarma
    const extractedInfo = extractInfoFromText(ocrText);

    // Dosyayı sil
    try {
      fs.unlinkSync(tempPath);
    } catch (unlinkErr) {
      console.log('Could not delete file:', unlinkErr.message);
    }

    res.json({
      full_text: ocrText,
      ...extractedInfo
    });
    
  } catch (err) {
    console.error('OCR Error:', err);
    res.status(500).json({ 
      error: 'OCR failed', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

function extractInfoFromText(text) {
  const lines = text.split('\n');
  const result = {
    name: null,
    title: null,
    tel: null,
    company: null,
    email: null,
    address: null,
    web: null
  };

  // Email tespiti
  const emailMatch = text.match(/[\w\.-]+@[\w\.-]+/);
  if (emailMatch) {
    result.email = emailMatch[0];
  }

  // Telefon tespiti
  const phoneMatch = text.match(/(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}/);
  if (phoneMatch) {
    result.tel = phoneMatch[0];
  }

  // Web sitesi tespiti
  const webMatch = text.match(/(www\.|https?:\/\/)[^\s]+/);
  if (webMatch) {
    result.web = webMatch[0];
  }

  // İsim tespiti (basit yaklaşım)
  for (const line of lines) {
    const cleanLine = line.trim();
    if (cleanLine && !cleanLine.includes('@') && !cleanLine.includes('www') && 
        !cleanLine.includes('.com') && !/\d/.test(cleanLine) && 
        cleanLine.split(' ').length >= 2 && cleanLine.split(' ').length <= 4) {
      result.name = cleanLine;
      break;
    }
  }

  return result;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🟢 OCR API http://localhost:${PORT} üzerinden çalışıyor`);
  console.log(`📝 Endpoints:`);
  console.log(`   - GET  / (health check)`);
  console.log(`   - POST /ocr (hem multipart hem JSON)`);
  console.log(`   - POST /ocr-multipart (sadece multipart)`);
  console.log(`   - POST /ocr-json (sadece JSON)`);
});