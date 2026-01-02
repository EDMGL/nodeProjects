require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();

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
  res.json({ 
    status: 'OK', 
    message: 'OCR API çalışıyor',
    openai_key_exists: !!process.env.OPENAI_API_KEY,
    openai_key_length: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
    env_keys: Object.keys(process.env).filter(k => k.includes('OPENAI') || k.includes('API'))
  });
});

// ContactInfo JSON Schema (Structured Output için)
const ContactInfoSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Kartvizitteki kişinin tam adı" },
    title: { type: "string", description: "Ünvan" },
    phone: { type: "string", description: "Telefon numarası" },
    company: { type: "string", description: "Şirket adı" },
    email: { type: "string", description: "E-posta adresi" },
    web: { type: "string", description: "Web sitesi" },
    address: { type: "string", description: "Adresin tamamı. OCR hataları (örn: 'Selküçlü' -> 'Selçuklu') düzeltilmiş temiz hali." },
    city: { type: "string", description: "Sadece İl (Şehir) ismi. Kartta yazmıyorsa ilçeden türet (Örn: Çankaya -> Ankara)." },
    country: { type: "string", description: "Ülke ismi" }
  },
  required: ["name", "title", "phone", "company", "email", "web", "address", "city", "country"],
  additionalProperties: false
};

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

    const systemPrompt = `Sen Türkiye adres formatları konusunda uzman bir yapay zeka asistanısın.

GÖREVLERİN:
1. Kartvizitteki metinleri oku.
2. HATALARI DÜZELT: OCR kaynaklı harf hatalarını Türkiye coğrafyasına göre düzelt.
   - Örn: 'Selküçlü' -> 'Selçuklu' (Konya olduğunu anla)
   - Örn: 'Istnbul' -> 'İstanbul'
3. MANTIK YÜRÜT: İlçe belliyse ama İl yazmıyorsa, İli sen doldur.
   - Örn: Adreste sadece 'Kızılay/Çankaya' yazıyorsa, City: 'Ankara' yap.
4. VERİYİ AYRIŞTIR: Adresi; tam adres, şehir ve ülke olarak ayır.

Not: Eğer bir alan kartta yoksa boş string ("") değerini ver.`;

    // OpenAI'a görsel analiz isteği gönder (Structured Output ile)
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Bu kartviziti analiz et, hataları düzelt ve ayrıştır.'
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
      temperature: 0.0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ContactInfo",
          strict: true,
          schema: ContactInfoSchema
        }
      }
    });

    // Structured output ile gelen cevabı parse et
    const rawContent = response.choices[0].message.content;
    
    let jsonData;
    try {
      jsonData = JSON.parse(rawContent);
    } catch (parseError) {
      return res.json({
        status: 'error',
        message: 'AI cevap üretti ama JSON formatı bozuk.',
        raw_response: rawContent
      });
    }

    return res.json({
      status: 'success',
      fileName: fileName || null,
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
