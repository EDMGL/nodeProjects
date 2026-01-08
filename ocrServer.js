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
    phone: { type: "string", description: "Sabit telefon numarası. Genelde 0212, 0312, 0232 gibi alan kodlarıyla başlar. Kartta birden fazla numara varsa bu sabit hat numarası olmalı." },
    mobile: { type: "string", description: "Mobil telefon numarası. Genelde 05XX ile başlar. Kartta birden fazla numara varsa bu mobil numara olmalı." },
    company: { type: "string", description: "Şirket adı" },
    email: { type: "string", description: "E-posta adresi" },
    web: { type: "string", description: "Web sitesi" },
    street: { type: "string", description: "Sadece Cadde/Sokak bilgisi. Örn: 'Atatürk Cad. No:15' veya '123. Sokak' Maksimum 40 karakter olmalı." },
    district: { type: "string", description: "İlçe ismi. Örn: 'Çankaya', 'Kadıköy', 'Selçuklu'" },
    city: { type: "string", description: "Sadece İl (Şehir) ismi. Kartta yazmıyorsa ilçeden türet (Örn: Çankaya -> Ankara)." },
    country: { type: "string", description: "Ülke ismi" }
  },
  required: ["name", "phone", "mobile", "company", "email", "web", "street", "district", "city", "country"],
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
4. VERİYİ AYRIŞTIR: Adresi parçalarına ayır:
   - street: Sadece Cadde/Sokak bilgisi (Örn: 'Atatürk Cad. No:15')
   - district: İlçe ismi (Örn: 'Çankaya', 'Kadıköy')
   - city: İl ismi (Örn: 'Ankara', 'Konya')
   - country: Ülke ismi

TELEFON NUMARALARI İÇİN ÖNEMLİ KURALLAR:
- phone: SABİT HAT numarası. Genelde 0212, 0312, 0232, 0216 gibi şehir alan kodlarıyla başlar. Fax numarası DEĞİL.
- mobile: MOBİL telefon numarası. Genelde 05XX (0530, 0532, 0533, 0535, 0536, 0537, 0538, 0539, 0542, 0543, 0544, 0545, 0546, 0549, 0552, 0553, 0554, 0555, 0559) ile başlar.
- Kartta 3 veya daha fazla numara varsa, SADECE sabit hat ve mobil numarayı al. Fax numarasını ALMA.
- Kartta sadece 1 numara varsa:
  * 05XX ile başlıyorsa → mobile alanına yaz, phone boş kalsın
  * Şehir kodu ile başlıyorsa → phone alanına yaz, mobile boş kalsın
- Kartta 2 numara varsa, birini phone diğerini mobile'a yaz (türüne göre).

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
