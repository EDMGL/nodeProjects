require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();

// OpenAI client'ı lazy initialization (istek geldiğinde oluştur)
let openai = null;
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable tanımlı değil');
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openai;
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'OCR API çalışıyor' });
});

// OCR endpoint
app.post('/ocr', async (req, res) => {
  try {
    // Apex class'tan gelen alanlar: image, fileName
    const { image, fileName } = req.body;

    console.log(`📸 OCR isteği alındı - fileName: ${fileName || 'belirtilmedi'}`);

    if (!image) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'image alanı gerekli' 
      });
    }

    // Gelen string'in başında "data:image..." varsa temizle
    let imageData = image;
    if (imageData.includes(',')) {
      imageData = imageData.split(',')[1];
    }

    // OpenAI'a görsel analiz isteği gönder
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Sen bir yapay zeka değilsin. Sen sadece görüntüdeki metni karakter karakter kopyalayan bir OCR motorusun.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `GÖREV: Kartvizit üzerindeki yazıları oku ve JSON formatına aktar.

KESİN KURALLAR (İHLAL ETME):
1. SADECE GÖRDÜĞÜNÜ YAZ: Kartın üzerinde yazmayan hiçbir kelimeyi, şehri veya ünvanı ekleme.
2. TAMAMLAMA YAPMA: "Alikahya" yazıyorsa "Köyü" ekleme. Adres eksikse eksik bırak.
3. DÜZELTME YAPMA: Yazım hatası varsa hatayı da aynen al.
4. TELEFON: Numarayı kartta gördüğün formatta (boşluklu/parantezli) aynen bırak.

İstenen JSON:
{
    "name": "...",
    "title": "...",
    "tel": "...", 
    "company": "...",
    "email": "...",
    "address": "...", 
    "web": "..."
}

Not: Eğer bir alan kartta yoksa 'null' değerini ver.`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageData}`
              }
            }
          ]
        }
      ],
      temperature: 0.0
    });

    // Cevabı temizle ve JSON'a çevir
    const rawContent = response.choices[0].message.content;
    const cleanedContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    
    let jsonData;
    try {
      jsonData = JSON.parse(cleanedContent);
    } catch (parseError) {
      return res.json({
        status: 'error',
        message: 'AI cevap üretti ama JSON formatı bozuk.',
        raw_response: rawContent
      });
    }

    return res.json({
      status: 'success',
      data: jsonData
    });

  } catch (error) {
    console.error('Hata:', error.message);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`🟢 OCR API http://${HOST}:${PORT}`);
  console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? '✓' : '✗'}`);
  console.log(`📝 GET  /`);
  console.log(`📝 POST /ocr`);
});

server.timeout = 120000;
