// ocrServer.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');
const OpenAI = require('openai');

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const upload = multer({ 
  dest: '/tmp/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json({ limit: '10mb' })); // JSON input için

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'OCR API çalışıyor' });
});

// Ana OCR endpoint - OpenAI GPT-4o-mini ile kartvizit analizi
app.post('/ocr', async (req, res) => {
  try {
    let base64Image, fileName;

    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }
      
      const imageBuffer = fs.readFileSync(req.file.path);
      base64Image = imageBuffer.toString('base64');
      fileName = req.file.originalname || 'image.jpg';
      
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.log('Could not delete file:', unlinkErr.message);
      }
      
      console.log('Processing multipart image:', fileName);
      
    } else if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      if (!req.body || !req.body.image) {
        return res.status(400).json({ error: 'No image data in JSON body' });
      }
      
      base64Image = req.body.image;
      fileName = req.body.fileName || 'image.jpg';
      
      console.log('Processing JSON image:', fileName);
      
    } else {
      return res.status(400).json({ 
        error: 'Unsupported content type. Use multipart/form-data or application/json' 
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        details: 'Please set OPENAI_API_KEY environment variable'
      });
    }

    console.log('OpenAI\'a gönderiliyor...');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Sen Salesforce için veri yapılandıran uzman bir asistansın.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Bu kartvizitteki bilgileri oku ve aşağıdaki JSON formatına kesinlikle uy.
                            
İstenen JSON Sıralaması ve Formatı:
{
    "name": "...",
    "title": "...",
    "tel": "...",
    "company": "...",
    "email": "...",
    "address": "...",
    "web": "...",
    "description": "..."
}

Eğer bilgi yoksa 'null' yaz. Sadece JSON döndür, markdown kullanma.`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      temperature: 0.0
    });

    let rawContent = response.choices[0].message.content;
    console.log('OpenAI Raw Response:', rawContent);
    
    
    let cleanedContent = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    try {
      const jsonData = JSON.parse(cleanedContent);
      
      console.log('Parsed JSON:', jsonData);

      // Salesforce uyumlu format ile döndür
      res.json({
        status: 'success',
        fileName: fileName,
        ...jsonData
      });
      
    } catch (parseErr) {
      console.error('JSON Parse Error:', parseErr);
      res.status(500).json({
        error: 'AI JSON formatında cevap veremedi',
        raw_response: rawContent
      });
    }
    
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

// Tesseract tabanlı OCR endpoint (ücretsiz alternatif)
app.post('/ocr-tesseract', async (req, res) => {
  try {
    let base64Image, fileName;

    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      if (!req.body || !req.body.image) {
        return res.status(400).json({ error: 'No image data in JSON body' });
      }
      base64Image = req.body.image;
      fileName = req.body.fileName || 'image.jpg';
    } else {
      return res.status(400).json({ 
        error: 'Unsupported content type. Use application/json' 
      });
    }

    const imageBuffer = Buffer.from(base64Image, 'base64');
    const tempPath = `/tmp/${Date.now()}_${fileName}`;
    fs.writeFileSync(tempPath, imageBuffer);

    console.log('Processing with Tesseract:', tempPath);

    const result = await Tesseract.recognize(tempPath, 'eng', {
      logger: m => console.log(m)
    });

    const ocrText = result.data.text;
    const extractedInfo = extractInfoFromText(ocrText);

    try {
      fs.unlinkSync(tempPath);
    } catch (unlinkErr) {
      console.log('Could not delete file:', unlinkErr.message);
    }

    res.json({
      status: 'success',
      fileName: fileName,
      full_text: ocrText,
      ...extractedInfo
    });

  } catch (err) {
    console.error('Tesseract OCR Error:', err);
    res.status(500).json({ 
      error: 'OCR failed', 
      details: err.message
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
const server = app.listen(PORT, () => {
  console.log(`🟢 OCR API http://localhost:${PORT} üzerinden çalışıyor`);
  console.log(`🤖 OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Configured ✓' : 'NOT CONFIGURED ✗'}`);
  console.log(`📝 Endpoints:`);
  console.log(`   - GET  / (health check)`);
  console.log(`   - POST /ocr (OpenAI GPT-4o-mini ile kartvizit analizi)`);
  console.log(`   - POST /ocr-tesseract (Tesseract.js ile OCR - ücretsiz)`);
  console.log(`   - POST /ocr-multipart (Tesseract - sadece multipart)`);
  console.log(`   - POST /ocr-json (Tesseract - sadece JSON)`);
});

// Timeout süresini artır
server.timeout = 120000; // 2 dakika