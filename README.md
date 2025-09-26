Business Card Scanner OCR + NER API
Bu proje, iş kartlarını tarayarak OCR (Optik Karakter Tanıma) ve NER (Named Entity Recognition) işlemleri yapan bir web API'sidir.

Özellikler
📷 Görüntü yükleme ve OCR işlemi
🔍 İsim, unvan, şirket, telefon, email, adres ve web sitesi çıkarma
🌍 Türkçe ve İngilizce dil desteği
🚀 Railway'de kolay deploy
API Endpoints
Health Check
GET /
OCR + NER İşlemi
POST /ocr
Content-Type: multipart/form-data
Body: image (file)
Railway'de Deploy Etme
Railway hesabınıza giriş yapın
"New Project" > "Deploy from GitHub repo" seçin
Bu repository'yi seçin
Deploy işlemi otomatik olarak başlayacak
Kullanım
# Yerel geliştirme
npm install
pip3 install -r requirements.txt
python3 -m spacy download en_core_web_sm
python3 -m spacy download tr_core_news_sm
npm start
Teknolojiler
Node.js - Web server
Express.js - Web framework
Tesseract.js - OCR işlemi
Python - NER işlemi
spaCy - Named Entity Recognition
Multer - Dosya yükleme